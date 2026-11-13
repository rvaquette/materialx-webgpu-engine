import { compiledMaterialDirectory } from './compiled-paths.ts';

export interface MaterialCatalogEntry {
  /** Source MaterialX document (identifies the material in the UI and object state). */
  path: string;
  group: string;
  label: string;
  /** Precompiled package manifest applied at runtime. */
  compiled: string;
}

/** MaterialX library documents that have a precompiled package (`npm run compile:scenes`). */
export function compiledMaterialCatalog(sources: Iterable<string>, packages: Iterable<string>): MaterialCatalogEntry[] {
  const available = new Set([...packages].map(path => path.replace(/^\.?\//, '')));
  return [...sources].sort().flatMap((path) => {
    const compiled = `${compiledMaterialDirectory(path)}/material.json`;
    if (!available.has(compiled)) return [];
    const relative = path.slice(path.indexOf('/mtlx-library/') + '/mtlx-library/'.length);
    const parts = relative.split('/');
    return [{
      path: `./${path.replace(/^\.?\//, '')}`,
      group: parts.slice(0, -2).join('/') || parts[0] || 'MaterialX',
      label: parts.at(-1)!.replace(/\.mtlx$/, '').replace(/_/g, ' '),
      compiled: `./${compiled}`,
    }];
  });
}

export const MATERIAL_CATALOG: readonly MaterialCatalogEntry[] = compiledMaterialCatalog(
  Object.keys(import.meta.glob('/scenes/mtlx-library/**/*.mtlx', { query: '?url', import: 'default' })),
  Object.keys(import.meta.glob('/scenes/compiled/mtlx-library/**/material.json', { query: '?url', import: 'default' })),
);
