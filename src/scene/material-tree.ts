export interface MaterialTreeEntry {
  path: string;
  label: string;
}

export interface MaterialFolder {
  folders: Map<string, MaterialFolder>;
  materials: MaterialTreeEntry[];
}

export function buildMaterialTree(entries: readonly MaterialTreeEntry[]): MaterialFolder {
  const root: MaterialFolder = { folders: new Map(), materials: [] };
  for (const entry of entries) {
    const relative = entry.path.split('/mtlx-library/')[1];
    if (!relative) throw new Error(`Material outside library: ${entry.path}`);
    const folders = relative.split('/').slice(0, -1);
    let node = root;
    for (const name of folders) {
      let child = node.folders.get(name);
      if (!child) {
        child = { folders: new Map(), materials: [] };
        node.folders.set(name, child);
      }
      node = child;
    }
    node.materials.push(entry);
  }
  return root;
}
