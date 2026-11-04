import { ImGui, ImGuiImplWeb, ImVec2, ImGuiWindowFlags, ImGuiConfigFlags, ImGuiMouseSource } from '@mori2003/jsimgui';
import type { ViewerStatus, BackendKind } from './render/viewer.ts';
import type { RasterQuality } from './render/raster/ir-forward.ts';
import type { MaterialParameterEditor } from './material-parameter-editor.ts';
import type { MaterialFolder } from './scene/material-tree.ts';

export interface ViewerUiState {
  entry: string;
  scenes: Array<{ label: string; entry: string }>;
  resolution: number;
  rasterQuality: RasterQuality;
  backend: BackendKind;
  environmentEnabled: boolean;
  denoise: boolean;
  status: ViewerStatus | undefined;
  busy: boolean;
  busyMessage: string;
  error: string;
  shaderErrors: string;
  warnings: string;
  objectPath: string;
  objects: ReadonlyArray<{ path: string; material: string; assetPath?: string }>;
  materialFolderPath: string[];
  materialTree: MaterialFolder;
  materialPath: string;
}

export interface ViewerUiActions {
  scene: (entry: string) => void;
  resolution: (size: number) => void;
  quality: (quality: RasterQuality) => void;
  backend: (backend: BackendKind) => void;
  environment: (enabled: boolean) => void;
  denoise: (enabled: boolean) => void;
  pause: () => void;
  openFiles: (folder: boolean) => void;
  object: (path: string) => void;
  material: (path: string) => void;
}

function combo(label: string, value: string, options: readonly { label: string; value: string }[], change: (value: string) => void): void {
  const selected = options.find(option => option.value === value);
  ImGui.SetNextItemWidth(-1);
  if (ImGui.BeginCombo(label, selected?.label ?? value)) {
    for (const option of options) {
      if (ImGui.Selectable(`${option.label}##${option.value}`, option.value === value, 0, new ImVec2(0, 0))) change(option.value);
      if (option.value === value) ImGui.SetItemDefaultFocus();
    }
    ImGui.EndCombo();
  }
}

function attachPointerInput(canvas: HTMLCanvasElement, enableTouch: () => void): () => void {
  const io = ImGui.GetIO();
  const pointer = (event: PointerEvent): void => {
    // jsimgui already handles touchstart/move/end (including the virtual keyboard).
    // Do not also enqueue the same gesture through its pointer listeners.
    if (event.pointerType === 'touch') {
      event.stopImmediatePropagation();
      return;
    }
    io.AddMouseSourceEvent(event.pointerType === 'pen' ? ImGuiMouseSource._Pen : ImGuiMouseSource._Mouse);
    const rect = canvas.getBoundingClientRect();
    io.AddMousePosEvent(event.clientX - rect.left, event.clientY - rect.top);
  };
  const touch = (): void => {
    enableTouch();
    io.AddMouseSourceEvent(ImGuiMouseSource._TouchScreen);
  };
  const capture = { capture: true };
  canvas.addEventListener('pointerdown', pointer, capture);
  canvas.addEventListener('pointermove', pointer, capture);
  canvas.addEventListener('pointerup', pointer, capture);
  canvas.addEventListener('touchstart', touch, capture);
  return () => {
    canvas.removeEventListener('pointerdown', pointer, capture);
    canvas.removeEventListener('pointermove', pointer, capture);
    canvas.removeEventListener('pointerup', pointer, capture);
    canvas.removeEventListener('touchstart', touch, capture);
  };
}

