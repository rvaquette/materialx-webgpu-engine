import { describe, expect, it } from 'vitest';
import { buildMaterialTree } from '../../src/scene/material-tree.ts';

describe('material library navigation', () => {
  it('keeps every directory level and only lists materials directly in each folder', () => {
    const absval = { path: './scenes/mtlx-library/nodes/absval/absval.mtlx', label: 'absval' };
    const standard = { path: './scenes/mtlx-library/surfaces/standard_surface/roughness/test.mtlx', label: 'test' };
    const overview = { path: './scenes/mtlx-library/surfaces/overview.mtlx', label: 'overview' };
    const tree = buildMaterialTree([absval, standard, overview]);
    expect([...tree.folders.keys()]).toEqual(['nodes', 'surfaces']);
    expect(tree.materials).toEqual([]);
    expect(tree.folders.get('nodes')!.materials).toEqual([]);
    expect(tree.folders.get('nodes')!.folders.get('absval')!.materials).toEqual([absval]);
    const surfaces = tree.folders.get('surfaces')!;
    expect(surfaces.materials).toEqual([overview]);
    expect(surfaces.folders.get('standard_surface')!.folders.get('roughness')!.materials).toEqual([standard]);
  });

  it('handles an empty catalogue and rejects paths outside the library', () => {
    expect(buildMaterialTree([]).folders.size).toBe(0);
    expect(() => buildMaterialTree([{ path: './other.mtlx', label: 'other' }])).toThrow('outside library');
  });
});
