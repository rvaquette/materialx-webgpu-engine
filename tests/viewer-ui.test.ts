import { afterEach, describe, expect, it, vi } from 'vitest';
import { startViewerUi, type ViewerUiState, type ViewerUiActions } from '../src/viewer-ui.ts';
import { MaterialParameterEditor } from '../src/material-parameter-editor.ts';
import { ImGui } from '@mori2003/jsimgui';

const controls = vi.hoisted(() => ({
  checkbox: '',
  selection: '',
  header: false,
  io: { ConfigFlags: 0 },
}));
vi.mock('@mori2003/jsimgui', () => ({
  ImVec2: class { constructor(public x: number, public y: number) {} },
  ImGuiWindowFlags: { NoMove: 1, NoResize: 2, NoCollapse: 4, NoSavedSettings: 8 },
  ImGuiConfigFlags: { NavEnableKeyboard: 1 },
  ImGuiImplWeb: { Init: vi.fn(async () => {}), BeginRender: vi.fn(), EndRender: vi.fn() },
  ImGui: {
    StyleColorsDark: vi.fn(), GetIO: () => controls.io, SetNextWindowPos: vi.fn(), SetNextWindowSize: vi.fn(),
    Begin: () => true, End: vi.fn(), BeginDisabled: vi.fn(), EndDisabled: vi.fn(),
    SeparatorText: vi.fn(), Text: vi.fn(), TextWrapped: vi.fn(), SameLine: vi.fn(),
    SetNextItemWidth: vi.fn(), SetItemDefaultFocus: vi.fn(), EndCombo: vi.fn(), BeginCombo: () => true,
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
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  controls.checkbox = '';
  controls.selection = '';
  controls.header = false;
});

function fixture() {
  const state: ViewerUiState = {
    entry: 'books.usda', scenes: [{ label: 'Books', entry: 'books.usda' }, { label: 'Chair', entry: 'chair.usda' }],
    resolution: 256, rasterQuality: 'interactive', backend: 'raster', environmentEnabled: true, denoise: false,
    status: undefined, busy: false, busyMessage: '', error: '', shaderErrors: '', warnings: '',
    objectPath: '/Book', objects: [{ path: '/Book', material: 'Paper' }], materialPath: '',
    materialFolderPath: [], materialTree: { folders: new Map(), materials: [{ label: 'Gold', path: './gold.mtlx' }] },
  };
  const actions: ViewerUiActions = {
    scene: vi.fn(), resolution: vi.fn(), quality: vi.fn(), backend: vi.fn(), environment: vi.fn(),
    denoise: vi.fn(), pause: vi.fn(), openFiles: vi.fn(), object: vi.fn(), material: vi.fn(),
  };
  const parameters = new MaterialParameterEditor({ parameters: () => [], apply: vi.fn(), error: vi.fn() });
  let tick!: FrameRequestCallback;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { tick = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('devicePixelRatio', 2);
  const canvas = { width: 1, height: 1, clientWidth: 400, clientHeight: 700 } as HTMLCanvasElement;
  return { state, actions, parameters, canvas, render: () => tick(0) };
}

describe('Dear ImGui viewer controls', () => {
  it('renders the environment checkbox, native import buttons and all rendering controls', async () => {
    const f = fixture();
    const stop = await startViewerUi(f.canvas, f.state, f.actions, f.parameters);
    controls.checkbox = 'Envmap';
    f.render();
    expect(f.actions.environment).toHaveBeenCalledWith(false);
    expect(ImGui.Button).toHaveBeenCalledWith('Ouvrir GLB/glTF + ressources');
    expect(ImGui.Button).toHaveBeenCalledWith('Ouvrir un dossier glTF');
    expect(ImGui.RadioButton).toHaveBeenCalledWith('Raster', true);
    expect(ImGui.RadioButton).toHaveBeenCalledWith('Path tracing', false);
    expect(ImGui.Checkbox).toHaveBeenCalledWith('Denoiser JS (neural)', [false]);
    expect(f.canvas.width).toBe(800);
    expect(f.canvas.height).toBe(1400);
    expect(controls.io.ConfigFlags & 1).toBe(1);
    stop();
    expect(ImGui.DestroyContext).toHaveBeenCalled();
  });

  it('routes scene and material choices through engine callbacks and renders diagnostics', async () => {
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
    expect(ImGui.TextWrapped).toHaveBeenCalledWith('Import failed');
    expect(ImGui.TextWrapped).toHaveBeenCalledWith('WGSL error');
    expect(ImGui.TextWrapped).toHaveBeenCalledWith('Missing texture');
    f.state.busy = true;
    f.render();
    expect(ImGui.BeginDisabled).toHaveBeenCalledWith(true);
    stop();
  });
});
