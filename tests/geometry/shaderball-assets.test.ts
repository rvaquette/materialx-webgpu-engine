import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importUsdStage } from '../../src/usd/importer.ts';
import { importCameras } from '../../src/usd/cameras.ts';
import { importLights } from '../../src/usd/lights.ts';
import { resolveSceneMaterials } from '../../src/usd/materials.ts';
import { loadExternalMeshSource } from '../../src/geometry/external-mesh.ts';
import { computeWorldTransforms, transformPoint } from '../../src/scene/transforms.ts';
import type { Diagnostic } from '../../src/core/diagnostics.ts';

const root = resolve('scenes', 'standard-shader-ball');
const read = async (uri: string) => {
  const data = await readFile(resolve(root, uri));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
};

describe('local shaderball geometry assets', () => {
  it.each([
    ['standard-shader-ball.usda', [
      ['/World/Geometry/NeutralObjects', 9088],
      ['/World/Geometry/OpenPBRShaderBall', 46704],
      ['/World/Ground', 2],
    ]],
    ['openpbr-rva-standard-shader-ball.usda', [
      ['/World/Geometry/Preview_Mesh', 70808],
      ['/World/Geometry/Calibration_Mesh', 17456],
    ]],
  ] as const)('loads %s from local geometry files', async (entry, expected) => {
    const scene = await importUsdStage(entry, { reader: { read: (uri) => readFile(resolve(root, uri), 'utf8') } });
    const diagnostics: Diagnostic[] = [];
    const source = await loadExternalMeshSource(scene, { meshFor: () => undefined }, (d) => diagnostics.push(d), read);
    for (const [path, triangles] of expected) {
      expect(scene.prims.get(path)?.attributes.has('points')).toBe(false);
      const mesh = source.meshFor(path)!;
      expect(mesh, path).toBeDefined();
      expect(mesh.faceVertexCounts.length).toBe(triangles);
      expect(mesh.faceVertexIndices.length).toBe(triangles * 3);
      expect(mesh.normals?.values.every(Number.isFinite)).toBe(true);
      expect(mesh.primvars?.[0]?.values.every(Number.isFinite)).toBe(true);
    }
    expect(diagnostics).toEqual([]);
    expect(importCameras(scene)).toHaveLength(1);
    const [environment] = importLights(scene);
    expect(environment?.textureFile).toBeDefined();
    expect(environment?.irradianceFile).toBeDefined();
    for (const asset of [environment!.textureFile!, environment!.irradianceFile!]) {
      expect((await read(asset)).byteLength).toBeGreaterThan(0);
    }
    if (entry === 'openpbr-rva-standard-shader-ball.usda') {
      const bindings = resolveSceneMaterials(scene).bindings;
      for (const [path] of expected) expect(bindings.get(path)?.materialPath).toBe('/World/Looks/OpenPBRMaterial');
      const [camera] = importCameras(scene);
      expect(camera!.transform.slice(12, 15)).toEqual([-0.05, 1.05, 3.58]);
      expect(camera!.fovY).toBeCloseTo(Math.PI / 4, 7);
      expect(camera!.aspectRatio).toBeCloseTo(16 / 9, 7);
      const world = computeWorldTransforms(scene);
      const mesh = source.meshFor('/World/Geometry/Preview_Mesh')!;
      const first = transformPoint(world.get('/World/Geometry/Preview_Mesh')!, [mesh.points[0]!, mesh.points[1]!, mesh.points[2]!]);
      expect(first[0]).toBeCloseTo(-0.120526, 5);
      expect(first[1]).toBeCloseTo(0.550871, 5);
      expect(first[2]).toBeCloseTo(-0.672522, 5);
      expect(scene.materials).toHaveLength(0);
    }
  });
});
