// Browser entry point. Drives the interactive on-canvas viewer (src/render/
// viewer.ts) on real USD scenes: a scene selector in index.html lets the user
// pick which .usda to load, and the viewer renders it with an orbit camera in
// either backend -- raster forward [r] or the WebGPU compute path tracer [p] --
// on the SAME imported resources (no reimport on backend switch). Loading a new
// scene disposes the previous GPU state and rebuilds both backends.

import { InteractiveViewer, type ViewerStatus } from './render/viewer.ts';
import { SCENE_CATALOG } from './scene/scene-catalog.ts';
import { MATERIAL_CATALOG } from './scene/material-catalog.ts';

function setStatus(text: string): void {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}

function formatStatus(s: ViewerStatus): string {
  const pt = s.pathTracer === 'compiling' ? ', compilation du path tracer...' : s.pathTracer === 'error' ? ', échec du path tracer' : '';
  const denoiser = s.denoiser.state === 'off' ? ', brut'
    : s.denoiser.state === 'running' ? ', denoiser JS : chargement / calcul...'
    : s.denoiser.state === 'error' ? `, échec denoiser JS : ${s.denoiser.error}`
    : s.denoiser.state === 'ready' ? ', denoiser JS (neuronal, approximation)'
    : ', denoiser JS : attente d’un passage complet';
  const extra = s.backend === 'pathtracing' ? `${pt || `, ${s.samples} spp`}${s.pathTracingPaused ? ' (pause)' : ''}${denoiser}`
    : s.rasterQuality === 'interactive' ? ', IBL filtrée 16 échantillons (approximation)' : ', référence 64 échantillons MIS';
  const note = s.warnings ? ` (${s.warnings} diagnostic(s))` : '';
  return `Backend ${s.backend}: ${s.drawCount} object(s), passes [${s.passes.join(', ')}]${extra}${note}. ` +
    'Glisser pour orbiter, molette pour zoomer.';
}

function populateSelector(select: HTMLSelectElement): void {
  for (const { label, entry } of SCENE_CATALOG) {
    const opt = document.createElement('option');
    opt.value = entry;
    opt.textContent = label;
    select.appendChild(opt);
  }
}

