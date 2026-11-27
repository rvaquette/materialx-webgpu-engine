import { InteractiveViewer } from './render/viewer.ts';
import { SCENE_CATALOG, SOURCE_SCENE_CATALOG } from './scene/scene-catalog.ts';
import { MATERIAL_CATALOG } from './scene/material-catalog.ts';
import { buildMaterialTree } from './scene/material-tree.ts';
import { MaterialParameterEditor } from './material-parameter-editor.ts';
import { setMaterialGraphPresenter, showMaterialGraph } from './material-graph-diagram.ts';
import { bindMaterialLibrary } from './material-library.ts';
import { sceneDeviceDescriptor } from './gpu/device.ts';
import { startViewerUi, type ViewerUiState, type ViewerUiActions } from './viewer-ui.ts';
import type { LocalGltfScene } from './scene/local-gltf.ts';
import { downloadDisplayedAovPng, downloadPathTraceAovPfm, encodePathTraceAovPfm } from './render/aov-export.ts';
import { attachScriptEditor, type ScriptEditorAttachment, type ScriptRunControl } from './materialx/script-editor.ts';
import { NODE_REFERENCE_EVENT, type NodeReferenceRequest } from './materialx/node-reference.ts';
import { NodeReferencePanel } from './materialx/node-reference-panel.ts';
import { nodePreviewScript } from './materialx/node-preview.ts';
import { isBakeableGraphOutputType } from './materialx/bake.ts';
import { activityButton } from './ui/layout.ts';
import { Workbench } from './ui/workbench.ts';
import { loadScriptLibrary, runScript, ScriptError, toXml, type ScriptHost, type ScriptStats } from './materialx/script-api.ts';
import { downloadBlob } from './assets/download.ts';
import { DiagnosticJournal } from './diagnostics/journal.ts';
import type { ResolvedGraph } from './materialx/graph.ts';
import { captureRgba } from './gpu/capture.ts';
import { describeGpuCapabilities, isMobileGpu } from './gpu/capabilities.ts';
import type { PathTraceView } from './render/pathtracing/display.ts';
import type { SceneLoadOptions } from './render/usd-scene-assets.ts';
import { lightingPreset } from './render/lighting-presets.ts';
import { captureTurntable } from './render/turntable.ts';
import { decodeProject, encodeProject, projectCamera, restoreCamera, type Project } from './project.ts';
import type { ScriptStage } from './materialx/script-api.ts';
import { History } from './history.ts';

/** In-memory entry of the scene built by a script's primitives (never fetched). */
const scriptStageEntry = (): string => new URL('./__script_stage__/scene.usda', document.baseURI).href;

let ui: ViewerUiState | undefined;
let statusIsError = false;

function setDiagnostics(kind: 'shader' | 'import', text: string): void {
  const messages = document.getElementById(`${kind}-messages`);
  if (messages) messages.textContent = text;
  const panel = document.getElementById(`${kind}-diagnostics`);
  if (panel) panel.hidden = !text;
}

function showBusy(busy: boolean): void {
  const indicator = document.getElementById('busy-indicator');
  if (indicator) indicator.hidden = !busy;
  document.getElementById('view')?.setAttribute('aria-busy', String(busy));
}

function setBusyMessage(text: string): void {
  const indicator = document.getElementById('busy-indicator');
  if (indicator && text) indicator.textContent = text;
  if (ui) ui.busyMessage = text;
}

function setStatus(text: string, error = true): void {
  statusIsError = error && text.length > 0;
  if (ui) ui.error = statusIsError ? text : '';
  if (!statusIsError) setBusyMessage(text);
  const output = document.getElementById('status');
  if (output) { output.textContent = text; output.hidden = !statusIsError; }
  if (statusIsError) showBusy(false);
}

