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

  const viewer = new InteractiveViewer({
    device,
    context,
    outputFormat,
    canvas,
    onStatus: (s) => {
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
  });

  pathTracingToggle?.addEventListener('click', () => {
    viewer.setPathTracingPaused(!viewer.pathTracingPaused);
    updatePathTracingToggle(viewer.backend, viewer.pathTracingPaused);
  });

  function setBusy(busy: boolean): void {
    if (select) select.disabled = busy;
    if (resolution) resolution.disabled = busy;
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
      setStatus(`Echec du chargement: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }

  select?.addEventListener('change', () => void loadEntry(select.value));
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
