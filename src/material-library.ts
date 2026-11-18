import type { MaterialCatalogEntry } from './scene/material-catalog.ts';

const favoritesKey = 'materialx-webgpu-engine.material-favorites.v1';

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
    const relativePath = material.path.split('/mtlx-library/').at(-1)!;
    const text = searchKey(`${material.label} ${material.group} ${relativePath.replace(/\.mtlx$/i, '')}`);
    return words.every(word => text.includes(word));
  });
}

export function bindMaterialLibrary(
  dialog: HTMLDialogElement, catalog: readonly MaterialCatalogEntry[], apply: (path: string) => void,
): (object: string, selectedPath: string) => void {
  const search = dialog.querySelector<HTMLInputElement>('#material-library-search')!;
  const onlyFavorites = dialog.querySelector<HTMLInputElement>('#material-library-favorites')!;
  const results = dialog.querySelector<HTMLElement>('#material-library-results')!;
  const count = dialog.querySelector<HTMLElement>('#material-library-count')!;
  const storageStatus = dialog.querySelector<HTMLElement>('#material-library-storage')!;
  const target = dialog.querySelector<HTMLElement>('#material-library-target')!;
  const favorites = new Set<string>();
  const storageError = 'Stockage local indisponible : les changements de favoris peuvent être perdus au rechargement.';
  let selected = '';
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(favoritesKey) ?? '[]');
    if (!Array.isArray(saved) || !saved.every(path => typeof path === 'string')) throw new Error('Invalid favorites.');
    for (const path of saved) favorites.add(path);
  } catch {
    storageStatus.textContent = storageError;
  }

  function render(): void {
    const matches = filterMaterials(catalog, search.value, onlyFavorites.checked ? favorites : undefined);
    count.textContent = matches.length ? `${matches.length} matériau${matches.length === 1 ? '' : 'x'}` : 'Aucun matériau trouvé.';
    const rows = matches.map(material => {
      const row = document.createElement('li');
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.textContent = material.label;
      choice.disabled = material.path === selected;
      choice.onclick = () => { dialog.close(); apply(material.path); };
      const group = document.createElement('span');
      group.textContent = material.group;
      if (choice.disabled) group.append(' · appliqué');
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
      row.append(choice, group, favorite);
      return row;
    });
    results.replaceChildren(...rows);
    results.scrollTop = 0;
  }
  search.oninput = render;
  onlyFavorites.onchange = render;
  return (object, selectedPath) => {
    selected = selectedPath;
    target.textContent = `Objet sélectionné : ${object}`;
    render();
    if (!dialog.open) dialog.showModal();
    search.focus();
  };
}