async function main(): Promise<void> {
  if (!('gpu' in navigator)) {
    setStatus('WebGPU is not available in this browser.');
    return;
  }
  // Chrome Android can return null (or hang) while the previous adapter is still being released.
  const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | undefined> =>
    Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))]);
  async function requestGpu(): Promise<{ adapter: GPUAdapter; device: GPUDevice } | undefined> {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      const adapter = await withTimeout(navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }), 10000);
      const device = adapter ? await withTimeout(adapter.requestDevice(), 10000) : undefined;
      if (adapter && device) return { adapter, device };
    }
    return undefined;
  }
  const gpu = await requestGpu();
  if (!gpu) {
    setStatus('No WebGPU adapter found.');
    return;
  }
  const { device } = gpu;
  (globalThis as { __mxGpu?: unknown }).__mxGpu = gpu;
  let deviceLost = false;
  device.addEventListener('uncapturederror', (event) => {
    console.error(`WebGPU error: ${(event as GPUUncapturedErrorEvent).error.message}`);
  });
  const canvas = document.getElementById('view') as HTMLCanvasElement | null;
  if (!canvas) {
    setStatus('WebGPU adapter ready; no canvas.');
    return;
  }
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('webgpu');
  if (!context) {
    setStatus('WebGPU adapter ready; no canvas context.');
    return;
  }
  const outputFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: outputFormat, alphaMode: 'opaque' });

  const select = document.getElementById('scene') as HTMLSelectElement | null;
  const resolution = document.getElementById('resolution') as HTMLSelectElement | null;
  const rasterQuality = document.getElementById('raster-quality') as HTMLSelectElement | null;
  const ptDenoise = document.getElementById('pathtracing-denoise') as HTMLInputElement | null;
  const objectSelect = document.getElementById('material-object') as HTMLSelectElement | null;
  const materialSelect = document.getElementById('material-file') as HTMLSelectElement | null;
  const materialFilter = document.getElementById('material-filter') as HTMLInputElement | null;
  const materialControls = document.getElementById('material-controls') as HTMLFieldSetElement | null;
  if (select) populateSelector(select);
  const backendButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#backend-mode button[data-backend]'));
  const pathTracingToggle = document.getElementById('pathtracing-toggle') as HTMLButtonElement | null;

  function updatePathTracingToggle(backend: string, paused: boolean): void {
    if (!pathTracingToggle) return;
    pathTracingToggle.disabled = backend !== 'pathtracing';
    pathTracingToggle.title = paused ? 'Reprendre le path tracer' : 'Mettre le path tracer en pause';
    const label = document.getElementById('pathtracing-toggle-label');
    const icon = document.getElementById('pathtracing-toggle-icon');
    if (label) label.textContent = paused ? 'Reprendre' : 'Pause';
    if (icon) icon.textContent = paused ? '\u25b6' : '\u275a\u275a';
  }

  const viewerCallbacks: Pick<ConstructorParameters<typeof InteractiveViewer>[0], 'onStatus' | 'onShaderErrors'> = {
    onStatus: (s) => {
      if (deviceLost) return;
      setStatus(formatStatus(s));
      updatePathTracingToggle(s.backend, s.pathTracingPaused);
    },
    onShaderErrors: (errors) => {
      const count = document.getElementById('shader-error-count');
      const output = document.getElementById('shader-errors');
      if (count) count.textContent = String(errors.length);
      if (output) output.textContent = errors.length > 0
        ? errors.map((error) => `${error.shader} (${error.line}:${error.column})\n${error.message}${error.source ? `\n> ${error.source}` : ''}`).join('\n\n')
        : 'Aucune erreur WGSL.';
    },
  };
  let viewer = new InteractiveViewer({ device, context, outputFormat, canvas, ...viewerCallbacks });
  const viewCanvas = canvas;
  const viewContext = context;

  // Chrome Android may drop the WebGPU instance (e.g. right after a reload): rebuild on a new device.
  let recoveries = 0;
  function watchDevice(watched: GPUDevice): void {
    void watched.lost.then(async (info) => {
      console.error(`WebGPU device lost (${info.reason}): ${info.message}`);
      if (info.reason === 'destroyed') return;
      deviceLost = true;
      setBusy(true);
      if (++recoveries > 3) {
        setStatus(`GPU perdu (${info.message || info.reason}). Recharger la page.`);
        return;
      }
      setStatus('GPU perdu, réinitialisation...');
      const backend = viewer.backend;
      const quality = viewer.rasterQuality;
      const denoise = viewer.pathTracingDenoise;
      viewer.dispose();
      const next = await requestGpu();
      if (!next) {
        setStatus('GPU perdu et aucun adaptateur WebGPU disponible. Recharger la page.');
        return;
      }
      (globalThis as { __mxGpu?: unknown }).__mxGpu = next;
      next.device.addEventListener('uncapturederror', (event) => {
        console.error(`WebGPU error: ${(event as GPUUncapturedErrorEvent).error.message}`);
      });
      viewContext.configure({ device: next.device, format: outputFormat, alphaMode: 'opaque' });
      viewer = new InteractiveViewer({ device: next.device, context: viewContext, outputFormat, canvas: viewCanvas, ...viewerCallbacks });
      await viewer.setRasterQuality(quality);
      viewer.setPathTracingDenoise(denoise);
      viewer.setBackend(backend);
      deviceLost = false;
      watchDevice(next.device);
      await loadEntry(select?.value ?? SCENE_CATALOG[0]!.entry);
      if (!deviceLost) recoveries = 0;
    });
  }
  watchDevice(device);

  pathTracingToggle?.addEventListener('click', () => {
    viewer.setPathTracingPaused(!viewer.pathTracingPaused);
    updatePathTracingToggle(viewer.backend, viewer.pathTracingPaused);
  });
  ptDenoise?.addEventListener('change', () => viewer.setPathTracingDenoise(ptDenoise.checked));

  function setBusy(busy: boolean): void {
    if (select) select.disabled = busy;
    if (resolution) resolution.disabled = busy;
    if (rasterQuality) rasterQuality.disabled = busy;
    if (ptDenoise) ptDenoise.disabled = busy;
    if (materialControls) materialControls.disabled = busy || viewer.objects.length === 0;
  }

  function refreshMaterials(): void {
    if (!materialSelect) return;
    const selected = viewer.objects.find((object) => object.path === objectSelect?.value)?.assetPath ?? '';
    const query = materialFilter?.value.trim().toLowerCase() ?? '';
    materialSelect.replaceChildren(new Option("Matériau d'origine", ''));
    const groups = new Map<string, HTMLOptGroupElement>();
    for (const material of MATERIAL_CATALOG) {
      const url = new URL(material.path, document.baseURI).href;
      if (url !== selected && !`${material.group} ${material.label}`.toLowerCase().includes(query)) continue;
      let group = groups.get(material.group);
      if (!group) {
        group = document.createElement('optgroup');
        group.label = material.group;
        groups.set(material.group, group);
        materialSelect.appendChild(group);
      }
      group.appendChild(new Option(material.label, url));
    }
    materialSelect.value = selected;
  }

  function refreshObjects(): void {
    if (!objectSelect) return;
    const selected = objectSelect.value;
    objectSelect.replaceChildren();
    for (const object of viewer.objects) {
      const option = new Option(`${object.path.split('/').at(-1)} (${object.material})`, object.path);
      option.title = object.path;
      objectSelect.appendChild(option);
    }
    if (viewer.objects.some((object) => object.path === selected)) objectSelect.value = selected;
    refreshMaterials();
  }

  objectSelect?.addEventListener('change', refreshMaterials);
  materialFilter?.addEventListener('input', refreshMaterials);
  materialSelect?.addEventListener('change', async () => {
    if (!objectSelect) return;
    setBusy(true);
    setStatus('Compilation du matériau...');
    try {
      await viewer.setObjectMaterial(objectSelect.value, materialSelect.value || undefined);
      refreshObjects();
    } catch (error) {
      refreshMaterials();
      setStatus(`Echec du matériau: ${(error as Error)?.message ?? error}`);
    } finally {
      setBusy(false);
    }
  });

  async function loadEntry(entry: string): Promise<void> {
    setBusy(true);
    setStatus(`Chargement de ${entry}...`);
    try {
      await viewer.load(new URL(entry, document.baseURI).href);
      refreshObjects();
    } catch (e) {
      if (!deviceLost) setStatus(`Echec du chargement: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }

  select?.addEventListener('change', () => void loadEntry(select.value));
  rasterQuality?.addEventListener('change', async () => {
    const previous = viewer.rasterQuality;
    setBusy(true);
    setStatus('Compilation du profil raster...');
    try {
      const quality = rasterQuality.value;
      if (quality !== 'interactive' && quality !== 'reference') throw new Error('Unsupported raster quality.');
      await viewer.setRasterQuality(quality);
    } catch (error) {
      rasterQuality.value = previous;
      setStatus(`Echec du profil raster: ${(error as Error)?.message ?? error}`);
    } finally {
      setBusy(false);
    }
  });
  resolution?.addEventListener('change', async () => {
    const previousSize = canvas.width;
    setBusy(true);
    try {
      await viewer.resize(Number(resolution.value));
    } catch (error) {
      resolution.value = String(previousSize);
      setStatus(`Echec du redimensionnement: ${(error as Error)?.message ?? error}`);
    } finally {
      setBusy(false);
    }
  });
  for (const button of backendButtons) {
    button.addEventListener('click', () => {
      const backend = button.dataset.backend;
      if (backend !== 'raster' && backend !== 'pathtracing') return;
      viewer.setBackend(backend);
      updatePathTracingToggle(backend, viewer.pathTracingPaused);
      for (const modeButton of backendButtons) {
        modeButton.setAttribute('aria-pressed', String(modeButton === button));
      }
    });
  }

  await loadEntry(SCENE_CATALOG[0]!.entry);
}

void main();