/** Rendering/input backend is isolated here; controls and callbacks use plain engine state. */
export async function startViewerUi(
  canvas: HTMLCanvasElement, state: ViewerUiState, actions: ViewerUiActions, parameters: MaterialParameterEditor,
): Promise<() => void> {
  await ImGuiImplWeb.Init({ canvas, backend: 'webgl2' });
  ImGui.StyleColorsDark();
  ImGui.GetIO().ConfigFlags |= ImGuiConfigFlags.NavEnableKeyboard;
  let touchControls = false;
  const enableTouch = (): void => {
    if (touchControls) return;
    touchControls = true;
    const style = ImGui.GetStyle();
    style.ScrollbarSize = 28;
    style.GrabMinSize = 28;
  };
  if (globalThis.matchMedia?.('(pointer: coarse)').matches) enableTouch();
  const detachInput = attachPointerInput(canvas, enableTouch);
  let stopped = false;
  let frame = 0;
  const render = (): void => {
    if (stopped) return;
    try {
      const dpr = devicePixelRatio || 1;
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ImGuiImplWeb.BeginRender();
      ImGui.SetNextWindowPos(new ImVec2(0, 0));
      ImGui.SetNextWindowSize(new ImVec2(canvas.clientWidth, canvas.clientHeight));
      if (ImGui.Begin('MaterialX', undefined, ImGuiWindowFlags.NoMove | ImGuiWindowFlags.NoResize | ImGuiWindowFlags.NoCollapse | ImGuiWindowFlags.NoSavedSettings)) {
        ImGui.BeginDisabled(state.busy);
        ImGui.SeparatorText('Scene');
        combo('##scene', state.entry, state.scenes.map(scene => ({ label: scene.label, value: scene.entry })), actions.scene);
        if (ImGui.Button('Ouvrir GLB/glTF + ressources')) actions.openFiles(false);
        if (ImGui.Button('Ouvrir un dossier glTF')) actions.openFiles(true);
        ImGui.SeparatorText('Rendu');
        combo('##resolution', String(state.resolution), [256, 512, 1024].map(size => ({ label: `${size} x ${size}`, value: String(size) })), value => actions.resolution(Number(value)));
        combo('##quality', state.rasterQuality, [
          { label: 'Interactive (filtered IBL)', value: 'interactive' },
          { label: 'Reference (64 samples)', value: 'reference' },
        ], value => { if (value === 'interactive' || value === 'reference') actions.quality(value); });
        if (ImGui.RadioButton('Raster', state.backend === 'raster')) actions.backend('raster');
        ImGui.SameLine();
        if (ImGui.RadioButton('Path tracing', state.backend === 'pathtracing')) actions.backend('pathtracing');
        const environment: [boolean] = [state.environmentEnabled];
        if (ImGui.Checkbox('Envmap', environment)) actions.environment(environment[0]);
        const denoise: [boolean] = [state.denoise];
        if (ImGui.Checkbox('Denoiser JS (neural)', denoise)) actions.denoise(denoise[0]);
        ImGui.BeginDisabled(state.backend !== 'pathtracing');
        if (ImGui.Button(state.status?.pathTracingPaused ? 'Reprendre' : 'Pause')) actions.pause();
        ImGui.EndDisabled();
        if (state.backend === 'pathtracing' && state.status?.pathTracer === 'ready') {
          ImGui.SameLine();
          ImGui.Text(`${state.status.samples} spp${state.status.pathTracingPaused ? ' (pause)' : ''}`);
        }
        if (ImGui.CollapsingHeader('Materiaux')) {
          ImGui.BeginDisabled(!state.objects.length);
          combo('##object', state.objectPath, state.objects.map(object => ({
            label: `${object.path.split('/').at(-1)} (${object.material})`, value: object.path,
          })), actions.object);
          let folder = state.materialTree;
          for (let depth = 0; folder.folders.size; depth++) {
            const index = depth;
            combo(`##folder-${depth}`, state.materialFolderPath[depth] ?? '', [
              { label: 'Choisir un dossier...', value: '' },
              ...[...folder.folders.keys()].sort().map(name => ({ label: name, value: name })),
            ], value => { state.materialFolderPath = [...state.materialFolderPath.slice(0, index), ...(value ? [value] : [])]; });
            const child = folder.folders.get(state.materialFolderPath[depth] ?? '');
            if (!child) break;
            folder = child;
          }
          combo('##material', state.materialPath, [
            { label: "Materiau d'origine", value: '' },
            ...folder.materials.map(material => ({ label: material.label, value: material.path })),
          ], actions.material);
          if (ImGui.CollapsingHeader('Parametres du materiau')) parameters.draw();
          ImGui.EndDisabled();
        }
        ImGui.EndDisabled();
        if (state.busyMessage) ImGui.TextWrapped(state.busyMessage);
        if (state.error) { ImGui.SeparatorText('Erreur'); ImGui.TextWrapped(state.error); }
        if (ImGui.CollapsingHeader('Erreurs WGSL')) ImGui.TextWrapped(state.shaderErrors || 'Aucune erreur WGSL.');
        if (state.warnings && ImGui.CollapsingHeader("Avertissements d'import glTF")) ImGui.TextWrapped(state.warnings);
      }
      ImGui.End();
      ImGuiImplWeb.EndRender();
      frame = requestAnimationFrame(render);
    } catch (error) {
      stopped = true;
      detachInput();
      console.error('ImGui rendering failed:', error);
      document.getElementById('app')?.classList.remove('ui-ready');
      const output = document.getElementById('status');
      if (output) { output.hidden = false; output.textContent = `Echec ImGui : ${String(error)}`; }
    }
  };
  frame = requestAnimationFrame(render);
  return () => { stopped = true; cancelAnimationFrame(frame); detachInput(); ImGui.DestroyContext(); };
}
