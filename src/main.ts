import { InteractiveViewer } from './render/viewer.ts';
import { SCENE_CATALOG, SOURCE_SCENE_CATALOG } from './scene/scene-catalog.ts';
import { MATERIAL_CATALOG } from './scene/material-catalog.ts';
import { buildMaterialTree } from './scene/material-tree.ts';
import { MaterialParameterEditor } from './material-parameter-editor.ts';
import { showMaterialGraph } from './material-graph-diagram.ts';
import { bindMaterialLibrary } from './material-library.ts';
import { sceneDeviceDescriptor } from './gpu/device.ts';
import { startViewerUi, type ViewerUiState, type ViewerUiActions } from './viewer-ui.ts';
import type { LocalGltfScene } from './scene/local-gltf.ts';
import { downloadDisplayedAovPng, downloadPathTraceAovPfm } from './render/aov-export.ts';
import { attachScriptEditor } from './materialx/script-editor.ts';
import { loadScriptLibrary } from './materialx/script-api.ts';

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
  attachScriptEditor(document.getElementById('material-tools'), {
    library: loadScriptLibrary(new URL(`${import.meta.env.BASE_URL}materialx/libraries`, document.baseURI).href),
    filePrefix: new URL('.', document.baseURI).href,
    onApply: (xml) => {
      if (!applyScriptMaterial) throw new Error('Le viewer WebGPU n’est pas prêt.');
      return applyScriptMaterial(xml);
    },
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
  (globalThis as { __mxGpu?: unknown }).__mxGpu = gpu;
  let deviceLost = false;
  const reportGpuError = (event: Event): void => {
    const message = (event as GPUUncapturedErrorEvent).error.message;
    console.error(`WebGPU error: ${message}`);
    if (ui) {
      ui.shaderErrors += `${ui.shaderErrors ? '\n\n' : ''}WebGPU - validation\n${message}`;
      setDiagnostics('shader', ui.shaderErrors);
    }
    setStatus(`WebGPU : ${message}`);
  };
  device.addEventListener('uncapturederror', reportGpuError);
  const canvas = document.getElementById('view') as HTMLCanvasElement | null;
  const uiCanvas = document.getElementById('ui') as HTMLCanvasElement | null;
  if (!canvas || !uiCanvas) throw new Error('Viewer canvases are missing.');
  canvas.width = initialResolution === '1024x768' ? 1024 : initialResolution;
  canvas.height = initialResolution === '1024x768' ? 768 : initialResolution;
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('No WebGPU canvas context.');
  const outputFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: outputFormat, alphaMode: 'opaque' });
  const localFiles = document.getElementById('local-scene-files') as HTMLInputElement | null;
  const localFolder = document.getElementById('local-scene-folder') as HTMLInputElement | null;
  let localScene: LocalGltfScene | undefined;
  const state: ViewerUiState = {
    entry: initialEntry, scenes: [...SCENE_CATALOG], resolution: initialResolution, pathTracingDepth: 12,
    rasterQuality: 'interactive', backend: initialBackend, environmentEnabled: true, denoise: false,
    exposure: 0, tonemap: 'acesFilmic',
    status: undefined, busy: true, busyMessage: 'Initialisation...', error: '', shaderErrors: '', warnings: '',
    objectPath: '', objects: [], materialFolderPath: [], materialTree: buildMaterialTree(MATERIAL_CATALOG), materialPath: '',
  };
  ui = state;
  if (!state.scenes.some(scene => scene.entry === initialEntry)) state.scenes.push({ entry: initialEntry, label: initialEntry });
  let operationBusy = false;
  let hasLoadedScene = false;
  let sceneChanging = false;
  let shaderBusy = false;
  let shaderBusyMessage = 'Préparation du path tracer...';
  const viewerCallbacks: Pick<ConstructorParameters<typeof InteractiveViewer>[0], 'onStatus' | 'onShaderErrors'> = {
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
      state.shaderErrors = errors.map(error => `${error.shader}${error.line > 0 ? ` (${error.line}:${error.column})` : ''}\n${error.message}${error.source ? `\n> ${error.source}` : ''}`).join('\n\n');
      setDiagnostics('shader', state.shaderErrors);
    },
  };
  let viewer = new InteractiveViewer({ device, context, outputFormat, canvas, ...viewerCallbacks });
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
        try { await edit(); }
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
        disneyDiagnostics: () => target.objectDisneyMaterialDiagnostics(path),
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
        variants: () => target.objectMaterialVariants(path),
        variantGraph: slot => target.objectMaterialVariantGraph(path, slot),
        textureSource: file => target.objectTextureExportSource(path, file),
        saveVariant(slot) {
          ensureEditable();
          target.saveObjectMaterialVariant(path, slot);
        },
        applyVariant: slot => editGraph(() => target.applyObjectMaterialVariant(path, slot)),
        capturePreview(options, signal) {
          ensureEditable();
          return target.captureObjectMaterialPreview(path, options, signal);
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
      setBusy(true, 'Application des paramètres du matériau...');
      try { await viewer.setObjectParameters(state.objectPath, changes); }
      finally { setBusy(false); }
    },
    error: error => setStatus(`Echec du paramètre : ${error instanceof Error ? error.message : String(error)}`),
  });

  function setBusy(busy: boolean, message?: string): void {
    operationBusy = busy;
    state.busy = busy;
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

  function refreshObjects(): void {
    state.objects = viewer.objects;
    if (!state.objects.some(object => object.path === state.objectPath)) state.objectPath = state.objects[0]?.path ?? '';
    refreshMaterialSelection();
  }

  applyScriptMaterial = async (xml) => {
    if (operationBusy || deviceLost) throw new Error('Une opération du viewer est en cours.');
    if (!state.objectPath) throw new Error('Sélectionner d’abord un objet de la scène.');
    if (viewer.isCompiledScene) {
      throw new Error('Scène précompilée : ouvrir une scène source (USD ou glTF) pour appliquer un matériau scripté.');
    }
    // The viewer re-reads the document whenever the scene reloads, so the URL is kept alive.
    const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
    setBusy(true, 'Application du matériau scripté...');
    try { await viewer.setObjectMaterial(state.objectPath, url); }
    finally {
      refreshObjects();
      setBusy(false);
    }
  };

  async function loadEntry(entry: string): Promise<boolean> {
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
      await viewer.load(url, new Map(), false, {
        ...(imported ? imported.options : {}),
        ...(!imported && localScene?.entry === entry ? localScene.options : {}),
        ...(config?.textureRoot ? { textureRoot: new URL(config.textureRoot, document.baseURI).href } : {}),
      });
      state.entry = entry;
      state.pathTracingDepth = viewer.pathTracingDepth;
      refreshObjects();
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
  const actions: ViewerUiActions = {
    scene: entry => { parameterEditor.refresh(); void loadEntry(entry); },
    resolution: size => { void operation('Redimensionnement du rendu...', async () => {
      await viewer.resize(size === '1024x768' ? 1024 : size, size === '1024x768' ? 768 : size);
      state.resolution = size;
    }); },
    pathTracingDepth: depth => { void operation('Mise à jour de la profondeur...', async () => {
      viewer.setPathTracingDepth(depth);
      state.pathTracingDepth = viewer.pathTracingDepth;
    }); },
    quality: quality => { void operation('Compilation du profil raster...', async () => { await viewer.setRasterQuality(quality); state.rasterQuality = quality; }); },
    backend: backend => { void operation('Changement du moteur de rendu...', async () => {
      viewer.setBackend(backend);
      state.backend = backend;
    }); },
    environment: enabled => { viewer.setEnvironmentEnabled(enabled); state.environmentEnabled = enabled; },
    denoise: enabled => { viewer.setPathTracingDenoise(enabled); state.denoise = enabled; },
    compareDenoiser: enabled => viewer.setPathTracingDenoiserComparison(enabled),
    adaptive: enabled => viewer.setPathTracingAdaptive(enabled),
    pathTracingView: view => viewer.setPathTracingView(view),
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
    limits: limits => { void operation('Mise a jour des limites de rendu...', async () => viewer.setPathTracingLimits(limits)); },
    restartPathTracing: () => viewer.restartPathTracing(),
    exposure: value => { viewer.setExposure(value); state.exposure = value; },
    tonemap: value => { void operation('Mise à jour du tonemapping...', async () => { await viewer.setTonemap(value); state.tonemap = value; }); },
    pause: () => viewer.setPathTracingPaused(!viewer.pathTracingPaused),
    openFiles: folder => (folder ? localFolder : localFiles)?.click(),
    object: path => { state.objectPath = path; refreshMaterialSelection(); },
    material: path => { void operation('Application du matériau...', async () => {
      const compiled = MATERIAL_CATALOG.find(item => item.path === path)?.compiled;
      try {
        await viewer.setObjectMaterial(
          state.objectPath,
          path ? new URL(path, document.baseURI).href : undefined,
          compiled ? new URL(compiled, document.baseURI).href : undefined,
        );
      }
      finally { refreshObjects(); }
    }); },
  };
  if (libraryButton && libraryDialog) {
    const openLibrary = bindMaterialLibrary(libraryDialog, MATERIAL_CATALOG, actions.material);
    libraryButton.onclick = () => {
      if (!operationBusy && !deviceLost && state.objectPath) openLibrary(state.objectPath, state.materialPath);
    };
  }
  const stopUi = await startViewerUi(uiCanvas, state, actions, parameterEditor);
  document.getElementById('app')?.classList.add('ui-ready');

  let recoveries = 0;
  function watchDevice(watched: GPUDevice): void {
    void watched.lost.then(async info => {
      if (info.reason === 'destroyed') return;
      console.error(`WebGPU device lost (${info.reason}): ${info.message}`);
      deviceLost = true;
      setBusy(true, 'Réinitialisation du moteur WebGPU...');
      if (++recoveries > 3) { setStatus(`GPU perdu (${info.message || info.reason}). Recharger la page.`); return; }
      const backend = viewer.backend;
      const quality = viewer.rasterQuality;
      const pathTracingDepth = viewer.pathTracingDepth;
      const denoise = viewer.pathTracingDenoise;
      const adaptive = viewer.pathTracingAdaptive;
      const pathTracingView = viewer.pathTracingView;
      const limits = viewer.pathTracingLimits;
      const environment = viewer.environmentEnabled;
      const paused = viewer.pathTracingPaused;
      viewer.dispose();
      try {
        const next = await requestGpu();
        if (!next) throw new Error('Aucun adaptateur WebGPU disponible.');
        (globalThis as { __mxGpu?: unknown }).__mxGpu = next;
        next.device.addEventListener('uncapturederror', reportGpuError);
        context!.configure({ device: next.device, format: outputFormat, alphaMode: 'opaque' });
        viewer = new InteractiveViewer({ device: next.device, context: context!, outputFormat, canvas: canvas!, ...viewerCallbacks });
        await viewer.setRasterQuality(quality);
        viewer.setPathTracingDenoise(denoise);
        viewer.setPathTracingAdaptive(adaptive);
        viewer.setPathTracingView(pathTracingView);
        viewer.setPathTracingLimits(limits);
        await viewer.setTonemap(state.tonemap);
        viewer.setEnvironmentEnabled(environment);
        viewer.setPathTracingPaused(paused);
        viewer.setBackend(backend);
        deviceLost = false;
        watchDevice(next.device);
        if (await loadEntry(state.entry)) {
          viewer.setPathTracingDepth(pathTracingDepth);
          state.pathTracingDepth = viewer.pathTracingDepth;
          recoveries = 0;
        }
      } catch (error) { setStatus(`GPU perdu : ${String(error)}. Recharger la page.`); }
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
}

void main().catch((error: unknown) => {
  console.error('Viewer initialization failed:', error);
  setStatus(`Echec de l'initialisation : ${error instanceof Error ? error.message : String(error)}`);
});
