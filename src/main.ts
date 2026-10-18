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
  const extra = s.backend === 'pathtracing' ? `, ${s.samples} spp` : '';
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
  const context = canvas?.getContext('webgpu') ?? null;
  if (!canvas || !context) {
    setStatus('WebGPU adapter ready; no canvas context.');
    return;
  }
  const outputFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: outputFormat, alphaMode: 'opaque' });

  const select = document.getElementById('scene') as HTMLSelectElement | null;
  if (select) populateSelector(select);
  const backendButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#backend-mode button[data-backend]'));

  const viewer = new InteractiveViewer({
    device,
    context,
    outputFormat,
    canvas,
    onStatus: (s) => setStatus(formatStatus(s)),
  });

  async function loadEntry(entry: string): Promise<void> {
    setStatus(`Chargement de ${entry}...`);
    try {
      await viewer.load(new URL(entry, document.baseURI).href);
    } catch (e) {
      setStatus(`Echec du chargement: ${(e as Error)?.message ?? e}`);
    }
  }

  select?.addEventListener('change', () => void loadEntry(select.value));
  for (const button of backendButtons) {
    button.addEventListener('click', () => {
      const backend = button.dataset.backend;
      if (backend !== 'raster' && backend !== 'pathtracing') return;
      viewer.setBackend(backend);
      for (const modeButton of backendButtons) {
        modeButton.setAttribute('aria-pressed', String(modeButton === button));
      }
    });
  }

  await loadEntry(SCENE_CATALOG[0]!.entry);
}

void main();
