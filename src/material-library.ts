import type { MaterialCatalogEntry } from './scene/material-catalog.ts';
import type { RgbaCapture } from './gpu/capture.ts';
import { importMaterialFiles, loadExternalMaterialCatalog, resolveExternalMaterial } from './materialx/material-library-sources.ts';

const favoritesKey = 'materialx-webgpu-engine.material-favorites.v1';
type LibrarySource = 'local' | 'ambientcg' | 'physicallybased' | 'imported';

export interface MaterialLibraryOptions {
  capturePreview?: (entry: MaterialCatalogEntry, signal: AbortSignal) => Promise<RgbaCapture>;
}

function searchKey(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[_/.-]+/g, ' ');
}

export function filterMaterials(
  catalog: readonly MaterialCatalogEntry[], query: string, favorites?: ReadonlySet<string>,
): MaterialCatalogEntry[] {
  const words = searchKey(query).trim().split(/\s+/).filter(Boolean);
  return catalog.filter(material => {
    if (favorites && !favorites.has(material.path)) return false;
    if (!words.length) return true;
    const relativePath = material.path.split('/mtlx-library/').at(-1) ?? material.path;
    const text = searchKey(`${material.label} ${material.group} ${material.source ?? ''} ${relativePath.replace(/\.mtlx$/i, '')}`);
    return words.every(word => text.includes(word));
  });
}

