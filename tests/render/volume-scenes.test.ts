import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { importUsdStage } from '../../src/usd/importer.ts';
import { resolveSceneMaterials } from '../../src/usd/materials.ts';

it.each(['volumeshader_test', 'volume_cube'])('%s imports renderable meshes and real MaterialX references', async name => {
  const text = await readFile(fileURLToPath(new URL(`../../scenes/pathtracer/${name}.usda`, import.meta.url)), 'utf8');
  const scene = await importUsdStage(`${name}.usda`, { reader: { read: async () => text } });
  const meshes = [...scene.prims.values()].filter(p => p.typeName === 'Mesh');
  expect(meshes.length).toBeGreaterThanOrEqual(2);
  expect(meshes.filter(p => p.attributes.has('engine:geometry:file'))).toHaveLength(2);
  expect(scene.materials).toHaveLength(2);
  expect(resolveSceneMaterials(scene).units).toHaveLength(2);
  expect(scene.materials.every(m => m.assetPath.endsWith(`${name}.mtlx`))).toBe(true);
});

it.each(['volume_heterogeneous', 'volume_emission'])('%s imports a closed mesh and a MaterialX volume', async name => {
  const text = await readFile(fileURLToPath(new URL(`../../scenes/pathtracer/${name}.usda`,import.meta.url)),'utf8');
  const scene = await importUsdStage(`${name}.usda`, { reader: { read: async () => text } });
  expect([...scene.prims.values()].filter(p => p.typeName === 'Mesh')).toHaveLength(1);
  expect(scene.materials).toHaveLength(1);
  expect(scene.materials[0]!.assetPath).toBe(`./${name}.mtlx`);
});