async function main(): Promise<void> {
  // The script editor works without WebGPU; applying a material needs the viewer.
  let applyScriptMaterial: ((xml: string) => Promise<void>) | undefined;
  let selectedMaterial: (() => { graph: ResolvedGraph; name: string }) | undefined;
  let viewerHost: ScriptHost | undefined;
  let sceneRevision = 0;
  let turntableController: AbortController | undefined;
  const readyHost = (): ScriptHost => {
    if (!viewerHost) throw new Error('Le viewer WebGPU n’est pas prêt.');
    if (turntableController) throw new Error('Une capture turntable est en cours.');
    return viewerHost;
  };
  // Queries answer before the viewer is ready so live validation keeps working.
  // Pause/resume of running scripts (editor toolbar, remote render server); wired once the viewer exists.
  const scriptControl: ScriptRunControl = { pause: () => false, resume: () => false, wait: () => undefined };
  const scriptHost: ScriptHost = {
    loadScene: entry => readyHost().loadScene(entry),
    loadStage: stage => readyHost().loadStage(stage),
    updateStage: stage => readyHost().updateStage(stage),
    sceneRevision: () => sceneRevision,
    objects: () => viewerHost?.objects() ?? [],
    renderSettings: () => viewerHost?.renderSettings() ?? {},
    setRenderSetting: (name, value) => readyHost().setRenderSetting(name, value),
    setEnvironmentShader: settings => readyHost().setEnvironmentShader(settings),
    setImageShader: settings => readyHost().setImageShader(settings),
    setPathTracingView: view => readyHost().setPathTracingView(view),
    assignMaterial: (object, material) => readyHost().assignMaterial(object, material),
    render: samples => readyHost().render(samples),
    saveImage: name => readyHost().saveImage(name),
    saveText: (name, text) => readyHost().saveText(name, text),
    objectMaterial: object => viewerHost?.objectMaterial(object),
    stats: () => viewerHost?.stats(),
    waitForStop: timeout => readyHost().waitForStop(timeout),
    capture: (name, options) => readyHost().capture(name, options),
    video: (name, options, signal) => readyHost().video(name, options, signal),
    saveAov: name => readyHost().saveAov(name),
    saveDiagnostics: name => readyHost().saveDiagnostics(name),
    diagnostics: () => viewerHost?.diagnostics() ?? [],
    capabilities: () => viewerHost?.capabilities(),
    timeline: () => viewerHost?.timeline(),
    time: () => viewerHost?.time() ?? 0,
    setTime: time => readyHost().setTime(time),
    setTransform: (object, matrix) => readyHost().setTransform(object, matrix),
    setVisibility: (object, visible) => readyHost().setVisibility(object, visible),
    lights: () => viewerHost?.lights() ?? [],
    setLight: (light, changes) => readyHost().setLight(light, changes),
    moveLightFilter: (from, to, settings) => readyHost().moveLightFilter(from, to, settings),
    setCamera: camera => readyHost().setCamera(camera),
    variants: () => viewerHost?.variants() ?? [],
    setVariant: (path, set, variant) => readyHost().setVariant(path, set, variant),
    materialParameters: object => viewerHost?.materialParameters(object) ?? [],
    setMaterialParameters: (object, values) => readyHost().setMaterialParameters(object, values),
    log: message => console.info(`[script] ${message}`),
  };
  const scriptLibrary = loadScriptLibrary(new URL(`${import.meta.env.BASE_URL}materialx/libraries`, document.baseURI).href);
  const scriptFilePrefix = new URL('.', document.baseURI).href;
  // Validation scripts of docs/SCRIPTING.md; the label is the first comment line.
  const validationScripts = Object.entries(import.meta.glob<string>('../examples/scripts/*.js', { query: '?raw', import: 'default', eager: true }))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, code]) => ({ label: /^\/\/\s*(.+?)\s*(?:\(|$)/m.exec(code)?.[1] ?? path.split('/').at(-1)!, code }));
  // Dockview can detach inactive tabs from the document while restoring a saved layout.
  function required<T>(element: T | null): T {
    if (!element) throw new Error('Viewer controls are missing.');
    return element;
  }
  const viewContainer = required(document.querySelector<HTMLElement>('#canvas-container'));
  const canvas = required(viewContainer.querySelector<HTMLCanvasElement>('#view'));
  const uiCanvas = required(document.querySelector<HTMLCanvasElement>('#ui'));
  const timelineBar = required(viewContainer.querySelector<HTMLElement>('#view-timeline'));
  const timelinePlay = required(viewContainer.querySelector<HTMLButtonElement>('#view-timeline-play'));
  const timelineTime = required(viewContainer.querySelector<HTMLInputElement>('#view-timeline-time'));
  const timelineValue = required(viewContainer.querySelector<HTMLOutputElement>('#view-timeline-value'));
  // Dockable workbench: render view, interactive controls (F3), material graph and script editor (F2).
  const panelContent = (id: string): HTMLElement => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Élément #${id} introuvable.`);
    return element;
  };
  let scriptEditor: ScriptEditorAttachment | undefined;
  const nodeReference = new NodeReferencePanel({
    library: scriptLibrary,
    async openExample(code) {
      if (!scriptEditor) throw new Error('L’éditeur de script MaterialX n’est pas prêt.');
      await scriptEditor.toggle(true);
      const editor = await scriptEditor.editor;
      editor.script = code;
      editor.focus();
    },
  });
  const workbench = new Workbench(document.getElementById('workbench')!, [
    { id: 'view', title: 'Vue', create: () => panelContent('canvas-container'), placement: { direction: 'within' }, visible: true },
    { id: 'render', title: 'Rendu interactif', create: () => panelContent('ui'), placement: { direction: 'left', size: 380 }, visible: true },
    { id: 'graph', title: 'Graphe du matériau', create: () => panelContent('material-graph'), placement: { direction: 'below', size: 440 } },
    { id: 'nodes', title: 'Référence des nœuds', create: () => nodeReference.element, placement: { direction: 'right', size: 420 } },
  ]);
  // The material graph shows in its panel (non-modal); closing either closes the other.
  const materialGraph = panelContent('material-graph') as HTMLDialogElement;
  setMaterialGraphPresenter((dialog) => {
    workbench.show('graph');
    if (!dialog.open) dialog.show();
  });
  materialGraph.addEventListener('close', () => workbench.hide('graph'));
  workbench.onVisibilityChange((id, visible) => {
    if (id === 'graph' && !visible && materialGraph.open) materialGraph.close();
    if (id === 'nodes') nodeReference.setVisible(visible);
  });
  // Activity bar: panel toggles and material tools.
  for (const [id, panel, name, label, caption, shortcut] of [
    ['toggle-view-panel', 'view', 'monitor', 'Vue de rendu', 'Vue', undefined],
    ['toggle-render-panel', 'render', 'sliders', 'Rendu interactif : scène, rendu, matériaux (F3)', 'Rendu', 'F3'],
    ['toggle-node-reference-panel', 'nodes', 'book', 'Référence des nœuds MaterialX', 'Nœuds', undefined],
  ] as const) {
    const button = document.getElementById(id);
    if (!(button instanceof HTMLButtonElement)) continue;
    activityButton(button, name, label, caption);
    button.setAttribute('aria-pressed', String(workbench.isVisible(panel)));
    button.addEventListener('click', () => workbench.toggle(panel));
    workbench.onVisibilityChange((changed, visible) => { if (changed === panel) button.setAttribute('aria-pressed', String(visible)); });
    if (shortcut) {
      document.addEventListener('keydown', (event) => {
        if (event.key !== shortcut) return;
        event.preventDefault();
        workbench.toggle(panel);
      });
    }
  }
  document.addEventListener(NODE_REFERENCE_EVENT, event => {
    const request = (event as CustomEvent<NodeReferenceRequest>).detail;
    nodeReference.open(request.category, request.nodeDef);
    workbench.show('nodes');
  });
  for (const [id, name, label, caption] of [
    ['open-material-library', 'book', 'Bibliothèque de matériaux de l’objet sélectionné', 'Matériaux'],
    ['open-material-graph', 'graph', 'Graphe du matériau de l’objet sélectionné', 'Graphe'],
    ['export-diagnostics', 'pulse', 'Exporter les diagnostics : journal, capacités et mémoire GPU (JSON)', 'Diagnostics'],
  ] as const) {
    const button = document.getElementById(id);
    if (button instanceof HTMLButtonElement) activityButton(button, name, label, caption);
  }
  scriptEditor = attachScriptEditor(document.getElementById('activity-panels'), {
    workbench,
    library: scriptLibrary,
    filePrefix: scriptFilePrefix,
    examples: validationScripts,
    runControl: scriptControl,
    remoteView: viewContainer,
    selectedObject: () => state.objectPath,
    onApply: (xml) => {
      if (!applyScriptMaterial) throw new Error('Le viewer WebGPU n’est pas prêt.');
      return applyScriptMaterial(xml);
    },
    currentMaterial: () => {
      if (!selectedMaterial) throw new Error('Le viewer WebGPU n’est pas prêt.');
      return selectedMaterial();
    },
    host: scriptHost,
  });
  const params = new URLSearchParams(location.search);
  const initialEntry = params.get('entry') ?? (SCENE_CATALOG[0] ?? SOURCE_SCENE_CATALOG[0]!).entry;
  const initialBackend = params.get('backend') ?? 'raster';
  const resolutionParam = params.get('res') ?? '128';
  const initialResolution = resolutionParam === '1024x768' ? resolutionParam : Number(resolutionParam);
  const scenePath = initialEntry.replace(/^\.\//, '/');
  if (!scenePath.startsWith('/scenes/') || scenePath.split('/').includes('..') ||
      !(/\.((usda?)|gltf|glb)$/i.test(scenePath) || /\/scene\.json$/i.test(scenePath))) {
    throw new Error('Invalid scene entry: expected USD, glTF, GLB or scene.json under /scenes/.');
  }
  if (initialBackend !== 'raster' && initialBackend !== 'pathtracing' && initialBackend !== 'disney') throw new Error('Unsupported backend.');
  if (initialResolution !== '1024x768' && ![128, 256, 512, 1024].includes(initialResolution)) throw new Error('Interactive resolution must be 128, 256, 512, 1024 or 1024x768.');
  if (!('gpu' in navigator)) { setStatus('WebGPU is not available in this browser.'); return; }
  const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | undefined> =>
    Promise.race([promise, new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), ms))]);
  async function requestGpu(): Promise<{ adapter: GPUAdapter; device: GPUDevice } | undefined> {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      const adapter = await withTimeout(navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }), 10000);
      const device = adapter ? await withTimeout(adapter.requestDevice(sceneDeviceDescriptor(adapter)), 10000) : undefined;
      if (adapter && device) return { adapter, device };
    }
    return undefined;
  }
  const gpu = await requestGpu();
  if (!gpu) { setStatus('No WebGPU adapter found.'); return; }
  const { device } = gpu;
  // Replaced after a device loss; script operations use the current one.
  let currentGpu = gpu;
  (globalThis as { __mxGpu?: unknown }).__mxGpu = gpu;
  async function captureScriptPreview(
    code: string, objectPath: string, signal: AbortSignal, material?: { path: string; compiled?: string }, size = 256,
  ) {
    const previewViewer = new InteractiveViewer({
      device: currentGpu.device, width: size, height: size, outputFormat: 'rgba8unorm',
    });
    const entry = new URL('./__node_reference__/scene.usda', document.baseURI).href;
    let stageLoad: Promise<void> | undefined;
    let runFailed = false;
    const previewHost: ScriptHost = {
      ...scriptHost,
      loadStage(stage) {
        stageLoad = (async () => {
          signal.throwIfAborted();
          const { importUsdaLayer } = await import('./render/usd-scene-assets.ts');
          const imported = await importUsdaLayer(entry, stage.usda, stage.materials);
          signal.throwIfAborted();
          await previewViewer.load(entry, new Map(), false, { imported });
        })();
        return stageLoad;
      },
    };
    try {
      await runScript(code, await scriptLibrary, { host: previewHost, signal });
      if (stageLoad) await stageLoad;
      signal.throwIfAborted();
      if (material) {
        const path = new URL(material.path, document.baseURI).href;
        const compiled = material.compiled ? new URL(material.compiled, document.baseURI).href : undefined;
        await previewViewer.setObjectMaterial(objectPath, path, compiled);
      }
      return await previewViewer.captureObjectMaterialPreview(objectPath, {
        target: 'object', backend: 'raster',
      }, signal);
    } catch (error) {
      runFailed = true;
      throw error;
    } finally {
      let stageFailure: unknown;
      if (stageLoad) {
        try { await stageLoad; } catch (error) { stageFailure = error; }
      }
      previewViewer.dispose();
      if (stageFailure !== undefined && !runFailed && !signal.aborted) throw stageFailure;
      if (stageFailure !== undefined && signal.aborted) {
        console.warn('Node reference preview stage failed after cancellation.', stageFailure);
      }
    }
  }
  nodeReference.setPreviewRenderer((code, signal) => captureScriptPreview(code, '/World/previewSphere', signal));
  let deviceLost = false;
  const journal = new DiagnosticJournal();
  const reportGpuError = (event: Event): void => {
    const message = (event as GPUUncapturedErrorEvent).error.message;
    journal.record({ level: 'error', code: 'uncaptured-gpu-error', message });
    console.error(`WebGPU error: ${message}`);
    if (ui) {
      ui.shaderErrors += `${ui.shaderErrors ? '\n\n' : ''}WebGPU - validation\n${message}`;
      setDiagnostics('shader', ui.shaderErrors);
    }
    setStatus(`WebGPU : ${message}`);
  };
  device.addEventListener('uncapturederror', reportGpuError);
  canvas.width = initialResolution === '1024x768' ? 1024 : initialResolution;
  canvas.height = initialResolution === '1024x768' ? 768 : initialResolution;
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('No WebGPU canvas context.');
  const outputFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: outputFormat, alphaMode: 'opaque' });
  const localFiles = document.getElementById('local-scene-files') as HTMLInputElement | null;
  const localFolder = document.getElementById('local-scene-folder') as HTMLInputElement | null;
  let localScene: LocalGltfScene | undefined;
  /** Scene of the last script's primitives, reloadable from the scene list. */
  let scriptStage: SceneLoadOptions | undefined;
  let projectStage: ScriptStage | undefined;
  const state: ViewerUiState = {
    entry: initialEntry, scenes: [...SCENE_CATALOG], resolution: initialResolution, pathTracingDepth: 12,
    rasterQuality: 'interactive', backend: initialBackend, environmentEnabled: true, denoise: false,
    exposure: 0, tonemap: 'acesFilmic',
    status: undefined, busy: true, busyMessage: 'Initialisation...', error: '', shaderErrors: '', warnings: '',
    objectPath: '', objects: [], materialFolderPath: [], materialTree: buildMaterialTree(MATERIAL_CATALOG), materialPath: '',
    turntable: { lights: [], running: false, message: '' },
  };
  function syncTimeline(): void {
    const animation = state.animation;
    const timeline = animation?.timeline;
    timelineBar.hidden = !timeline;
    timelinePlay.disabled = state.busy;
    timelineTime.disabled = state.busy;
    if (!animation || !timeline) return;
    timelinePlay.textContent = animation.playing ? 'Arrêter' : 'Lire';
    timelineTime.min = String(timeline.start);
    timelineTime.max = String(timeline.end);
    timelineTime.value = String(animation.time);
    timelineValue.value = `${animation.time.toFixed(1)} / ${timeline.end}`;
  }
  ui = state;
  if (!state.scenes.some(scene => scene.entry === initialEntry)) state.scenes.push({ entry: initialEntry, label: initialEntry });
  let operationBusy = false;
  let hasLoadedScene = false;
  let sceneChanging = false;
  let shaderBusy = false;
  let shaderBusyMessage = 'Préparation du path tracer...';
  const viewerCallbacks: Pick<ConstructorParameters<typeof InteractiveViewer>[0], 'onStatus' | 'onShaderErrors' | 'onDiagnostic'> = {
    onDiagnostic: diagnostic => {
      journal.record(diagnostic);
      if (diagnostic.level === 'error') console.error(diagnostic.message, diagnostic.detail ?? '');
      else if (diagnostic.level === 'warning') console.warn(diagnostic.message, diagnostic.detail ?? '');
    },
    onStatus: status => {
      if (deviceLost) return;
      state.status = status;
      state.backend = status.backend;
      state.environmentEnabled = status.environmentEnabled;
      const pathTracerBackend = status.backend === 'pathtracing' || status.backend === 'disney';
      const spp = document.getElementById('pathtracing-spp');
      if (spp) {
        spp.hidden = !pathTracerBackend || status.pathTracer !== 'ready';
        const unit = status.backend === 'pathtracing' && status.pathTracingAdaptive ? 'balayages' : 'spp';
        spp.textContent = `${status.samples} ${unit}${status.pathTracingPaused ? ' (pause)' : ''}`;
      }
      if (status.loading && operationBusy) {
        const { stage, pendingGeometry, pendingTextures } = status.loading;
        setBusyMessage(stage === 'geometry' ? `Aperçu : ${pendingGeometry} géométries à charger...`
          : `Matériaux : ${pendingTextures} textures à charger...`);
      }
      if (status.fallback && !sceneChanging) setStatus(`Rendu raster à la place du ${status.fallback.from === 'disney' ? 'path tracer Disney' : 'path tracer'} : ${status.fallback.reason}`);
      shaderBusy = pathTracerBackend && (status.pathTracer === 'idle' || status.pathTracer === 'compiling');
      if (shaderBusy) {
        const tracerName = status.backend === 'disney' ? 'path tracer Disney' : 'path tracer';
        shaderBusyMessage = status.pathTracer === 'compiling'
          ? `Compilation des shaders du ${tracerName}...`
          : `Préparation du ${tracerName}...`;
        if (!operationBusy) setBusyMessage(shaderBusyMessage);
      } else if (!operationBusy) setBusyMessage('');
      showBusy(operationBusy || shaderBusy);
      if (!sceneChanging && pathTracerBackend && status.pathTracer === 'error') {
        const tracerName = status.backend === 'disney' ? 'path tracer Disney' : 'path tracer';
        setStatus(`Echec de preparation ou de compilation du ${tracerName}. Consulter les erreurs WGSL.`);
      }
      else if (!sceneChanging && status.backend === 'pathtracing' && status.denoiser.state === 'error') setStatus(`Echec denoiser JS : ${status.denoiser.error}`);
    },
    onShaderErrors: errors => {
      for (const error of errors) {
        journal.record({ level: 'error', code: error.line > 0 ? 'shader-compilation' : 'backend-preparation', message: `${error.shader}: ${error.message}` },
          { name: error.shader, line: error.line, column: error.column, source: error.source });
      }
      state.shaderErrors = errors.map(error => `${error.shader}${error.line > 0 ? ` (${error.line}:${error.column})` : ''}\n${error.message}${error.source ? `\n> ${error.source}` : ''}`).join('\n\n');
      setDiagnostics('shader', state.shaderErrors);
    },
  };
  let viewer = new InteractiveViewer({ device, context, outputFormat, canvas, streaming: true, ...viewerCallbacks });
  let historyNotice = '';
  const history = new History(() => {
    state.history = { ...(history.undoLabel ? { undo: history.undoLabel } : {}),
      ...(history.redoLabel ? { redo: history.redoLabel } : {}),
      ...(historyNotice ? { notice: historyNotice } : {}), busy: history.busy };
  });
  state.history = { busy: false };
  const forgetHistory = (): void => {
    if (history.undoLabel || history.redoLabel) historyNotice = 'Historique effacé : opération non restaurable.';
    history.clear();
  };
  function materialSnapshot(path: string) {
    const material = viewer.projectMaterial(path);
    if (!material) throw new Error(`Le matériau de ${path} ne possède pas de graphe restaurable.`);
    return material;
  }
  async function stopPlayback(): Promise<void> {
    if (state.animation?.playing) {
      state.animation.playing = false;
      cancelPlayback();
      syncTimeline();
    }
    await Promise.all([...pendingTimeUpdates]);
  }
  async function recordHistory<T>(label: string, read: () => T, apply: (value: T) => void | Promise<void>, edit: () => void | Promise<void>): Promise<void> {
    await stopPlayback();
    historyNotice = '';
    await history.record(label, read, apply, edit);
  }
  async function recordMaterial(path: string, label: string, edit: () => Promise<void>): Promise<void> {
    await recordHistory(label, () => materialSnapshot(path), async material => {
      await viewer.restoreProjectMaterials([[path, material]]);
    }, edit);
    refreshAnimation();
  }
  const exportDiagnostics = document.querySelector<HTMLButtonElement>('#export-diagnostics');
  const diagnosticsJson = (): string =>
    journal.export({ scene: state.entry, backend: viewer.backend, gpuMemory: viewer.gpuMemory, status: state.status });
  if (exportDiagnostics) {
    exportDiagnostics.hidden = false;
    exportDiagnostics.onclick = () => {
      downloadBlob(new Blob([diagnosticsJson()], { type: 'application/json' }), `materialx-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    };
  }
  viewer.setBackend(initialBackend);

  const graphButton = document.querySelector<HTMLButtonElement>('#open-material-graph');
  const graphDialog = document.querySelector<HTMLDialogElement>('#material-graph');
  const libraryButton = document.querySelector<HTMLButtonElement>('#open-material-library');
  const libraryDialog = document.querySelector<HTMLDialogElement>('#material-library');
  if (graphButton && graphDialog) {
    graphButton.onclick = () => {
      const path = state.objectPath;
      const target = viewer;
      const material = target.objects.find(object => object.path === path)?.material ?? '';
      function ensureEditable() {
        if (operationBusy || deviceLost || viewer !== target || state.objectPath !== path) {
          throw new Error('Le matériau ne peut pas être modifié pendant cette opération.');
        }
      }
      async function editMaterial(message: string, edit: () => Promise<void>) {
        ensureEditable();
        setBusy(true, message);
        try { await recordMaterial(path, 'Modification du matériau', edit); }
        finally { setBusy(false); }
      }
      async function editGraph(edit: () => Promise<void>) {
        await editMaterial('Compilation du graphe du matériau...', edit);
        const updated = target.objectSurfaceGraph(path);
        if (!updated) throw new Error('Graphe de surface indisponible après recompilation.');
        return updated;
      }
      showMaterialGraph(graphDialog, target.objectSurfaceGraph(path), material, {
        parameters: nodeId => target.objectParameters(path, nodeId),
        nodeDefinitions: () => target.objectNodeDefinitions(path),
        outputs: (nodeId, input) => target.objectGraphOutputs(path, nodeId, input),
        diagnostics: nodeId => target.objectSurfaceInputDiagnostics(path, nodeId),
        backendDiagnostics: () => target.objectMaterialBackendDiagnostics(path),
        async apply(changes) {
          await editMaterial('Application des paramètres du matériau...', () => target.setObjectParameters(path, changes));
          return target.objectSurfaceGraph(path);
        },
        canUnlinkInput: (nodeId, input) => target.canUnlinkObjectGraphInput(path, nodeId, input),
        setInputLink: (nodeId, input, sourceId, output) =>
          editGraph(() => target.setObjectGraphInputLink(path, nodeId, input, sourceId, output)),
        setInputValue: (nodeId, input, value) =>
          editGraph(() => target.setObjectGraphInputValue(path, nodeId, input, value)),
        addNode: (nodeId, input, nodeDef, output) =>
          editGraph(() => target.addObjectNode(path, nodeId, input, nodeDef, output)),
        addNodeDownstream: (sourceId, output, nodeDef, input) =>
          editGraph(() => target.addObjectNodeDownstream(path, sourceId, output, nodeDef, input)),
        variants: () => target.objectMaterialVariants(path),
        variantGraph: slot => target.objectMaterialVariantGraph(path, slot),
        textureSource: file => target.objectTextureExportSource(path, file),
        bakeMaterial: (width, height) => target.bakeObjectMaterial(path, width, height),
        exportSceneGlb: () => target.exportSceneGlb(),
        exportSceneUsd: () => target.exportSceneUsd(),
        saveVariant(slot) {
          ensureEditable();
          target.saveObjectMaterialVariant(path, slot);
        },
        applyVariant: slot => editGraph(() => target.applyObjectMaterialVariant(path, slot)),
        capturePreview(options, signal) {
          ensureEditable();
          return target.captureObjectMaterialPreview(path, options, signal);
        },
        async captureNodePreview(snapshot, nodeId, output, signal) {
          ensureEditable();
          const node = snapshot.nodes.get(nodeId);
          const outputType = node?.nodeDef?.outputs?.find(candidate => candidate.name === output)?.type ?? node?.type;
          if (outputType && isBakeableGraphOutputType(outputType)) {
            return target.captureNodeOutputPreview(snapshot, nodeId, output, signal);
          }
          const code = nodePreviewScript(snapshot, nodeId, output, await scriptLibrary);
          return captureScriptPreview(code, '/World/mxPreviewSphere', signal, undefined, 128);
        },
        async captureVariants(options, signal) {
          ensureEditable();
          setBusy(true, 'Calcul des aperçus A/B…');
          try { return await target.captureObjectMaterialVariants(path, options, signal); }
          finally { setBusy(false); }
        },
      }, undefined, path);
    };
  }
  const parameterEditor = new MaterialParameterEditor({
    parameters: () => viewer.objectParameters(state.objectPath),
    graph: () => viewer.objectSurfaceGraph(state.objectPath),
    apply: async changes => {
      const path = state.objectPath;
      setBusy(true, 'Application des paramètres du matériau...');
      try { await recordMaterial(path, 'Paramètres du matériau', () => viewer.setObjectParameters(path, changes)); }
      finally { setBusy(false); }
    },
    error: error => setStatus(`Echec du paramètre : ${error instanceof Error ? error.message : String(error)}`),
  });

  function setBusy(busy: boolean, message?: string): void {
    operationBusy = busy;
    state.busy = busy;
    syncTimeline();
    if (graphButton) graphButton.disabled = busy;
    if (libraryButton) libraryButton.disabled = busy;
    if (busy) setStatus('', false);
    if (busy && message) setBusyMessage(message);
    if (!busy && !statusIsError) setStatus('', false);
    if (!busy && shaderBusy) setBusyMessage(shaderBusyMessage);
    showBusy(!statusIsError && (operationBusy || shaderBusy));
    if (localFiles) localFiles.disabled = busy;
    if (localFolder) localFolder.disabled = busy;
  }

  function refreshMaterialSelection(): void {
    const selected = viewer.objects.find(object => object.path === state.objectPath)?.assetPath;
    const material = MATERIAL_CATALOG.find(item => new URL(item.path, document.baseURI).href === selected);
    state.materialPath = material?.path ?? '';
    state.materialFolderPath = material ? material.path.split('/mtlx-library/')[1]!.split('/').slice(0, -1) : [];
    if (graphButton) graphButton.hidden = !state.objectPath;
    if (libraryButton) libraryButton.hidden = !state.objectPath;
    if (graphDialog?.open) graphDialog.close();
    if (libraryDialog?.open) libraryDialog.close();
    parameterEditor.refresh();
  }

  let playbackFrame = 0;
  let playbackVersion = 0;
  let timeSeekVersion = 0;
  function cancelPlayback(): void {
    playbackVersion++;
    cancelAnimationFrame(playbackFrame);
  }
  const pendingTimeUpdates = new Set<Promise<void>>();
  function updateTime(target: InteractiveViewer, time: number): Promise<void> {
    const update = target.setTime(time);
    pendingTimeUpdates.add(update);
    void update.then(() => pendingTimeUpdates.delete(update), () => pendingTimeUpdates.delete(update));
    return update;
  }
  function refreshAnimation(): void {
    cancelPlayback();
    const timeline = viewer.timeline;
    const variantSets = viewer.variantSets;
    const range = timeline?.animated ? { start: timeline.start, end: timeline.end, timeCodesPerSecond: timeline.timeCodesPerSecond }
      : viewer.hasTimeDependentMaterial ? { start: Math.min(0, viewer.time), end: Math.max(240, viewer.time + 24), timeCodesPerSecond: 24 } : undefined;
    state.animation = range || variantSets.length ? {
      ...(range ? { timeline: range } : {}),
      time: viewer.time, playing: false, temporalHistory: viewer.pathTracingTemporalHistory, variantSets,
    } : undefined;
    syncTimeline();
  }

  function play(previous: number, target: InteractiveViewer, version = playbackVersion): void {
    playbackFrame = requestAnimationFrame(now => {
      const animation = state.animation;
      const timeline = animation?.timeline;
      if (!animation?.playing || !timeline || viewer !== target || deviceLost || version !== playbackVersion) return;
      if (!operationBusy) {
        let time = animation.time + Math.min(0.25, (now - previous) / 1000) * timeline.timeCodesPerSecond;
        if (time > timeline.end) time = timeline.start;
        animation.time = time;
        syncTimeline();
        void updateTime(target, time).then(() => {
          if (animation.playing && version === playbackVersion) play(now, target, version);
        }, (error: unknown) => {
          if (version === playbackVersion) {
            animation.playing = false;
            syncTimeline();
          }
          setStatus(`Echec de l'animation : ${error instanceof Error ? error.message : String(error)}`);
        });
        return;
      }
      play(now, target, version);
    });
  }

  function refreshObjects(): void {
    state.objects = viewer.objects;
    if (state.turntable) state.turntable.lights = viewer.lights.filter(light => light.type !== 'dome' && light.type !== 'unknown');
    if (!state.objects.some(object => object.path === state.objectPath)) state.objectPath = state.objects[0]?.path ?? '';
    refreshMaterialSelection();
  }

  selectedMaterial = () => {
    if (!state.objectPath) throw new Error('Sélectionner d’abord un objet de la scène.');
    const graph = viewer.objectSurfaceGraph(state.objectPath);
    if (!graph) throw new Error('L’objet sélectionné n’a pas de graphe MaterialX.');
    const name = viewer.objects.find(object => object.path === state.objectPath)?.material ?? 'material';
    return { graph, name: name.split('/').filter(Boolean).at(-1) ?? 'material' };
  };
  applyScriptMaterial = async (xml) => {
    if (operationBusy || deviceLost) throw new Error('Une opération du viewer est en cours.');
    if (!state.objectPath) throw new Error('Sélectionner d’abord un objet de la scène.');
    // The viewer re-reads the document whenever the scene reloads, so the URL is kept alive.
    const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
    forgetHistory();
    setBusy(true, 'Application du matériau scripté...');
    try { await viewer.setObjectMaterial(state.objectPath, url); }
    finally {
      refreshObjects();
      refreshAnimation();
      setBusy(false);
    }
  };

  async function loadEntry(entry: string, preserveCamera = false): Promise<boolean> {
    forgetHistory();
    sceneChanging = hasLoadedScene;
    if (sceneChanging) {
      state.shaderErrors = '';
      state.warnings = '';
      setDiagnostics('shader', '');
      setDiagnostics('import', '');
    }
    setBusy(true, `Chargement de ${entry}...`);
    let imported: LocalGltfScene | undefined;
    try {
      const config = SCENE_CATALOG.find(scene => scene.entry === entry);
      const url = new URL(entry, document.baseURI).href;
      if (/\.(gltf|glb)$/i.test(new URL(url).pathname)) {
        const { importLocalGltf } = await import('./scene/local-gltf.ts');
        imported = await importLocalGltf([], undefined, url);
      }
      await viewer.load(url, new Map(), preserveCamera, {
        ...(imported ? imported.options : {}),
        ...(!imported && localScene?.entry === entry ? localScene.options : {}),
        ...(scriptStage && entry === scriptStageEntry() ? scriptStage : {}),
        ...(config?.textureRoot ? { textureRoot: new URL(config.textureRoot, document.baseURI).href } : {}),
      });
      sceneRevision++;
      state.entry = entry;
      state.pathTracingDepth = viewer.pathTracingDepth;
      refreshObjects();
      refreshAnimation();
      if (localScene && (imported || localScene.entry !== entry)) {
        state.scenes = state.scenes.filter(scene => scene.entry !== localScene?.entry || !scene.label.startsWith('Local - '));
        localScene.dispose();
        localScene = undefined;
      }
      if (imported) localScene = imported;
      state.warnings = localScene?.warnings.join('\n\n') ?? '';
      setDiagnostics('import', state.warnings);
      hasLoadedScene = true;
      return true;
    } catch (error) {
      imported?.dispose();
      if (!deviceLost) setStatus(`Echec du chargement: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      sceneChanging = false;
      setBusy(false);
    }
  }

  async function openLocalFiles(input: HTMLInputElement): Promise<void> {
    const files = Array.from(input.files ?? []);
    if (!files.length) return;
    parameterEditor.refresh();
    setBusy(true, 'Import des fichiers glTF...');
    let imported: LocalGltfScene | undefined;
    const previous = localScene;
    try {
      const { importLocalGltf } = await import('./scene/local-gltf.ts');
      imported = await importLocalGltf(files);
      localScene = imported;
      if (!await loadEntry(imported.entry)) {
        localScene = previous;
        imported.dispose();
        return;
      }
      state.scenes = state.scenes.filter(scene => scene.entry !== previous?.entry);
      state.scenes.push({ label: `Local - ${imported.name}`, entry: imported.entry });
      previous?.dispose();
    } catch (error) {
      localScene = previous;
      imported?.dispose();
      console.error('Local glTF import failed:', error);
      setStatus(`Echec de l'import glTF : ${error instanceof Error ? error.message : String(error)}`);
    } finally { input.value = ''; setBusy(false); }
  }
  localFiles?.addEventListener('change', () => void openLocalFiles(localFiles));
  localFolder?.addEventListener('change', () => void openLocalFiles(localFolder));

  async function operation(message: string, action: () => Promise<void>): Promise<void> {
    setBusy(true, message);
    try { await action(); }
    catch (error) { setStatus(`${message} ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  }
  function recordUi<T>(label: string, read: () => T, apply: (value: T) => void | Promise<void>, value: T): void {
    void operation(`${label} :`, () => recordHistory(label, read, apply, () => apply(value)));
  }
  function traverseHistory(direction: 'undo' | 'redo'): void {
    if (operationBusy || deviceLost || history.busy) return;
    void operation(direction === 'undo' ? 'Annulation :' : 'Rétablissement :', async () => {
      await stopPlayback();
      await history[direction]();
      refreshObjects();
      refreshAnimation();
    });
  }
  const actions: ViewerUiActions = {
    undo: () => traverseHistory('undo'),
    redo: () => traverseHistory('redo'),
    scene: entry => { parameterEditor.refresh(); void loadEntry(entry); },
    resolution: size => { void operation('Redimensionnement du rendu...', async () => {
      forgetHistory();
      await viewer.resize(size === '1024x768' ? 1024 : size, size === '1024x768' ? 768 : size);
      state.resolution = size;
    }); },
    pathTracingDepth: depth => {
      forgetHistory();
      viewer.setPathTracingDepth(depth);
      state.pathTracingDepth = viewer.pathTracingDepth;
    },
    quality: quality => recordUi('Profil raster', () => viewer.rasterQuality, async value => { await viewer.setRasterQuality(value); state.rasterQuality = value; }, quality),
    backend: backend => recordUi('Moteur de rendu', () => viewer.backend, value => { viewer.setBackend(value); state.backend = value; }, backend),
    environment: enabled => recordUi('Environnement', () => state.environmentEnabled, value => { viewer.setEnvironmentEnabled(value); state.environmentEnabled = value; }, enabled),
    lightingPreset: preset => {
      const read = () => ({ shader: viewer.projectShaders.environment, enabled: state.environmentEnabled });
      const apply = async (value: ReturnType<typeof read>) => {
        await viewer.setEnvironmentShader(value.shader);
        viewer.setEnvironmentEnabled(value.enabled);
        state.environmentEnabled = value.enabled;
        refreshAnimation();
      };
      recordUi('Éclairage', read, apply, { shader: preset === 'scene' ? undefined : lightingPreset(preset),
        enabled: preset === 'scene' ? state.environmentEnabled : true });
    },
    turntable: options => {
      if (operationBusy || deviceLost || turntableController) return;
      const target = viewer;
      const controller = new AbortController();
      const panel = state.turntable!;
      turntableController = controller;
      panel.running = true;
      panel.message = 'Préparation de la capture…';
      if (state.animation?.playing) {
        state.animation.playing = false;
        cancelPlayback();
      }
      const pointerEvents = canvas.style.pointerEvents;
      canvas.style.pointerEvents = 'none';
      setBusy(true, 'Capture turntable…');
      void (async () => {
        try {
          if (target.backend !== 'pathtracing') throw new Error('Sélectionnez le path tracing.');
          if (outputFormat !== 'rgba8unorm' && outputFormat !== 'bgra8unorm') throw new Error('Format de sortie non pris en charge.');
          const check = () => {
            controller.signal.throwIfAborted();
            if (deviceLost || viewer !== target) throw new Error('Périphérique ou scène perdu pendant la capture.');
          };
          await Promise.all([...pendingTimeUpdates]);
          check();
          const rotation = target.turntable(options.target, options.path);
          const images = await captureTurntable({
            ...options, signal: controller.signal, ...rotation,
            progress: (done, total) => {
              panel.message = `Capture turntable : ${done} / ${total} images.`;
              setBusyMessage(panel.message);
            },
            capture: async () => {
              const image = await captureRgba(currentGpu.device, canvas.width, canvas.height, {
                pathTrace: view => target.renderPathTraceTo(view, options.samples, undefined, check),
              }, check, outputFormat);
              const offscreen = new OffscreenCanvas(image.width, image.height);
              const context = offscreen.getContext('2d');
              if (!context) throw new Error('Encodage PNG indisponible.');
              context.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
              const blob = await offscreen.convertToBlob({ type: 'image/png' });
              return new Uint8Array(await blob.arrayBuffer());
            },
          });
          check();
          if (options.frames === 1) downloadBlob(new Blob([images['turntable_001.png']!], { type: 'image/png' }), 'turntable_001.png');
          else {
            const { zipSync } = await import('three/addons/libs/fflate.module.js');
            check();
            downloadBlob(new Blob([zipSync(images, { level: 0 })], { type: 'application/zip' }), 'turntable.zip');
          }
          panel.message = 'Capture terminée : téléchargement lancé.';
        } catch (error) {
          panel.message = controller.signal.aborted ? 'Capture annulée ; aucune image téléchargée.'
            : `Échec de la capture : ${error instanceof Error ? error.message : String(error)}`;
        } finally {
          canvas.style.pointerEvents = pointerEvents;
          panel.running = false;
          turntableController = undefined;
          if (!deviceLost && viewer === target) setBusy(false);
        }
      })();
    },
    cancelTurntable: () => { turntableController?.abort(); },
    denoise: enabled => recordUi('Débruitage', () => state.denoise, value => { viewer.setPathTracingDenoise(value); state.denoise = value; }, enabled),
    compareDenoiser: enabled => viewer.setPathTracingDenoiserComparison(enabled),
    adaptive: enabled => recordUi('Échantillonnage adaptatif', () => viewer.pathTracingAdaptive, value => viewer.setPathTracingAdaptive(value), enabled),
    pathTracingView: view => recordUi('Vue de rendu', () => viewer.pathTracingView, value => viewer.setPathTracingView(value), view),
    exportAov: () => {
      const current = state.status;
      const selectedView = current?.pathTracingView;
      if (current?.backend !== 'pathtracing' || current.pathTracer !== 'ready' ||
          selectedView === undefined || selectedView === 'beauty') {
        setStatus('Sélectionnez un AOV path tracing prêt avant de l’exporter.');
        return;
      }
      void operation('Export de l’AOV...', async () => {
        await device.queue.onSubmittedWorkDone();
        await downloadDisplayedAovPng(canvas, state.entry, selectedView);
      });
    },
    exportAovHdr: () => {
      const current = state.status;
      const selectedView = current?.pathTracingView;
      if (current?.backend !== 'pathtracing' || current.pathTracer !== 'ready' ||
          selectedView === undefined || selectedView === 'beauty' || current.samples === 0) {
        setStatus('Attendez des samples dans un AOV path tracing avant de l’exporter en HDR.');
        return;
      }
      void operation('Export HDR de l’AOV...', async () => {
        const image = await viewer.readPathTracingAov();
        await downloadPathTraceAovPfm(state.entry, selectedView, image);
      });
    },
    limits: limits => recordUi('Limites de rendu', () => viewer.pathTracingLimits, value => viewer.setPathTracingLimits(value), limits),
    restartPathTracing: () => viewer.restartPathTracing(),
    exposure: value => recordUi('Exposition', () => ({
      override: viewer.snapshotState().settings.exposure, display: state.exposure,
    }), next => { viewer.setExposure(next.override); state.exposure = next.display; }, { override: value, display: value }),
    tonemap: value => recordUi('Tonemapping', () => state.tonemap, async next => { await viewer.setTonemap(next); state.tonemap = next; }, value),
    pause: () => recordUi('Pause du rendu', () => viewer.pathTracingPaused, value => viewer.setPathTracingPaused(value), !viewer.pathTracingPaused),
    openFiles: folder => (folder ? localFolder : localFiles)?.click(),
    object: path => { state.objectPath = path; refreshMaterialSelection(); },
    time: time => {
      if (!state.animation) return;
      forgetHistory();
      actions.play?.(false);
      state.animation.time = time;
      syncTimeline();
      const target = viewer;
      const version = ++timeSeekVersion;
      void (async () => {
        await Promise.all([...pendingTimeUpdates]);
        if (version === timeSeekVersion && viewer === target) await updateTime(target, time);
      })().catch((error: unknown) => setStatus(`Echec de l'animation : ${error instanceof Error ? error.message : String(error)}`));
    },
    play: playing => {
      if (!state.animation?.timeline) return;
      if (playing) forgetHistory();
      state.animation.playing = playing;
      syncTimeline();
      cancelPlayback();
      if (playing) {
        const target = viewer;
        const version = playbackVersion;
        void Promise.all([...pendingTimeUpdates]).then(() => {
          if (state.animation?.playing && viewer === target && version === playbackVersion) play(performance.now(), target, version);
        }, (error: unknown) => {
          if (version === playbackVersion && state.animation) {
            state.animation.playing = false;
            syncTimeline();
          }
          setStatus(`Echec de l'animation : ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    },
    temporalHistory: samples => recordUi('Historique temporel', () => viewer.pathTracingTemporalHistory, value => {
      viewer.setPathTracingTemporalHistory(value);
      if (state.animation) state.animation.temporalHistory = value;
    }, samples),
    variant: (path, set, variant) => { void operation('Changement de variante...', async () => {
      forgetHistory();
      const playing = state.animation?.playing ?? false;
      try { await viewer.setVariant(path, set, variant); }
      finally {
        refreshObjects();
        refreshAnimation();
        if (playing) actions.play?.(true);
      }
    }); },
    material: path => { void operation('Application du matériau...', async () => {
      forgetHistory();
      const compiled = MATERIAL_CATALOG.find(item => item.path === path)?.compiled;
      try {
        await viewer.setObjectMaterial(
          state.objectPath,
          path ? new URL(path, document.baseURI).href : undefined,
          compiled ? new URL(compiled, document.baseURI).href : undefined,
        );
      }
      finally { refreshObjects(); refreshAnimation(); }
    }); },
  };
  timelinePlay.addEventListener('click', () => actions.play?.(!state.animation?.playing));
  timelineTime.addEventListener('input', () => actions.time?.(Number(timelineTime.value)));
  /**
   * Pause requested by the remote render server (__mxControl): the path tracer stops accumulating
   * and the running script waits before its next statement. Waits do not time out meanwhile.
   */
  let held: { resume: Promise<void>; release: () => void; tracer: boolean } | undefined;
  scriptControl.pause = () => {
    if (!held) {
      let release!: () => void;
      const resume = new Promise<void>(resolve => { release = resolve; });
      const tracer = viewer.backend !== 'raster' && !viewer.pathTracingPaused;
      if (tracer) { forgetHistory(); viewer.setPathTracingPaused(true); }
      held = { resume, release, tracer };
    }
    return true;
  };
  scriptControl.resume = () => {
    if (held) {
      if (held.tracer) { forgetHistory(); viewer.setPathTracingPaused(false); }
      held.release();
      held = undefined;
    }
    return false;
  };
  scriptControl.wait = () => held?.resume;
  /** Polls `done` every 100 ms; fails after `seconds` (paused time excluded) or when the device is lost. */
  async function waitFor(done: () => boolean, seconds: number, what: string): Promise<void> {
    let end = performance.now() + seconds * 1000;
    while (!done()) {
      if (deviceLost) throw new Error(`Périphérique WebGPU perdu pendant l’attente : ${what}.`);
      if (performance.now() > end) throw new Error(`Délai dépassé (${seconds} s) : ${what}.`);
      await new Promise(resolve => setTimeout(resolve, 100));
      if (held) end += 100;
    }
  }
  /** Lets the viewer draw the current state before an image is saved. */
  async function nextFrame(): Promise<void> {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await currentGpu.device.queue.onSubmittedWorkDone();
  }
  const projectHostBase: Pick<ScriptHost, 'loadScene' | 'loadStage' | 'objects' | 'renderSettings'> = {
    async loadScene(entry) {
      if (operationBusy || deviceLost) throw new Error('Une opération du viewer est en cours.');
      parameterEditor.refresh();
      if (!state.scenes.some(scene => scene.entry === entry)) state.scenes.push({ entry, label: entry });
      if (!await loadEntry(entry)) throw new Error(state.error || `Échec du chargement de ${entry}.`);
    },
    async loadStage(stage) {
      if (operationBusy || deviceLost) throw new Error('Une opération du viewer est en cours.');
      parameterEditor.refresh();
      const entry = scriptStageEntry();
      const { importUsdaLayer } = await import('./render/usd-scene-assets.ts');
      const options = { imported: await importUsdaLayer(entry, stage.usda, stage.materials) };
      // Reloading the scripted scene (a primitive changed) keeps the camera.
      const reload = state.entry === entry;
      scriptStage = options;
      if (!state.scenes.some(scene => scene.entry === entry)) state.scenes.push({ entry, label: 'Script - primitives' });
      if (!await loadEntry(entry, reload)) throw new Error(state.error || 'Échec du chargement de la scène du script.');
      projectStage = { usda: stage.usda, materials: new Map(stage.materials) };
    },
    objects: () => viewer.objects.map(object => object.path),
    renderSettings: () => {
      const limits = viewer.pathTracingLimits;
      const budget = viewer.gpuMemory.budget;
      return {
        backend: state.backend, resolution: state.resolution, depth: state.pathTracingDepth, quality: state.rasterQuality,
        environment: state.environmentEnabled, denoise: state.denoise, exposure: state.exposure, tonemap: state.tonemap,
        view: viewer.pathTracingView, adaptive: viewer.pathTracingAdaptive, noiseTarget: limits.targetRelativeError,
        stopOnConvergence: limits.stopOnConvergence, timeBudget: limits.timeBudgetSeconds, paused: viewer.pathTracingPaused,
        compare: state.status?.denoiserComparison ?? false, temporalHistory: viewer.pathTracingTemporalHistory,
        memoryBudget: budget === undefined ? 0 : budget / 2 ** 20,
      };
    },
  };
      const projectInput = document.querySelector<HTMLInputElement>('#project-file');
      const saveProjectButton = document.querySelector<HTMLButtonElement>('#save-project');
      const openProjectButton = document.querySelector<HTMLButtonElement>('#open-project');
      if (saveProjectButton && openProjectButton && projectInput) {
        saveProjectButton.hidden = false;
        openProjectButton.hidden = false;
        openProjectButton.onclick = () => { if (!operationBusy && !deviceLost) projectInput.click(); };
        saveProjectButton.onclick = () => {
          if (operationBusy || deviceLost) return;
          void operation('Enregistrement du projet :', async () => {
            await Promise.all([...pendingTimeUpdates]);
            const snapshot = viewer.snapshotState();
            const scene = snapshot.scene;
            if (!scene || state.entry !== scriptStageEntry() || !projectStage) {
              throw new Error('Seules les scènes de primitives créées par un script sont prises en charge ; les scènes externes et glTF ne sont pas incorporées.');
            }
            if (scene.compiledOverrides.size || scene.options.variantSelections?.size) {
              throw new Error('Les matériaux compilés et sélections de variantes USD ne sont pas pris en charge.');
            }
            const overrides: Project['overrides'] = [];
            for (const [path, override] of scene.overrides) {
              const response = await fetch(override.assetPath);
              if (!response.ok) throw new Error(`Matériau inaccessible : ${override.assetPath}`);
              overrides.push([path, { xml: await response.text(), materialName: override.materialName }]);
            }
            const materials = viewer.projectMaterials();
            if ([...scene.parameters.keys()].some(path => !materials.some(([key]) => key === path))) {
              throw new Error('Un matériau modifié ne possède pas de graphe éditable.');
            }
            const project: Project = {
              format: 'materialx-webgpu-project', version: 1,
              script: (await scriptEditor!.editor).script,
              stage: { usda: projectStage.usda, materials: [...projectStage.materials] },
              overrides, materials,
              scene: { time: scene.time, camera: projectCamera(scene.orbit),
                transforms: [...scene.transforms].map(([path, matrix]) => [path, [...matrix]]),
                visibility: [...scene.visibility], lights: [...scene.lights] },
              settings: snapshot.settings, shaders: viewer.projectShaders,
              resolution: state.resolution, memoryBudget: viewer.gpuMemory.budget ?? null, objectPath: state.objectPath,
            };
            const json = encodeProject(project);
            downloadBlob(new Blob([json], { type: 'application/json' }), 'project.mxproject');
            setStatus('Projet enregistré. Le script est conservé comme texte : ses dépendances externes ne sont pas incorporées pour une réexécution.', true);
          });
        };
        projectInput.onchange = () => {
          const file = projectInput.files?.[0];
          projectInput.value = '';
          if (!file || operationBusy || deviceLost) return;
          void operation('Ouverture du projet :', async () => {
            const project = decodeProject(await file.text());
            forgetHistory();
            if (state.animation?.playing) {
              state.animation.playing = false;
              cancelPlayback();
            }
            await Promise.all([...pendingTimeUpdates]);
            const entry = scriptStageEntry();
            const { importUsdaLayer } = await import('./render/usd-scene-assets.ts');
            const stage = { usda: project.stage.usda, materials: new Map(project.stage.materials) };
            const options: SceneLoadOptions = { imported: await importUsdaLayer(entry, stage.usda, stage.materials) };
            if (options.imported!.scene.materials.some(material => !stage.materials.has(material.assetPath))) {
              throw new Error('Une référence de matériau de la scène n’est pas incorporée.');
            }
            const overrides = new Map(project.overrides.map(([path, material]) => [path, {
              assetPath: URL.createObjectURL(new Blob([material.xml], { type: 'application/xml' })), materialName: material.materialName,
            }]));
            const size = project.resolution;
            sceneRevision++;
            await viewer.resize(size === '1024x768' ? 1024 : size, size === '1024x768' ? 768 : size);
            await viewer.setMemoryBudget(project.memoryBudget ?? undefined);
            await viewer.setEnvironmentShader(project.shaders.environment);
            viewer.setImageShader(undefined);
            await viewer.restoreState({
              scene: { entry, options, overrides, compiledOverrides: new Map(), time: project.scene.time,
                orbit: restoreCamera(project.scene.camera, canvas.width / canvas.height),
                transforms: new Map(project.scene.transforms as Array<[string, import('./scene/transforms.ts').Mat4]>),
                visibility: new Map(project.scene.visibility), lights: new Map(project.scene.lights), parameters: new Map() },
              settings: project.settings,
            });
            viewer.setImageShader(project.shaders.image);
            await viewer.restoreProjectMaterials(project.materials);
            scriptStage = options;
            projectStage = stage;
            localScene?.dispose();
            localScene = undefined;
            state.entry = entry;
            if (!state.scenes.some(scene => scene.entry === entry)) state.scenes.push({ entry, label: 'Script - primitives' });
            state.resolution = size;
            state.pathTracingDepth = viewer.pathTracingDepth;
            state.rasterQuality = project.settings.rasterQuality;
            state.denoise = project.settings.denoise;
            state.exposure = project.settings.exposure ?? 0;
            state.tonemap = project.settings.tonemap;
            state.objectPath = project.objectPath;
            (await scriptEditor!.editor).script = project.script;
            refreshObjects();
            refreshAnimation();
            hasLoadedScene = true;
          });
        };
      }
  viewerHost = {
    ...projectHostBase,
    sceneRevision: () => sceneRevision,
    async updateStage(stage) {
      if (operationBusy || deviceLost) throw new Error('Une opération du viewer est en cours.');
      await stopPlayback();
      const snapshot = viewer.snapshotState();
      if (!snapshot.scene || state.entry !== scriptStageEntry() || snapshot.scene.entry !== scriptStageEntry()) {
        throw new Error('La scène du script n’est plus active.');
      }
      const materials = viewer.snapshotEditableMaterials();
      const entry = scriptStageEntry();
      setBusy(true, 'Mise à jour de la dispersion...');
      try {
        const { importUsdaLayer } = await import('./render/usd-scene-assets.ts');
        const options = { ...snapshot.scene.options, imported: await importUsdaLayer(entry, stage.usda, stage.materials) };
        forgetHistory();
        await viewer.restoreState({ ...snapshot, scene: { ...snapshot.scene, options } });
        await viewer.restoreEditableMaterials(materials);
        scriptStage = options;
        projectStage = { usda: stage.usda, materials: new Map(stage.materials) };
        refreshObjects();
        refreshAnimation();
      } finally {
        setBusy(false);
      }
    },
    // Values are validated by the script runtime (RENDER_SETTINGS) before reaching the viewer.
    async setRenderSetting(name, value) {
      forgetHistory();
      if (name === 'backend') { viewer.setBackend(value as ViewerUiState['backend']); state.backend = value as ViewerUiState['backend']; }
      else if (name === 'resolution') {
        const size = value as ViewerUiState['resolution'];
        await viewer.resize(size === '1024x768' ? 1024 : size, size === '1024x768' ? 768 : size);
        state.resolution = size;
      } else if (name === 'depth') { viewer.setPathTracingDepth(value as number); state.pathTracingDepth = viewer.pathTracingDepth; }
      else if (name === 'quality') { await viewer.setRasterQuality(value as ViewerUiState['rasterQuality']); state.rasterQuality = value as ViewerUiState['rasterQuality']; }
      else if (name === 'environment') { viewer.setEnvironmentEnabled(value as boolean); state.environmentEnabled = value as boolean; }
      else if (name === 'denoise') { viewer.setPathTracingDenoise(value as boolean); state.denoise = value as boolean; }
      else if (name === 'exposure') { viewer.setExposure(value as number); state.exposure = value as number; }
      else if (name === 'tonemap') { await viewer.setTonemap(value as ViewerUiState['tonemap']); state.tonemap = value as ViewerUiState['tonemap']; }
      else if (name === 'view') viewer.setPathTracingView(value as PathTraceView);
      else if (name === 'adaptive') viewer.setPathTracingAdaptive(value as boolean);
      else if (name === 'noiseTarget') viewer.setPathTracingLimits({ ...viewer.pathTracingLimits, targetRelativeError: value as number });
      else if (name === 'stopOnConvergence') viewer.setPathTracingLimits({ ...viewer.pathTracingLimits, stopOnConvergence: value as boolean });
      else if (name === 'timeBudget') viewer.setPathTracingLimits({ ...viewer.pathTracingLimits, timeBudgetSeconds: value as number });
      else if (name === 'paused') viewer.setPathTracingPaused(value as boolean);
      else if (name === 'compare') {
        // The comparison needs a paused render: wait for the frame drawn by the pause first.
        await currentGpu.device.queue.onSubmittedWorkDone();
        viewer.setPathTracingDenoiserComparison(value as boolean);
        if (value) {
          await waitFor(() => state.status?.denoiser.state === 'ready' || state.status?.denoiser.state === 'error', 120, 'débruitage de la comparaison');
          if (state.status?.denoiser.state === 'error') throw new Error(`Échec du débruitage : ${state.status.denoiser.error}`);
          await nextFrame();
        }
      } else if (name === 'temporalHistory') {
        viewer.setPathTracingTemporalHistory(value as number);
        if (state.animation) state.animation.temporalHistory = value as number;
      } else if (name === 'memoryBudget') {
        setBusy(true, 'Application du budget mémoire GPU...');
        try { await viewer.setMemoryBudget(value as number > 0 ? value as number * 2 ** 20 : undefined); }
        finally {
          refreshObjects();
          setBusy(false);
        }
      }
      else throw new Error(`Paramètre de rendu inconnu : ${name}.`);
    },
    async setEnvironmentShader(settings) {
      forgetHistory();
      await viewer.setEnvironmentShader(settings);
      refreshAnimation();
    },
    async setImageShader(settings) {
      forgetHistory();
      viewer.setImageShader(settings);
    },
    async setPathTracingView(view) {
      viewer.setPathTracingView(view);
    },
    async assignMaterial(object, material) {
      if (operationBusy || deviceLost) throw new Error('Une opération du viewer est en cours.');
      if (!viewer.objects.some(candidate => candidate.path === object)) {
        throw new Error(`Objet inconnu : ${object}. Objets : ${viewer.objects.map(candidate => candidate.path).join(', ')}.`);
      }
      // Generated documents stay readable for later scene reloads, like applied script materials.
      const url = 'xml' in material ? URL.createObjectURL(new Blob([material.xml], { type: 'application/xml' })) : material.url;
      const compiled = 'url' in material
        ? MATERIAL_CATALOG.find(item => new URL(item.path, document.baseURI).href === material.url)?.compiled : undefined;
      forgetHistory();
      setBusy(true, `Application du matériau à ${object}...`);
      try { await viewer.setObjectMaterial(object, url, compiled ? new URL(compiled, document.baseURI).href : undefined); }
      finally {
        refreshObjects();
        refreshAnimation();
        setBusy(false);
      }
    },
    async render(samples) {
      if (state.backend === 'raster') {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        return 1;
      }
      if (viewer.pathTracingPaused) { forgetHistory(); viewer.setPathTracingPaused(false); }
      viewer.restartPathTracing();
      if (!samples) {
        await nextFrame();
        return state.status?.samples ?? 0;
      }
      let last = -1;
      let lastProgress = performance.now();
      for (;;) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (deviceLost) throw new Error('Périphérique WebGPU perdu pendant le rendu.');
        const status = state.status;
        if (status?.pathTracer === 'error') throw new Error('Échec de préparation du path tracer.');
        if (status?.fallback) throw new Error(`Rendu raster à la place du path tracer : ${status.fallback.reason}`);
        if (status?.pathTracer === 'ready' && status.samples >= samples) return status.samples;
        // Convergence or the time budget can stop the accumulation before the requested count.
        if (status?.pathTracer === 'ready' && status.pathTracingProgress?.stopReason) return status.samples;
        if (held) { lastProgress = performance.now(); continue; }
        if (status && (status.samples !== last || status.pathTracer !== 'ready')) { last = status.samples; lastProgress = performance.now(); }
        if (performance.now() - lastProgress > 60_000) throw new Error(`Rendu bloqué à ${last} échantillons sur ${samples}.`);
      }
    },
    stats() {
      const status = state.status;
      const memory = viewer.gpuMemory;
      const progress = status?.pathTracingProgress;
      const metrics = status?.pathTracingMetrics;
      const stats = {
        backend: viewer.backend, drawnBy: status?.fallback ? 'raster' : viewer.backend, fallback: status?.fallback?.reason,
        pathTracer: status?.pathTracer ?? 'idle', samples: status?.samples ?? 0,
        adaptive: viewer.pathTracingAdaptive, paused: viewer.pathTracingPaused,
        elapsed: progress?.elapsedSeconds, stopReason: progress?.stopReason,
        samplesPerSecond: metrics?.sweepsPerSecond, noise: metrics?.relativeNoise, maxNoise: metrics?.maximumRelativeNoise,
        variance: metrics?.relativeVariance, remaining: metrics?.convergenceRemainingSeconds, budgetRemaining: metrics?.budgetRemainingSeconds,
        time: viewer.time, warnings: status?.warnings ?? 0,
        gpuMemory: {
          total: memory.total, peak: memory.peak, textures: memory.textures, buffers: memory.buffers,
          ...(memory.budget !== undefined ? { budget: memory.budget } : {}), textureLimit: memory.textureLimit,
        },
      };
      return Object.fromEntries(Object.entries(stats).filter(([, value]) => value !== undefined)) as unknown as ScriptStats;
    },
    async waitForStop(timeout) {
      const limits = viewer.pathTracingLimits;
      if (viewer.backend !== 'pathtracing') throw new Error('converge() demande render.backend = "pathtracing".');
      if (!limits.stopOnConvergence && limits.timeBudgetSeconds === 0) {
        throw new Error('converge() demande render.stopOnConvergence = true ou un render.timeBudget.');
      }
      if (viewer.pathTracingPaused) { forgetHistory(); viewer.setPathTracingPaused(false); }
      await waitFor(() => {
        const status = state.status;
        if (status?.pathTracer === 'error') throw new Error('Échec de préparation du path tracer.');
        if (status?.fallback) throw new Error(`Rendu raster à la place du path tracer : ${status.fallback.reason}`);
        return status?.pathTracer === 'ready' && status.pathTracingProgress?.stopReason !== undefined;
      }, timeout, 'arrêt du path tracer');
      await nextFrame();
    },
    async capture(name, options) {
      if (viewer.backend !== 'pathtracing') throw new Error('capture() demande render.backend = "pathtracing".');
      if (outputFormat !== 'rgba8unorm' && outputFormat !== 'bgra8unorm') throw new Error(`Format de sortie non pris en charge : ${outputFormat}.`);
      if (operationBusy || deviceLost) throw new Error('Une opération du viewer est en cours.');
      const target = viewer;
      setBusy(true, `Capture de ${options.samples} échantillons${options.shutter ? ' avec flou de mouvement' : ''}...`);
      try {
        const image = await captureRgba(currentGpu.device, canvas!.width, canvas!.height, {
          pathTrace: view => target.renderPathTraceTo(view, options.samples, options.shutter),
        }, () => { if (deviceLost || viewer !== target) throw new Error('Périphérique WebGPU perdu pendant la capture.'); }, outputFormat);
        const offscreen = new OffscreenCanvas(image.width, image.height);
        offscreen.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
        await saveScriptFile(name, await offscreen.convertToBlob({ type: 'image/png' }));
      } finally {
        setBusy(false);
      }
    },
    async video(name, options, signal) {
      if (operationBusy || deviceLost) throw new Error('Une opération du viewer est en cours.');
      if (viewer.backend !== 'raster' && viewer.backend !== 'pathtracing') throw new Error('La vidéo demande le moteur raster ou path tracing.');
      if (viewer.backend !== 'pathtracing' && options.shutter) throw new Error('Le flou de mouvement vidéo demande le path tracing.');
      if (outputFormat !== 'rgba8unorm' && outputFormat !== 'bgra8unorm') throw new Error(`Format de sortie non pris en charge : ${outputFormat}.`);
      const target = viewer;
      const backend = target.backend;
      const timeCodesPerSecond = target.timeline?.timeCodesPerSecond ?? 24;
      const count = Math.ceil((options.end - options.start) * options.fps / timeCodesPerSecond);
      if (!Number.isSafeInteger(count) || count < 1 || count > 3600) throw new Error('La vidéo doit contenir entre 1 et 3600 images.');
      if (state.animation?.playing) {
        state.animation.playing = false;
        cancelPlayback();
      }
      setBusy(true, 'Préparation de la vidéo...');
      let originalTime: number | undefined;
      try {
        await Promise.all([...pendingTimeUpdates]);
        const check = () => {
          signal?.throwIfAborted();
          if (deviceLost || viewer !== target || target.backend !== backend) throw new Error('Périphérique, scène ou moteur changé pendant la vidéo.');
        };
        check();
        originalTime = target.time;
        const { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource } = await import('mediabunny');
        const canvas2d = new OffscreenCanvas(canvas.width, canvas.height);
        const context = canvas2d.getContext('2d');
        if (!context) throw new Error('Encodage vidéo indisponible : canvas 2D.');
        const mp4 = /\.mp4$/i.test(name);
        const buffer = new BufferTarget();
        const output = new Output({ format: mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target: buffer });
        const source = new CanvasSource(canvas2d, { codec: mp4 ? 'avc' : 'vp9', bitrate: 8_000_000, keyFrameInterval: 2, latencyMode: 'quality' });
        output.addVideoTrack(source, { frameRate: options.fps, maximumPacketCount: count });
        let finalized = false;
        try {
          await output.start();
          for (let frame = 0; frame < count; frame++) {
            check();
            setBusyMessage(`Vidéo : image ${frame + 1} / ${count}...`);
            const time = options.start + frame * timeCodesPerSecond / options.fps;
            await updateTime(target, time);
            check();
            if (backend === 'raster') await target.prepareRaster();
            const shutter = options.shutter && {
              open: time + options.shutter.open, close: time + options.shutter.close,
              ...(options.shutter.steps !== undefined ? { steps: options.shutter.steps } : {}),
            };
            const image = await captureRgba(currentGpu.device, canvas.width, canvas.height, backend === 'raster'
              ? { raster: view => target.renderRasterTo(view) }
              : { pathTrace: view => target.renderPathTraceTo(view, options.samples, shutter, check) }, check, outputFormat);
            context.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
            await source.add(frame / options.fps, 1 / options.fps);
          }
          check();
          source.close();
          await output.finalize();
          finalized = true;
          check();
          if (!buffer.buffer) throw new Error('La vidéo encodée est vide.');
          await saveScriptFile(name, new Blob([buffer.buffer], { type: mp4 ? 'video/mp4' : 'video/webm' }));
        } finally {
          if (!finalized) await output.cancel();
        }
      } finally {
        try {
          if (originalTime !== undefined && !deviceLost && viewer === target) {
            await updateTime(target, originalTime);
            if (state.animation) state.animation.time = originalTime;
            syncTimeline();
          }
        } finally {
          if (!deviceLost && viewer === target) setBusy(false);
        }
      }
    },
    async saveAov(name) {
      const view = viewer.pathTracingView;
      if (viewer.backend !== 'pathtracing' || view === 'beauty' || !state.status?.samples) {
        throw new Error('save(".pfm") demande render.view = un AOV du path tracer et des échantillons.');
      }
      const image = await viewer.readPathTracingAov();
      await saveScriptFile(name, new Blob([encodePathTraceAovPfm(image)], { type: 'application/octet-stream' }));
    },
    saveDiagnostics: name => saveScriptFile(name, new Blob([diagnosticsJson()], { type: 'application/json' })),
    diagnostics: () => journal.records.map(record => ({ level: record.level, message: record.message, ...(record.code ? { code: record.code } : {}) })),
    capabilities: () => ({ ...describeGpuCapabilities(currentGpu.device, currentGpu.adapter.info), mobile: isMobileGpu({ adapterInfo: currentGpu.adapter.info }) }),
    timeline() {
      const timeline = viewer.timeline;
      return timeline?.animated ? { start: timeline.start, end: timeline.end, fps: timeline.timeCodesPerSecond } : undefined;
    },
    time: () => viewer.time,
    async setTime(time) {
      forgetHistory();
      await updateTime(viewer, time);
      if (state.animation) state.animation.time = time;
      syncTimeline();
    },
    async setTransform(object, matrix) {
      await recordHistory('Transformation de l’objet', () => viewer.snapshotState().scene?.transforms.get(object),
        value => viewer.setObjectTransform(object, value), () => viewer.setObjectTransform(object, matrix));
    },
    async setVisibility(object, visible) {
      await recordHistory('Visibilité de l’objet', () => viewer.snapshotState().scene?.visibility.get(object),
        value => viewer.setObjectVisible(object, value), () => viewer.setObjectVisible(object, visible));
    },
    lights: () => viewer.lights,
    async setLight(light, changes) {
      const next = changes && {
        ...(changes.intensity !== undefined ? { intensity: changes.intensity } : {}),
        ...(changes.exposure !== undefined ? { exposure: changes.exposure } : {}),
        ...(changes.color !== undefined ? { color: [changes.color[0]!, changes.color[1]!, changes.color[2]!] as [number, number, number] } : {}),
        ...(changes.transform !== undefined ? { transform: [...changes.transform] } : {}),
        ...(changes.filter !== undefined ? { filter: { ...changes.filter } } : {}),
      };
      await recordHistory('Lumière', () => viewer.snapshotState().scene?.lights.get(light),
        value => { viewer.setLight(light); if (value) viewer.setLight(light, value); },
        () => viewer.setLight(light, next));
    },
    async moveLightFilter(from, to, settings) {
      if (from === to) throw new Error('Les deux chemins de lumière doivent être distincts.');
      if (!viewer.lights.some(light => light.path === from)) throw new Error(`Lumière inconnue : ${from}.`);
      const read = () => {
        const lights = viewer.snapshotState().scene?.lights;
        return [lights?.get(from), lights?.get(to)] as const;
      };
      const previous = read()[0];
      viewer.setLight(to, { filter: settings });
      forgetHistory();
      viewer.setLight(from);
      if (previous) {
        const { filter: _filter, ...rest } = previous;
        if (Object.keys(rest).length) viewer.setLight(from, rest);
      }
    },
    async setCamera(camera) {
      forgetHistory();
      await viewer.setCamera({ eye: camera.eye, target: camera.target, ...(camera.fov !== undefined ? { fovY: camera.fov * Math.PI / 180 } : {}) });
    },
    variants: () => viewer.variantSets,
    async setVariant(path, set, variant) {
      if (operationBusy || deviceLost) throw new Error('Une opération du viewer est en cours.');
      forgetHistory();
      setBusy(true, 'Changement de variante...');
      try { await viewer.setVariant(path, set, variant); }
      finally {
        refreshObjects();
        refreshAnimation();
        setBusy(false);
      }
    },
    materialParameters(object) {
      if (!viewer.objects.some(candidate => candidate.path === object)) throw new Error(`Objet inconnu : ${object}.`);
      return viewer.objectParameters(object);
    },
    async setMaterialParameters(object, values) {
      if (operationBusy || deviceLost) throw new Error('Une opération du viewer est en cours.');
      const known = new Set(viewer.objectParameters(object).map(parameter => parameter.id));
      const unknown = [...values.keys()].filter(id => !known.has(id));
      if (unknown.length) throw new Error(`Paramètres inconnus sur ${object} : ${unknown.join(', ')}. Voir materialParameters("${object}").`);
      setBusy(true, 'Application des paramètres du matériau...');
      try { await recordMaterial(object, 'Paramètres du matériau', () => viewer.setObjectParameters(object, values)); }
      finally { setBusy(false); }
    },
    async saveImage(name) {
      if (viewer.backend === 'raster') {
        if (outputFormat !== 'rgba8unorm' && outputFormat !== 'bgra8unorm') throw new Error(`Format de sortie non pris en charge : ${outputFormat}.`);
        const target = viewer;
        await target.prepareRaster();
        const image = await captureRgba(currentGpu.device, canvas!.width, canvas!.height, {
          raster: view => target.renderRasterTo(view),
        }, () => {
          if (deviceLost || viewer !== target || target.backend !== 'raster') {
            throw new Error('La scène ou le moteur a changé pendant la capture raster.');
          }
        }, outputFormat);
        const offscreen = new OffscreenCanvas(image.width, image.height);
        offscreen.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
        await saveScriptFile(name, await offscreen.convertToBlob({ type: 'image/png' }));
        return;
      }
      // Settings applied just before (exposure, view...) are drawn by the next frame.
      await nextFrame();
      await currentGpu.device.queue.onSubmittedWorkDone();
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(value => value ? resolve(value) : reject(new Error('Le navigateur n’a pas pu encoder le rendu en PNG.')), 'image/png');
      });
      await saveScriptFile(name, blob);
    },
    saveText: (name, text) => saveScriptFile(name, new Blob([text], { type: 'application/xml' })),
    objectMaterial(object) {
      const graph = viewer.objectSurfaceGraph(object);
      if (!graph) return undefined;
      const name = viewer.objects.find(candidate => candidate.path === object)?.material ?? 'material';
      return { graph, name: name.split('/').filter(Boolean).at(-1) ?? 'material' };
    },
  };
  /** Files saved by scripts: written by the command-line runner when present, downloaded otherwise. */
  async function saveScriptFile(name: string, blob: Blob): Promise<void> {
    const sink = (globalThis as { __mxSaveFile?: (name: string, base64: string) => Promise<void> }).__mxSaveFile;
    if (!sink) {
      downloadBlob(blob, name.split(/[\\/]/).at(-1)!);
      return;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    await sink(name, btoa(binary));
  }
  // Entry point of `npm run script` (scripts/run-material-script.mjs). Scripts start once the
  // page's initial scene is loaded: otherwise that load would replace the scene a script loads.
  let initialSceneLoaded!: () => void;
  const initialScene = new Promise<void>(resolve => { initialSceneLoaded = resolve; });
  // Polled by the runner to show the progress of long renders.
  (globalThis as { __mxProgress?: unknown }).__mxProgress = () => ({ ...viewerHost?.stats(), entry: state.entry, held: Boolean(held) });
  (globalThis as { __mxControl?: unknown }).__mxControl = (action: 'pause' | 'resume'): boolean =>
    action === 'pause' ? scriptControl.pause() : scriptControl.resume();
  (globalThis as { __mxRunScript?: unknown }).__mxRunScript = async (code: string) => {
    try {
      await initialScene;
      const library = await scriptLibrary;
      const run = await runScript(code, library, {
        host: scriptHost, filePrefix: scriptFilePrefix, hooks: { pausable: true, beforeLine: () => scriptControl.wait() },
      });
      return { ok: true, nodes: run.nodes.length, viewerCommands: run.viewerCommands, logs: run.logs, xml: toXml(run, library) };
    } catch (error) {
      return {
        ok: false, message: error instanceof Error ? error.message : String(error),
        ...(error instanceof ScriptError && error.line !== undefined ? { line: error.line } : {}),
      };
    }
  };
  if (libraryButton && libraryDialog) {
    const openLibrary = bindMaterialLibrary(libraryDialog, MATERIAL_CATALOG, actions.material, {
      capturePreview: (entry, signal) => captureScriptPreview(
        'previewSphere = new Sphere();\npreviewSurface = new StandardSurface();\npreviewSphere.material = previewSurface;',
        '/World/previewSphere', signal, { path: entry.path, ...(entry.compiled ? { compiled: entry.compiled } : {}) }, 128,
      ),
    });
    libraryButton.onclick = () => {
      if (!operationBusy && !deviceLost && state.objectPath) openLibrary(state.objectPath, state.materialPath);
    };
  }
  const stopUi = await startViewerUi(uiCanvas, state, actions, parameterEditor);
  document.getElementById('app')?.classList.add('ui-ready');

  let recoveries = 0;
  let lastLoss = -Infinity;
  function watchDevice(watched: GPUDevice): void {
    void watched.lost.then(async info => {
      if (info.reason === 'destroyed') return;
      console.error(`WebGPU device lost (${info.reason}): ${info.message}`);
      journal.record({ level: 'warning', code: 'device-lost', message: `GPU device lost (${info.reason}): ${info.message}` });
      deviceLost = true;
      forgetHistory();
      setBusy(true, 'Réinitialisation du moteur WebGPU...');
      // Losses less than a minute apart count as one episode: restoring the same state again
      // would lose the device again (e.g. a path-tracing kernel the driver cannot run).
      const now = performance.now();
      if (now - lastLoss > 60_000) recoveries = 0;
      lastLoss = now;
      if (++recoveries > 3) {
        journal.record({ level: 'error', code: 'device-recovery-failed', message: 'GPU device lost more than three times in a row.' });
        setStatus(`GPU perdu (${info.message || info.reason}). Recharger la page.`);
        return;
      }
      // Scene, camera, material overrides and edits, time and settings survive the new device.
      let snapshot = viewer.snapshotState();
      const tracer = snapshot.settings.backend;
      let fallbackMessage = '';
      if (recoveries > 1 && tracer !== 'raster') {
        snapshot = { ...snapshot, settings: { ...snapshot.settings, backend: 'raster' } };
        const reason = `le GPU a été perdu ${recoveries} fois pendant le rendu ${tracer === 'disney' ? 'Disney' : 'path tracing'}`;
        journal.record({ level: 'warning', code: 'backend-fallback', message: `Restored with raster: ${reason}.`, detail: { backend: tracer } });
        fallbackMessage = `Rendu raster à la place du ${tracer === 'disney' ? 'path tracer Disney' : 'path tracer'} : ${reason}.`;
      }
      viewer.dispose();
      try {
        const next = await requestGpu();
        if (!next) throw new Error('Aucun adaptateur WebGPU disponible.');
        (globalThis as { __mxGpu?: unknown }).__mxGpu = next;
        currentGpu = next;
        next.device.addEventListener('uncapturederror', reportGpuError);
        context!.configure({ device: next.device, format: outputFormat, alphaMode: 'opaque' });
        viewer = new InteractiveViewer({ device: next.device, context: context!, outputFormat, canvas: canvas!, streaming: true, ...viewerCallbacks });
        deviceLost = false;
        watchDevice(next.device);
        setBusy(true, 'Restauration de la scène...');
        try {
          await viewer.restoreState(snapshot);
        } finally {
          setBusy(false);
        }
        state.pathTracingDepth = viewer.pathTracingDepth;
        refreshObjects();
        refreshAnimation();
        journal.record({ level: 'info', code: 'device-restored', message: 'GPU device recreated; scene and settings restored.' });
        if (fallbackMessage) setStatus(fallbackMessage);
      } catch (error) {
        journal.record({ level: 'error', code: 'device-recovery-failed', message: `GPU device recovery failed: ${String(error)}` });
        setStatus(`GPU perdu : ${String(error)}. Recharger la page.`);
      }
    });
  }
  watchDevice(device);
  globalThis.addEventListener?.('pagehide', event => {
    if (!(event instanceof PageTransitionEvent) || !event.persisted) {
      parameterEditor.refresh();
      stopUi();
      viewer.dispose();
      localScene?.dispose();
    }
  });

  await loadEntry(initialEntry);
  const initialMaterial = params.get('openpbr');
  if (initialMaterial && !statusIsError) {
    await operation('Chargement du matériau initial...', async () => {
      const assetPath = new URL(initialMaterial, document.baseURI).href;
      const response = await fetch(assetPath);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${assetPath}`);
      const documentXml = new DOMParser().parseFromString(await response.text(), 'application/xml');
      if (documentXml.querySelector('parsererror')) throw new Error('Invalid MaterialX XML.');
      const materialName = documentXml.getElementsByTagName('surfacematerial')[0]?.getAttribute('name');
      if (!materialName) throw new Error('No surfacematerial in this MaterialX document.');
      await viewer.load(new URL(initialEntry, document.baseURI).href,
        new Map(viewer.objects.map(object => [object.path, { assetPath, materialName }])), true);
      refreshObjects();
    });
  }
  initialSceneLoaded();
}

void main().catch((error: unknown) => {
  console.error('Viewer initialization failed:', error);
  setStatus(`Echec de l'initialisation : ${error instanceof Error ? error.message : String(error)}`);
});
