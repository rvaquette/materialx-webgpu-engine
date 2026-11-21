import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const engines = vi.hoisted(() => [] as Array<{
  options: { orbitControls?: boolean; onStatus?: (status: unknown) => void; runtimeAssets?: unknown };
  canvas: { width: number; height: number };
  objects: { path: string; material: string }[];
  isCompiledScene: boolean;
  loadUsd: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  setMaterial: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}>);
const creation = vi.hoisted(() => ({ gate: undefined as Promise<void> | undefined, calls: 0 }));

vi.mock('../src/engine.ts', () => ({
  MaterialXEngine: {
    async create(canvas: { width: number; height: number }, options: (typeof engines)[number]['options']) {
      creation.calls++;
      await creation.gate;
      const engine: (typeof engines)[number] = {
        options, canvas, objects: [], isCompiledScene: false,
        loadUsd: vi.fn(async () => { engine.objects = [{ path: '/World/Ball', material: 'M' }]; }),
        render: vi.fn(async () => {}),
        setMaterial: vi.fn(async () => {}),
        dispose: vi.fn(),
      };
      engines.push(engine);
      return engine;
    },
  },
}));

/** Just enough of the DOM for a custom element: attributes, connection, shadow root and events. */
class FakeElement extends EventTarget {
  #attributes = new Map<string, string>();
  isConnected = false;
  shadowRoot: { replaceChildren: (...nodes: unknown[]) => void } | null = null;
  attachShadow() {
    this.shadowRoot = { replaceChildren: vi.fn() };
    return this.shadowRoot;
  }
  getAttribute(name: string) { return this.#attributes.get(name) ?? null; }
  setAttribute(name: string, value: string) {
    const previous = this.getAttribute(name);
    this.#attributes.set(name, value);
    (this as unknown as { attributeChangedCallback(n: string, p: string | null, v: string): void })
      .attributeChangedCallback(name, previous, value);
  }
  connect() { this.isConnected = true; (this as unknown as { connectedCallback(): void }).connectedCallback(); }
  disconnect() { this.isConnected = false; (this as unknown as { disconnectedCallback(): void }).disconnectedCallback(); }
}

const registry = new Map<string, unknown>();
beforeEach(() => {
  registry.clear();
  engines.length = 0;
  creation.gate = undefined;
  creation.calls = 0;
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('customElements', { get: (name: string) => registry.get(name), define: (name: string, c: unknown) => registry.set(name, c) });
  vi.stubGlobal('document', {
    baseURI: 'https://host/app/page.html',
    createElement: () => ({ width: 0, height: 0, style: {}, remove: vi.fn() }),
  });
});
afterEach(() => vi.unstubAllGlobals());

async function viewer(attributes: Record<string, string> = {}) {
  const { defineMaterialXViewer } = await import('../src/engine-element.ts');
  const Viewer = defineMaterialXViewer({ engineOptions: { runtimeAssets: { materialxCore: '/core/' } } });
  const element = new Viewer() as unknown as FakeElement & InstanceType<typeof Viewer>;
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  const events: { type: string; detail: unknown }[] = [];
  for (const type of ['materialx-load', 'materialx-status', 'materialx-error']) {
    element.addEventListener(type, event => events.push({ type, detail: (event as CustomEvent).detail }));
  }
  return { element, events };
}

describe('<materialx-viewer>', () => {
  it('creates an engine on connection, loads src relative to the page and renders the selected backend', async () => {
    const { element, events } = await viewer({
      src: 'scenes/ball.usda', backend: 'pathtracing', 'target-noise': '0.02', width: '320', height: '200', 'orbit-controls': 'false',
    });
    element.connect();
    await element.updateComplete;
    const engine = engines[0]!;
    expect(engine.canvas).toMatchObject({ width: 320, height: 200 });
    expect(engine.options).toMatchObject({ orbitControls: false, runtimeAssets: { materialxCore: '/core/' } });
    expect(engine.loadUsd).toHaveBeenCalledWith(new URL('https://host/app/scenes/ball.usda'));
    expect(engine.render).toHaveBeenCalledWith({ backend: 'pathtracing', targetNoise: 0.02 });
    expect(element.objects).toEqual([{ path: '/World/Ball', material: 'M' }]);
    engine.options.onStatus?.({ backend: 'pathtracing' });
    expect(events).toEqual([
      { type: 'materialx-load', detail: { objects: [{ path: '/World/Ball', material: 'M' }] } },
      { type: 'materialx-status', detail: { backend: 'pathtracing' } },
    ]);
  });

  it('serializes attribute changes and material edits, and reports failures as events', async () => {
    const { element, events } = await viewer({ src: 'a.usda' });
    element.connect();
    element.setAttribute('src', 'a.usda');
    element.setAttribute('backend', 'disney');
    const material = element.setMaterial('/World/Ball', { url: 'orange.mtlx' });
    element.setAttribute('src', 'b.usda');
    await material;
    await element.updateComplete;
    const engine = engines[0]!;
    // Attributes changed before the engine exists are read when it loads: only the latest src is loaded.
    expect(engine.loadUsd.mock.calls.map(([url]) => String(url))).toEqual(['https://host/app/b.usda']);
    expect(engine.render.mock.calls).toEqual([[{ backend: 'disney' }], [{ backend: 'disney' }]]);
    expect(engine.setMaterial).toHaveBeenCalledWith('/World/Ball', { url: 'orange.mtlx' });

    element.setAttribute('backend', 'vulkan');
    await element.updateComplete;
    expect(events.at(-1)).toMatchObject({ type: 'materialx-error', detail: { error: new Error('Unsupported backend "vulkan".') } });
    engine.setMaterial.mockRejectedValueOnce(new Error('bad material'));
    await expect(element.setMaterial('/World/Ball')).rejects.toThrow('bad material');
    expect(events.filter(event => event.type === 'materialx-error')).toHaveLength(1);
  });

  it('disposes the engine on disconnection, including one still being created', async () => {
    const { element } = await viewer({ src: 'a.usda' });
    element.connect();
    await element.updateComplete;
    element.disconnect();
    expect(engines[0]!.dispose).toHaveBeenCalledOnce();
    expect(element.engine).toBeUndefined();
    await expect(element.setMaterial('/World/Ball')).rejects.toThrow('not connected');

    let open!: () => void;
    creation.gate = new Promise(resolve => { open = resolve; });
    element.connect();
    await vi.waitFor(() => expect(creation.calls).toBe(2));
    element.disconnect();
    open();
    await element.updateComplete;
    expect(engines[1]!.dispose).toHaveBeenCalledOnce();
    expect(engines[1]!.loadUsd).not.toHaveBeenCalled();
  });

  it('registers each tag once', async () => {
    const { defineMaterialXViewer } = await import('../src/engine-element.ts');
    expect(defineMaterialXViewer()).toBe(defineMaterialXViewer());
  });
});
