// Browser entry point. Drives the interactive on-canvas viewer (src/render/
// viewer.ts) on real USD scenes: a scene selector in index.html lets the user
// pick which .usda to load, and the viewer renders it with an orbit camera in
// either backend -- raster forward [r] or the WebGPU compute path tracer [p] --
// on the SAME imported resources (no reimport on backend switch). Loading a new
// scene disposes the previous GPU state and rebuilds both backends.

import { InteractiveViewer, type ViewerStatus } from './render/viewer.ts';
import { SCENE_CATALOG } from './scene/scene-catalog.ts';

function setStatus(text: string): void {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}

function formatStatus(s: ViewerStatus): string {
  const extra = s.backend === 'pathtracing' ? `, ${s.samples} spp${s.pathTracingPaused ? ' (pause)' : ''}` : '';
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
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    setStatus('No WebGPU adapter found.');
    return;
  }
  const device = await adapter.requestDevice();
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

  const viewer = new InteractiveViewer({
    device,
    context,
    outputFormat,
    canvas,
    onStatus: (s) => {
      setStatus(formatStatus(s));
      updatePathTracingToggle(s.backend, s.pathTracingPaused);
    },
  });

  pathTracingToggle?.addEventListener('click', () => {
    viewer.setPathTracingPaused(!viewer.pathTracingPaused);
    updatePathTracingToggle(viewer.backend, viewer.pathTracingPaused);
  });

  async function loadEntry(entry: string): Promise<void> {
    if (select) select.disabled = true;
    if (resolution) resolution.disabled = true;
    setStatus(`Chargement de ${entry}...`);
    try {
      await viewer.load(new URL(entry, document.baseURI).href);
    } catch (e) {
      setStatus(`Echec du chargement: ${(e as Error)?.message ?? e}`);
    } finally {
      if (select) select.disabled = false;
      if (resolution) resolution.disabled = false;
    }
  }

  select?.addEventListener('change', () => void loadEntry(select.value));
  resolution?.addEventListener('change', async () => {
    const previousSize = canvas.width;
    resolution.disabled = true;
    if (select) select.disabled = true;
    try {
      await viewer.resize(Number(resolution.value));
    } catch (error) {
      resolution.value = String(previousSize);
      setStatus(`Echec du redimensionnement: ${(error as Error)?.message ?? error}`);
    } finally {
      resolution.disabled = false;
      if (select) select.disabled = false;
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
