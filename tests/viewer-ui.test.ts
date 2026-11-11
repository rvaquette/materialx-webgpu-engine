import { afterEach, describe, expect, it, vi } from 'vitest';
import { startViewerUi, type ViewerUiState, type ViewerUiActions } from '../src/viewer-ui.ts';
import { MaterialParameterEditor } from '../src/material-parameter-editor.ts';
import { ImGui } from '@mori2003/jsimgui';
import type { MaterialParameter } from '../src/render/material-parameters.ts';

const controls = vi.hoisted(() => ({
  checkbox: '',
  selection: '',
  header: false,
  io: { ConfigFlags: 0, AddMouseSourceEvent: vi.fn(), AddMousePosEvent: vi.fn() },
  style: { ScrollbarSize: 14, GrabMinSize: 12, FramePadding: {}, ItemSpacing: {} },
  number: undefined as number | undefined,
  color: undefined as [number, number, number] | undefined,
}));
vi.mock('@mori2003/jsimgui', () => ({
  ImVec2: class { constructor(public x: number, public y: number) {} },
  ImVec4: class { constructor(public x: number, public y: number, public z: number, public w: number) {} },
  ImGuiCol: { ScrollbarBg: 14, ScrollbarGrab: 15, ScrollbarGrabHovered: 16, ScrollbarGrabActive: 17 },
  ImGuiWindowFlags: { NoMove: 1, NoResize: 2, NoCollapse: 4, NoSavedSettings: 8, AlwaysVerticalScrollbar: 16384 },
  ImGuiComboFlags: { None: 0, HeightLarge: 8 },
  ImGuiConfigFlags: { NavEnableKeyboard: 1 },
  ImGuiMouseSource: { _Mouse: 0, _TouchScreen: 1, _Pen: 2 },
  ImGuiImplWeb: { Init: vi.fn(async () => {}), BeginRender: vi.fn(), EndRender: vi.fn() },
  ImGui: {
    StyleColorsDark: vi.fn(), GetIO: () => controls.io, GetStyle: () => controls.style, SetNextWindowPos: vi.fn(), SetNextWindowSize: vi.fn(),
    PushStyleColorImVec4: vi.fn(), PopStyleColor: vi.fn(),
    Begin: () => true, End: vi.fn(), BeginDisabled: vi.fn(), EndDisabled: vi.fn(),
    SeparatorText: vi.fn(), Text: vi.fn(), TextWrapped: vi.fn(), SameLine: vi.fn(),
    SetNextItemWidth: vi.fn(), SetItemDefaultFocus: vi.fn(), EndCombo: vi.fn(), BeginCombo: vi.fn(() => true),
    RadioButton: vi.fn(() => false), Button: vi.fn(() => false),
    Selectable: vi.fn((label: string) => {
      if (label !== controls.selection) return false;
      controls.selection = '';
      return true;
    }),
    Checkbox: vi.fn((label: string, value: [boolean]) => {
      if (label !== controls.checkbox) return false;
      value[0] = !value[0];
      return true;
    }),
    CollapsingHeader: () => controls.header, DestroyContext: vi.fn(),
    PushID: vi.fn(), PopID: vi.fn(), SliderFloat: () => false,
    ColorEdit3: vi.fn((_label: string, value: [number, number, number]) => {
      if (!controls.color) return false;
      value.splice(0, 3, ...controls.color);
      controls.color = undefined;
      return true;
    }),
    InputFloat: vi.fn((_label: string, value: [number]) => {
      if (controls.number === undefined) return false;
      value[0] = controls.number;
      controls.number = undefined;
      controls.color = undefined;
      controls.style.ScrollbarSize = 14;
      return true;
    }),
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  controls.checkbox = '';
  controls.selection = '';
  controls.header = false;
  controls.number = undefined;
  vi.useRealTimers();
});

describe('ImGui material parameter editing', () => {
  it('sends color picker edits as linear uniform values', async () => {
    vi.useFakeTimers();
    const parameter: MaterialParameter = {
      id: 'tint', input: 'transmissionTint', label: 'Tint', type: 'color3',
      value: [1, 1, 1], initial: [1, 1, 1], update: 'uniform',
    };
    const apply = vi.fn(async () => {});
    const editor = new MaterialParameterEditor({ parameters: () => [parameter], apply, error: vi.fn() });
    controls.color = [0.5, 1, 0];
    editor.draw();
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).toHaveBeenCalledWith(new Map([['tint', [expect.closeTo(0.214041), 1, 0]]]));
  });

  it('coalesces edits and cancels pending rebuilds when the selected object changes', async () => {
    vi.useFakeTimers();
    const parameter: MaterialParameter = {
      id: 'roughness', input: 'roughness', label: 'Roughness', type: 'float',
      value: [0.2], initial: [0.2], update: 'rebuild',
    };
    const apply = vi.fn(async () => {});
    const editor = new MaterialParameterEditor({ parameters: () => [parameter], apply, error: vi.fn() });
    controls.number = 0.4;
    editor.draw();
    controls.number = 0.7;
    editor.draw();
    expect(apply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(180);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]).toEqual([new Map([['roughness', [0.7]]])]);
    controls.number = 0.9;
    editor.draw();
    editor.refresh();
    await vi.advanceTimersByTimeAsync(180);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('surfaces failed edits and restores authoritative values instead of keeping a success-shaped draft', async () => {
    vi.useFakeTimers();
    const failure = new Error('Material compilation failed');
    const error = vi.fn();
    const parameter: MaterialParameter = {
      id: 'roughness', input: 'roughness', label: 'Roughness', type: 'float',
      value: [0.2], initial: [0.2], update: 'uniform',
    };
    const editor = new MaterialParameterEditor({
      parameters: () => [parameter], apply: vi.fn(async () => { throw failure; }), error,
    });
    controls.number = 0.8;
    editor.draw();
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalledWith(failure);
    vi.mocked(ImGui.InputFloat).mockClear();
    editor.draw();
    expect(ImGui.InputFloat).toHaveBeenCalledWith('Valeur 1', [0.2], 0, 0, '%.6g');
  });
});

function fixture() {
  const state: ViewerUiState = {
    entry: 'books.usda', scenes: [{ label: 'Books', entry: 'books.usda' }, { label: 'Chair', entry: 'chair.usda' }],
    resolution: 256, pathTracingDepth: 12, rasterQuality: 'interactive', backend: 'raster', environmentEnabled: true, denoise: false, compiled: false,
    status: undefined, busy: false, busyMessage: '', error: '', shaderErrors: '', warnings: '',
    objectPath: '/Book', objects: [{ path: '/Book', material: 'Paper' }], materialPath: '',
    materialFolderPath: [], materialTree: { folders: new Map(), materials: [{ label: 'Gold', path: './gold.mtlx' }] },
  };
  const actions: ViewerUiActions = {
    scene: vi.fn(), resolution: vi.fn(), pathTracingDepth: vi.fn(), quality: vi.fn(), backend: vi.fn(), environment: vi.fn(),
    denoise: vi.fn(), pause: vi.fn(), openFiles: vi.fn(), object: vi.fn(), material: vi.fn(),
  };
  const parameters = new MaterialParameterEditor({ parameters: () => [], apply: vi.fn(), error: vi.fn() });
  let tick!: FrameRequestCallback;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { tick = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('devicePixelRatio', 2);
  const canvas = Object.assign(new EventTarget(), {
    width: 1, height: 1, clientWidth: 400, clientHeight: 700,
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
  }) as HTMLCanvasElement;
  return { state, actions, parameters, canvas, render: () => tick(0) };
}

describe('Dear ImGui viewer controls', () => {
  it('keeps export out of the UI and gates source-material replacement for compiled entries', async () => {
    const f = fixture();
    f.state.compiled = true;
    controls.header = true;
    const stop = await startViewerUi(f.canvas, f.state, f.actions, f.parameters);
    f.render();
    expect(vi.mocked(ImGui.Button).mock.calls.some(([label]) => label.includes('Exporter'))).toBe(false);
    expect(ImGui.Text).toHaveBeenCalledWith('Scene compilee : remplacement via le USD source.');
    expect(ImGui.BeginDisabled).toHaveBeenCalledWith(true);
    vi.mocked(ImGui.Button).mockImplementation(() => false);
    stop();
  });

  it('offers the rectangular 1024x768 resolution and preserves its dimensions in the callback', async () => {
    const f = fixture();
    const stop = await startViewerUi(f.canvas, f.state, f.actions, f.parameters);
    controls.selection = '1024 x 768##1024x768';
    f.render();
    expect(f.actions.resolution).toHaveBeenCalledWith('1024x768');
    expect(ImGui.BeginCombo).toHaveBeenNthCalledWith(1, '##scene', 'Books', 8);
    expect(ImGui.PushStyleColorImVec4).toHaveBeenCalledWith(17, { x: 0.78, y: 0.78, z: 0.78, w: 1 });
    expect(ImGui.PopStyleColor).toHaveBeenCalledWith(4);
    stop();
  });

  it('offers path-tracing bounce depth and applies the selected value', async () => {
    const f = fixture();
    const stop = await startViewerUi(f.canvas, f.state, f.actions, f.parameters);
    controls.selection = '16 rebonds##16';
    f.render();
    expect(f.actions.pathTracingDepth).toHaveBeenCalledWith(16);
    stop();
  });

  it('does not offer zero depth unless the loaded scene explicitly uses it', async () => {
    const f = fixture();
    const stop = await startViewerUi(f.canvas, f.state, f.actions, f.parameters);
    f.render();
    expect(vi.mocked(ImGui.Selectable).mock.calls.some(([label]) => label === '0 rebonds##0')).toBe(false);
    stop();

    const zeroDepth = fixture();
    zeroDepth.state.pathTracingDepth = 0;
    const stopZeroDepth = await startViewerUi(zeroDepth.canvas, zeroDepth.state, zeroDepth.actions, zeroDepth.parameters);
    zeroDepth.render();
    expect(vi.mocked(ImGui.Selectable).mock.calls.some(([label]) => label === '0 rebond (scène, fond seulement)##0')).toBe(true);
    stopZeroDepth();
  });

  const pointer = (type: string, pointerType: string): Event => Object.assign(new Event(type), {
    pointerType, clientX: 45, clientY: 70,
  });

  it('lets the touch backend handle each gesture exactly once, including scrollbar drags', async () => {
    const f = fixture();
    const stop = await startViewerUi(f.canvas, f.state, f.actions, f.parameters);
    const backendPointer = vi.fn();
    const backendTouch = vi.fn();
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) f.canvas.addEventListener(type, backendPointer);
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) f.canvas.addEventListener(type, backendTouch);
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) f.canvas.dispatchEvent(pointer(type, 'touch'));
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) f.canvas.dispatchEvent(new Event(type));
    expect(backendPointer).not.toHaveBeenCalled();
    expect(backendTouch).toHaveBeenCalledTimes(4);
    expect(controls.io.AddMouseSourceEvent).toHaveBeenCalledWith(1);
    expect(controls.style.ScrollbarSize).toBe(28);
    f.render();
    expect(ImGui.Selectable).toHaveBeenCalledWith('Books##books.usda', true, 0, { x: 0, y: 0 });
    expect(controls.style.FramePadding).toEqual({});
    expect(controls.style.ItemSpacing).toEqual({});
    stop();
    f.canvas.dispatchEvent(pointer('pointerdown', 'touch'));
    expect(backendPointer).toHaveBeenCalledTimes(1);
  });

  it.each(['mouse', 'pen'])('sets the current %s position before the backend processes a press', async pointerType => {
    const f = fixture();
    const stop = await startViewerUi(f.canvas, f.state, f.actions, f.parameters);
    expect(controls.style.ScrollbarSize).toBe(20);
    expect(controls.style.GrabMinSize).toBe(24);
    const backend = vi.fn(() => {
      expect(controls.io.AddMousePosEvent).toHaveBeenLastCalledWith(35, 50);
    });
    f.canvas.addEventListener('pointerdown', backend);
    f.canvas.dispatchEvent(pointer('pointerdown', pointerType));
    expect(backend).toHaveBeenCalledTimes(1);
    expect(controls.io.AddMouseSourceEvent).toHaveBeenLastCalledWith(pointerType === 'pen' ? 2 : 0);
    stop();
  });

  it('keeps initial control heights and spacing with wider scrollbars on a coarse-pointer device', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const f = fixture();
    const stop = await startViewerUi(f.canvas, f.state, f.actions, f.parameters);
    f.render();
    expect(controls.style.ScrollbarSize).toBe(28);
    expect(ImGui.Selectable).toHaveBeenCalledWith('Books##books.usda', true, 0, { x: 0, y: 0 });
    expect(controls.style.FramePadding).toEqual({});
    expect(controls.style.ItemSpacing).toEqual({});
    stop();
  });

  it('renders the environment and rendering controls without local import buttons', async () => {
    const f = fixture();
    const stop = await startViewerUi(f.canvas, f.state, f.actions, f.parameters);
    controls.checkbox = 'Envmap';
    f.render();
    expect(f.actions.environment).toHaveBeenCalledWith(false);
    expect(ImGui.Button).not.toHaveBeenCalledWith('Ouvrir GLB/glTF + ressources');
    expect(ImGui.Button).not.toHaveBeenCalledWith('Ouvrir un dossier glTF');
    expect(ImGui.RadioButton).toHaveBeenCalledWith('Raster', true);
    expect(ImGui.RadioButton).toHaveBeenCalledWith('Path tracing', false);
    expect(ImGui.Checkbox).toHaveBeenCalledWith('Denoiser JS (neural)', [false]);
    const radioCalls = vi.mocked(ImGui.RadioButton).mock.invocationCallOrder;
    const checkboxCalls = vi.mocked(ImGui.Checkbox).mock.invocationCallOrder;
    const sameLineCalls = vi.mocked(ImGui.SameLine).mock.invocationCallOrder;
    expect(sameLineCalls.some(order => order > radioCalls[0]! && order < radioCalls[1]!)).toBe(true);
    expect(sameLineCalls.some(order => order > checkboxCalls[0]! && order < checkboxCalls[1]!)).toBe(true);
    expect(f.canvas.width).toBe(800);
    expect(f.canvas.height).toBe(1400);
    expect(controls.io.ConfigFlags & 1).toBe(1);
    stop();
    expect(ImGui.DestroyContext).toHaveBeenCalled();
  });

  it('routes scene and material choices without duplicating overlay messages in the controls', async () => {
    const f = fixture();
    const draw = vi.spyOn(f.parameters, 'draw').mockImplementation(() => {});
    controls.header = true;
    f.state.error = 'Import failed';
    f.state.shaderErrors = 'WGSL error';
    f.state.warnings = 'Missing texture';
    const stop = await startViewerUi(f.canvas, f.state, f.actions, f.parameters);
    controls.selection = 'Chair##chair.usda';
    f.render();
    expect(f.actions.scene).toHaveBeenCalledWith('chair.usda');
    controls.selection = 'Gold##./gold.mtlx';
    f.render();
    expect(f.actions.material).toHaveBeenCalledWith('./gold.mtlx');
    expect(draw).toHaveBeenCalledTimes(2);
    expect(ImGui.TextWrapped).not.toHaveBeenCalled();
    f.state.busy = true;
    f.render();
    expect(ImGui.BeginDisabled).toHaveBeenCalledWith(true);
    stop();
  });
});