export function bindMaterialLibrary(
  dialog: HTMLDialogElement, catalog: readonly MaterialCatalogEntry[], apply: (path: string) => void,
  options: MaterialLibraryOptions = {},
): (object: string, selectedPath: string) => void {
  const search = dialog.querySelector<HTMLInputElement>('#material-library-search')!;
  const onlyFavorites = dialog.querySelector<HTMLInputElement>('#material-library-favorites')!;
  const sourceChooser = dialog.querySelector<HTMLSelectElement>('#material-library-source')!;
  const importButton = dialog.querySelector<HTMLButtonElement>('#material-library-import')!;
  const importInput = dialog.querySelector<HTMLInputElement>('#material-library-files')!;
  const results = dialog.querySelector<HTMLElement>('#material-library-results')!;
  const count = dialog.querySelector<HTMLElement>('#material-library-count')!;
  const moreButton = dialog.querySelector<HTMLButtonElement>('#material-library-more')!;
  const storageStatus = dialog.querySelector<HTMLElement>('#material-library-storage')!;
  const sourceStatus = dialog.querySelector<HTMLElement>('#material-library-source-status')!;
  const target = dialog.querySelector<HTMLElement>('#material-library-target')!;
  const favorites = new Set<string>();
  const imported: MaterialCatalogEntry[] = [];
  const external = new Map<'ambientcg' | 'physicallybased', MaterialCatalogEntry[]>();
  const storageError = 'Stockage local indisponible : les changements de favoris peuvent être perdus au rechargement.';
  let selected = '';
  let object = '';
  let source: LibrarySource = 'local';
  let activeCatalog: readonly MaterialCatalogEntry[] = catalog;
  let visibleLimit = 100;
  let previewObserver: IntersectionObserver | undefined;
  let previewQueue: { entry: MaterialCatalogEntry; canvas: HTMLCanvasElement; status: HTMLElement }[] = [];
  let previewRunning = false;
  const previewControllers = new Set<AbortController>();
  const applying = new Set<string>();
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(favoritesKey) ?? '[]');
    if (!Array.isArray(saved) || !saved.every(path => typeof path === 'string')) throw new Error('Invalid favorites.');
    for (const path of saved) favorites.add(path);
  } catch {
    storageStatus.textContent = storageError;
  }

  function cancelPreviews(): void {
    previewObserver?.disconnect();
    previewQueue = [];
    for (const controller of previewControllers) controller.abort();
    previewControllers.clear();
  }

  async function drainPreviews(): Promise<void> {
    if (previewRunning || !options.capturePreview) return;
    previewRunning = true;
    try {
      while (previewQueue.length) {
        const request = previewQueue.shift()!;
        if (!request.canvas.isConnected) continue;
        const controller = new AbortController();
        previewControllers.add(controller);
        request.status.textContent = 'Rendu de la vignette…';
        try {
          const image = await options.capturePreview(request.entry, controller.signal);
          if (!controller.signal.aborted && request.canvas.isConnected) {
            request.canvas.width = image.width;
            request.canvas.height = image.height;
            request.canvas.getContext('2d')?.putImageData(
              new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0,
            );
            request.status.textContent = '';
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            request.status.textContent = `Aperçu indisponible : ${error instanceof Error ? error.message : String(error)}`;
          }
        } finally {
          previewControllers.delete(controller);
        }
      }
    } finally {
      previewRunning = false;
    }
  }

  async function choose(material: MaterialCatalogEntry): Promise<void> {
    if (applying.has(material.path)) return;
    applying.add(material.path);
    sourceStatus.textContent = material.provider ? `Import de ${material.label}…` : `Application de ${material.label}…`;
    render();
    try {
      const ready = material.provider ? await resolveExternalMaterial(material) : material;
      if (material.provider && !imported.some(item => item.path === ready.path)) imported.unshift(ready);
      dialog.close();
      apply(ready.path);
    } catch (error) {
      sourceStatus.textContent = `Import impossible : ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      applying.delete(material.path);
      if (dialog.open) render();
    }
  }

  function render(): void {
    cancelPreviews();
    const matches = filterMaterials(activeCatalog, search.value, onlyFavorites.checked ? favorites : undefined);
    count.textContent = matches.length
      ? `${Math.min(matches.length, visibleLimit)} affichés sur ${matches.length} matériau${matches.length === 1 ? '' : 'x'}`
      : 'Aucun matériau trouvé.';
    moreButton.hidden = matches.length <= visibleLimit;
    const targets = new Map<Element, { entry: MaterialCatalogEntry; canvas: HTMLCanvasElement; status: HTMLElement }>();
    const rows = matches.slice(0, visibleLimit).map(material => {
      const row = document.createElement('li');
      row.draggable = true;
      row.addEventListener('dragstart', (event) => {
        if (!event.dataTransfer) return;
        event.dataTransfer.setData('application/x-materialx-entry', material.path);
        event.dataTransfer.effectAllowed = 'copy';
      });
      const preview = document.createElement('div');
      preview.className = 'material-library-preview';
      if (material.preview) {
        const image = document.createElement('img');
        image.src = material.preview;
        image.alt = `Aperçu source : ${material.label}`;
        image.loading = 'lazy';
        preview.append(image);
      } else {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 80;
        canvas.setAttribute('aria-label', `Vignette raster de ${material.label}`);
        const previewStatus = document.createElement('small');
        preview.append(canvas, previewStatus);
        targets.set(preview, { entry: material, canvas, status: previewStatus });
      }
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.textContent = material.label;
      choice.dataset.materialPath = material.path;
      choice.disabled = material.path === selected || applying.has(material.path);
      choice.onclick = () => { void choose(material); };
      const group = document.createElement('span');
      group.textContent = `${material.group}${material.source ? ` · ${material.source}` : ''}`;
      if (choice.disabled && material.path === selected) group.append(' · appliqué');
      const favorite = document.createElement('button');
      favorite.type = 'button';
      favorite.setAttribute('aria-label', `Favori : ${material.label} (${material.group})`);
      function updateFavorite(): void {
        const enabled = favorites.has(material.path);
        favorite.setAttribute('aria-pressed', String(enabled));
        favorite.textContent = enabled ? '★' : '☆';
      }
      updateFavorite();
      favorite.onclick = () => {
        if (favorites.has(material.path)) favorites.delete(material.path);
        else favorites.add(material.path);
        try {
          localStorage.setItem(favoritesKey, JSON.stringify([...favorites]));
          storageStatus.textContent = '';
        } catch {
          storageStatus.textContent = storageError;
        }
        if (!onlyFavorites.checked) updateFavorite();
        else { render(); onlyFavorites.focus(); }
      };
      row.append(preview, choice, group, favorite);
      return row;
    });
    results.replaceChildren(...rows);
    for (const [element, request] of targets) {
      if (previewObserver) previewObserver.observe(element);
      else if (options.capturePreview) previewQueue.push(request);
    }
    if (!previewObserver && previewQueue.length) void drainPreviews();
  }

  if (typeof window !== 'undefined' && 'IntersectionObserver' in window) {
    previewObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        previewObserver?.unobserve(entry.target);
        const request = (entry.target as HTMLElement);
        const targetEntry = [...results.querySelectorAll<HTMLElement>('.material-library-preview')].find(item => item === request);
        if (!targetEntry) continue;
        const row = targetEntry.closest('li');
        const path = row?.querySelector<HTMLButtonElement>('button')?.dataset.materialPath;
        const entryData = activeCatalog.find(item => item.path === path);
        const canvas = targetEntry.querySelector('canvas');
        const status = targetEntry.querySelector('small');
        if (entryData && canvas && status) {
          previewQueue.push({ entry: entryData, canvas, status });
          void drainPreviews();
        }
      }
    }, { root: results, rootMargin: '120px' });
  }

  search.oninput = () => { visibleLimit = 100; render(); };
  onlyFavorites.onchange = render;
  moreButton.onclick = () => { visibleLimit += 100; render(); };
  sourceChooser.onchange = () => {
    source = sourceChooser.value as LibrarySource;
    visibleLimit = 100;
    sourceStatus.textContent = '';
    if (source === 'local') {
      activeCatalog = catalog;
      render();
      return;
    }
    if (source === 'imported') {
      activeCatalog = imported;
      render();
      return;
    }
    const provider = source;
    const cached = external.get(provider);
    if (cached) {
      activeCatalog = cached;
      sourceStatus.textContent = provider === 'ambientcg'
        ? 'Catalogue AmbientCG chargé : les archives 1K JPG seront converties en MaterialX à l’import.'
        : 'Matériaux libres de droits CC0 publiés par Physically Based.';
      render();
      return;
    }
    sourceStatus.textContent = 'Chargement du catalogue distant…';
    void loadExternalMaterialCatalog(provider).then((entries) => {
      external.set(provider, entries);
      if (source !== provider) return;
      activeCatalog = entries;
      sourceStatus.textContent = provider === 'ambientcg'
        ? 'Catalogue AmbientCG chargé : les archives 1K JPG seront converties en MaterialX à l’import.'
        : 'Matériaux libres de droits CC0 publiés par Physically Based.';
      render();
    }).catch((error: unknown) => {
      if (source !== provider) return;
      activeCatalog = [];
      const reason = error instanceof Error ? error.message : String(error);
      sourceStatus.textContent = provider === 'ambientcg'
        ? `Catalogue indisponible : ${reason}. AmbientCG peut bloquer l’accès API par CORS : ouvre son site, télécharge une archive ZIP 1K JPG puis importe-la ici.`
        : `Catalogue indisponible : ${reason}`;
      render();
    });
  };
  importButton.onclick = () => importInput.click();
  importInput.onchange = () => {
    const files = [...(importInput.files ?? [])];
    if (!files.length) return;
    sourceStatus.textContent = 'Lecture du document MaterialX…';
    void importMaterialFiles(files).then((entry) => {
      imported.unshift(entry);
      source = 'imported';
      sourceChooser.value = source;
      activeCatalog = imported;
      sourceStatus.textContent = `${entry.label} importé.`;
      render();
    }).catch((error: unknown) => {
      sourceStatus.textContent = `Import impossible : ${error instanceof Error ? error.message : String(error)}`;
    }).finally(() => { importInput.value = ''; });
  };
  const externalLink = dialog.querySelector<HTMLAnchorElement>('#material-library-external')!;
  sourceChooser.addEventListener('change', () => {
    externalLink.href = source === 'ambientcg' ? 'https://ambientcg.com/list?type=material&sort=popular'
      : source === 'physicallybased' ? 'https://physicallybased.info/'
        : 'https://matlib.gpuopen.com/main/materials/all';
    externalLink.textContent = source === 'ambientcg' ? 'Parcourir AmbientCG'
      : source === 'physicallybased' ? 'Parcourir Physically Based'
        : 'GPUOpen : télécharger une archive MaterialX';
  });
  target.addEventListener('dragover', (event) => {
    if (event.dataTransfer && Array.from(event.dataTransfer.types).includes('application/x-materialx-entry')) {
      event.preventDefault();
      target.classList.add('material-library-drop-target');
    }
  });
  target.addEventListener('dragleave', () => target.classList.remove('material-library-drop-target'));
  target.addEventListener('drop', (event) => {
    event.preventDefault();
    target.classList.remove('material-library-drop-target');
    const path = event.dataTransfer?.getData('application/x-materialx-entry');
    const material = [...catalog, ...imported, ...external.values()].flat().find(item => item.path === path);
    if (material) void choose(material);
  });

  return (selectedObject, selectedPath) => {
    object = selectedObject;
    selected = selectedPath;
    target.textContent = `Objet sélectionné : ${object} — déposer un matériau ici pour l’appliquer`;
    if (!dialog.open) dialog.showModal();
    render();
    search.focus();
  };
}
