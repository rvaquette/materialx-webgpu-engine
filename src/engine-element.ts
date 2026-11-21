// `<materialx-viewer>`: a custom element wrapping MaterialXEngine for pages and
// applications without a framework. The class is created by
// defineMaterialXViewer() so importing this module never touches DOM globals.

import { MaterialXEngine, type EngineMaterial, type EngineObject, type EngineOptions, type EngineStatus } from './engine.ts';

export const MATERIALX_VIEWER_TAG = 'materialx-viewer';

/** Engine options shared by every element of a definition; `onStatus` is replaced by the `materialx-status` event. */
export type MaterialXViewerEngineOptions = Omit<EngineOptions, 'onStatus' | 'device'>;

export interface MaterialXViewerDefinition {
  /** Custom element name; `materialx-viewer` by default. */
  tagName?: string;
  engineOptions?: MaterialXViewerEngineOptions;
}

export interface MaterialXViewerEventMap {
  'materialx-load': CustomEvent<{ objects: readonly EngineObject[] }>;
  'materialx-status': CustomEvent<EngineStatus>;
  'materialx-error': CustomEvent<{ error: unknown }>;
}

/**
 * Attributes: `src` (USD scene URL), `backend` (`raster`, `pathtracing` or `disney`),
 * `target-noise` (path-tracing stop criterion), `width` and `height` (canvas pixels,
 * 256 by default) and `orbit-controls` (camera interaction, enabled unless `"false"`).
 */
export interface MaterialXViewerElement extends HTMLElement {
  /** The engine of the connected element, for operations the element does not wrap. */
  readonly engine: MaterialXEngine | undefined;
  /** Objects of the loaded scene. */
  readonly objects: readonly EngineObject[];
  /** Resolves once every pending creation, load, render or material change has settled. */
  readonly updateComplete: Promise<void>;
  /** Replace an object's material (omit `material` to restore the USD binding), after pending updates. */
  setMaterial(path: string, material?: EngineMaterial): Promise<void>;
  addEventListener<K extends keyof MaterialXViewerEventMap>(
    type: K, listener: (this: MaterialXViewerElement, event: MaterialXViewerEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  removeEventListener<K extends keyof MaterialXViewerEventMap>(
    type: K, listener: (this: MaterialXViewerElement, event: MaterialXViewerEventMap[K]) => unknown,
    options?: boolean | EventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
}

const BACKENDS = ['raster', 'pathtracing', 'disney'] as const;
type Backend = (typeof BACKENDS)[number];

declare global {
  interface HTMLElementTagNameMap {
    'materialx-viewer': MaterialXViewerElement;
  }
}

function canvasSize(value: string | null): number {
  const size = Number(value ?? 256);
  if (!Number.isSafeInteger(size) || size < 1) throw new RangeError(`Invalid canvas size "${value}".`);
  return size;
}

/** Register `<materialx-viewer>` (or `tagName`); a second call returns the registered class. */
export function defineMaterialXViewer(definition: MaterialXViewerDefinition = {}): new () => MaterialXViewerElement {
  const tagName = definition.tagName ?? MATERIALX_VIEWER_TAG;
  const existing = customElements.get(tagName);
  if (existing) return existing as unknown as new () => MaterialXViewerElement;
  const engineOptions = definition.engineOptions ?? {};

  class Viewer extends HTMLElement implements MaterialXViewerElement {
    static readonly observedAttributes = ['src', 'backend', 'target-noise', 'width', 'height', 'orbit-controls'];
    #engine: MaterialXEngine | undefined;
    #canvas: HTMLCanvasElement | undefined;
    #loadedSrc: string | null = null;
    #queue: Promise<void> = Promise.resolve();
    /** Incremented on (re)connection and disconnection so stale queued work stops. */
    #generation = 0;

    get engine(): MaterialXEngine | undefined { return this.#engine; }
    get objects(): readonly EngineObject[] { return this.#engine?.objects ?? []; }
    get updateComplete(): Promise<void> { return this.#queue; }

    connectedCallback(): void { this.#recreate(); }

    disconnectedCallback(): void {
      this.#generation++;
      this.#release();
    }

    attributeChangedCallback(name: string, previous: string | null, next: string | null): void {
      if (!this.isConnected || previous === next) return;
      if (name === 'width' || name === 'height' || name === 'orbit-controls') this.#recreate();
      else if (name === 'src') this.#enqueue(engine => this.getAttribute('src') === this.#loadedSrc ? Promise.resolve() : this.#load(engine));
      else this.#enqueue(engine => this.#render(engine));
    }

    setMaterial(path: string, material?: EngineMaterial): Promise<void> {
      return this.#enqueue(engine => engine.setMaterial(path, material), true);
    }

    #recreate(): void {
      const generation = ++this.#generation;
      this.#release();
      this.#enqueue(async () => {
        const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
        const canvas = document.createElement('canvas');
        canvas.width = canvasSize(this.getAttribute('width'));
        canvas.height = canvasSize(this.getAttribute('height'));
        canvas.style.display = 'block';
        root.replaceChildren(canvas);
        const engine = await MaterialXEngine.create(canvas, {
          ...engineOptions,
          orbitControls: this.getAttribute('orbit-controls') !== 'false',
          onStatus: status => this.dispatchEvent(new CustomEvent('materialx-status', { detail: status })),
        });
        if (generation !== this.#generation) {
          engine.dispose();
          return;
        }
        this.#engine = engine;
        this.#canvas = canvas;
        await this.#load(engine);
      }, false, false);
    }

    #release(): void {
      this.#engine?.dispose();
      this.#engine = undefined;
      this.#canvas?.remove();
      this.#canvas = undefined;
      this.#loadedSrc = null;
    }

    async #load(engine: MaterialXEngine): Promise<void> {
      const src = this.getAttribute('src');
      this.#loadedSrc = src;
      if (!src) return;
      await engine.loadUsd(new URL(src, document.baseURI));
      this.dispatchEvent(new CustomEvent('materialx-load', { detail: { objects: engine.objects } }));
      await this.#render(engine);
    }

    async #render(engine: MaterialXEngine): Promise<void> {
      if (engine.objects.length === 0 && !engine.isCompiledScene) return;
      const backend = (this.getAttribute('backend') ?? 'raster') as Backend;
      if (!BACKENDS.includes(backend)) throw new Error(`Unsupported backend "${backend}".`);
      const noise = this.getAttribute('target-noise');
      if (backend === 'pathtracing') {
        const targetNoise = noise === null ? undefined : Number(noise);
        if (targetNoise !== undefined && !(targetNoise > 0)) throw new RangeError(`Invalid target-noise "${noise}".`);
        await engine.render(targetNoise === undefined ? { backend } : { backend, targetNoise });
      } else {
        await engine.render({ backend });
      }
    }

    /**
     * Run `task` after pending work on the current engine. Failures are reported as
     * `materialx-error` events, or, with `rethrow`, through the returned promise only.
     */
    #enqueue(task: (engine: MaterialXEngine) => Promise<void>, rethrow = false, needsEngine = true): Promise<void> {
      const generation = this.#generation;
      const run = this.#queue.then(async () => {
        const engine = this.#engine;
        if (generation !== this.#generation) return;
        if (needsEngine && !engine) {
          if (rethrow) throw new Error('The viewer is not connected.');
          return;
        }
        await task(engine!);
      });
      this.#queue = run.catch(error => {
        if (!rethrow && generation === this.#generation) this.dispatchEvent(new CustomEvent('materialx-error', { detail: { error } }));
      });
      return rethrow ? run : this.#queue;
    }
  }

  customElements.define(tagName, Viewer);
  return Viewer;
}
