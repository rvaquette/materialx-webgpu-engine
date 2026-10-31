import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importUsdStage } from '../../src/usd/importer.ts';
import { loadExternalMeshSource } from '../../src/geometry/external-mesh.ts';
import { prepareMesh } from '../../src/geometry/prepare.ts';
import type { Diagnostic } from '../../src/core/diagnostics.ts';
import { importCameras } from '../../src/usd/cameras.ts';
import { importLights } from '../../src/usd/lights.ts';

const triangleObj = `o Triangle
v 0 0 0
v 1 0 0
v 0 1 0
vt 0 0
vt 1 0
vt 0 1
vn 0 0 1
f -3/1/1 -2/2/1 -1/3/1
`;
const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;
const empty = { meshFor: () => undefined };

async function stage(body: string) {
  return importUsdStage('/scenes/root.usda', { reader: { read: async () => `#usda 1.0\n${body}` } });
}

function glb(): ArrayBuffer {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const uvs = new Float32Array([0, 0.25, 1, 0.25, 0, 1.25]);
  const binary = new Uint8Array(60);
  binary.set(new Uint8Array(positions.buffer));
  binary.set(new Uint8Array(uvs.buffer), 36);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'Parent', translation: [10, 0, 0], children: [1, 2] },
      { name: 'First', mesh: 0, translation: [0, 2, 0], scale: [2, 1, 1] },
      { name: 'Mirrored', mesh: 0, scale: [-1, 1, 1] },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 } }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 24 }],
    buffers: [{ byteLength: 60 }],
  };
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4;
  const output = new ArrayBuffer(12 + 8 + jsonLength + 8 + binary.length);
  const view = new DataView(output);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, output.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(output, 20, jsonLength).fill(32);
  new Uint8Array(output, 20, text.length).set(text);
  view.setUint32(20 + jsonLength, binary.length, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  new Uint8Array(output, 28 + jsonLength).set(binary);
  return output;
}

describe('Three.js external geometry bridge', () => {
  it('loads a USDA glTF reference and its relative binary without importing glTF shading', async () => {
    const scene = await stage(`def Mesh "Asset" {
      custom asset engine:geometry:file = @./models/triangle.gltf@
      rel material:binding = </Looks/UsdMaterial>
    }`);
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const json = {
      asset: { version: '2.0' }, scenes: [{ nodes: [0] }], scene: 0, nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
      buffers: [{ byteLength: 36, uri: 'triangle.bin' }],
      materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      textures: [{ source: 0 }], images: [{ uri: 'must-not-load.png' }],
    };
    const read = vi.fn(async (uri: string) => {
      if (uri === '/scenes/models/triangle.gltf') return bytes(JSON.stringify(json));
      if (uri === '/scenes/models/triangle.bin') return positions.buffer;
      throw new Error(`Unexpected resource request: ${uri}`);
    });
    const source = await loadExternalMeshSource(scene, empty, () => {}, read);
    expect(source.meshFor('/Asset')?.points).toEqual(Array.from(positions));
    expect(scene.prims.get('/Asset')?.materialBinding?.target).toBe('/Looks/UsdMaterial');
    expect(read.mock.calls.map(call => call[0])).toEqual(['/scenes/models/triangle.gltf', '/scenes/models/triangle.bin']);
  });

  it('loads converted Ajax geometry with its authored material, camera and environment', async () => {
    const text = readFileSync(join('scenes', 'pathtracer', 'ajax.usda'), 'utf8');
    const scene = await importUsdStage('/scenes/pathtracer/ajax.usda', { reader: { read: async () => text } });
    const read = vi.fn(async () => bytes(triangleObj));
    const source = await loadExternalMeshSource(scene, empty, () => {}, read);
    expect(read).toHaveBeenCalledWith('/scenes/pathtracer/ajax/ajax.obj');
    expect(source.meshFor('/World/Geometry/ajax')?.faceVertexCounts).toEqual([3]);
    expect(scene.prims.get('/World/Geometry/ajax')?.materialBinding?.target).toBe('/World/Looks/black');
    const camera = importCameras(scene)[0]!;
    expect(camera.fovY * 180 / Math.PI).toBeCloseTo(35);
    expect(camera.transform[14]).toBeCloseTo(-1.8);
    expect(camera.transform[10]).toBeCloseTo(-1);
    const dome = importLights(scene).find(light => light.type === 'dome')!;
    expect(dome.textureFile).toBe('./HDR/sunset.hdr');
    expect(dome.intensity).toBe(5);
  });

  it('loads OBJ positions, negative indices, authored normals and UVs', async () => {
    const scene = await stage('def Mesh "mesh" { asset engine:geometry:file = @./triangle.obj@ string engine:geometry:object = "Triangle" }');
    const read = vi.fn(async () => bytes(triangleObj));
    const source = await loadExternalMeshSource(scene, empty, () => {}, read);
    const raw = source.meshFor('/mesh')!;
    expect(read).toHaveBeenCalledWith('/scenes/triangle.obj');
    expect(raw.points).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(raw.faceVertexCounts).toEqual([3]);
    expect(raw.normals?.values).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect(raw.primvars?.[0]?.values).toEqual([0, 0, 1, 0, 0, 1]);
    expect(prepareMesh(raw).indices.length).toBe(3);
  });

  it('loads a GLB once, selects objects and bakes parent/node transforms without USD transforms', async () => {
    const scene = await stage(`def Mesh "a" {
      asset engine:geometry:file = @objects.glb@
      string engine:geometry:object = "First"
      double3 xformOp:translate = (100, 0, 0)
      uniform token[] xformOpOrder = ["xformOp:translate"]
    }
    def Mesh "b" { asset engine:geometry:file = @objects.glb@ string engine:geometry:object = "Mirrored" }`);
    const read = vi.fn(async () => glb());
    const source = await loadExternalMeshSource(scene, empty, () => {}, read);
    expect(read).toHaveBeenCalledTimes(1);
    expect(source.meshFor('/a')?.points).toEqual([10, 2, 0, 12, 2, 0, 10, 3, 0]);
    expect(source.meshFor('/b')?.points).toEqual([10, 0, 0, 9, 0, 0, 10, 1, 0]);
    expect(source.meshFor('/b')?.faceVertexIndices).toEqual([0, 2, 1]);
    expect(prepareMesh(source.meshFor('/b')!).normals[2]).toBe(1);
  });

  it('merges a selected GLB hierarchy when no object selector is authored', async () => {
    const scene = await stage('def Mesh "mesh" { asset engine:geometry:file = @objects.glb@ }');
    const source = await loadExternalMeshSource(scene, empty, () => {}, async () => glb());
    expect(source.meshFor('/mesh')?.faceVertexCounts).toEqual([3, 3]);
    expect(source.meshFor('/mesh')?.faceVertexIndices).toEqual([0, 1, 2, 3, 5, 4]);
    const normals = source.meshFor('/mesh')!.normals!.values;
    expect(normals).toHaveLength(18);
    for (let i = 0; i < normals.length; i++) expect(normals[i]).toBeCloseTo(i % 3 === 2 ? 1 : 0);
  });

  it('converts GLB UVs once to MaterialX space, preserving tiling and tangent handedness', async () => {
    const scene = await stage(`def Mesh "a" { asset engine:geometry:file = @objects.glb@ string engine:geometry:object = "First" }
      def Mesh "b" { asset engine:geometry:file = @objects.glb@ string engine:geometry:object = "First" }`);
    const read = vi.fn(async () => glb());
    const source = await loadExternalMeshSource(scene, empty, () => {}, read);
    expect(read).toHaveBeenCalledTimes(1);
    for (const path of ['/a', '/b']) {
      const raw = source.meshFor(path)!;
      expect(raw.primvars?.[0]?.values).toEqual([0, 0.75, 1, 0.75, 0, -0.25]);
      const prepared = prepareMesh(raw);
      expect(Array.from(prepared.uvs!)).toEqual([0, 0.75, 1, 0.75, 0, -0.25]);
      expect(Array.from(prepared.tangents!)).toEqual([1, 0, 0, -1, 1, 0, 0, -1, 1, 0, 0, -1]);
    }
  });

  it('warns explicitly when merging objects with mixed UV availability', async () => {
    const scene = await stage('def Mesh "mesh" { asset engine:geometry:file = @objects.obj@ }');
    const diagnostics: Diagnostic[] = [];
    const source = await loadExternalMeshSource(scene, empty, (d) => diagnostics.push(d),
      async () => bytes(`${triangleObj}\no WithoutUV\nf 1 2 3\n`));
    expect(source.meshFor('/mesh')?.faceVertexCounts).toEqual([3, 3]);
    expect(source.meshFor('/mesh')?.primvars).toBeUndefined();
    expect(diagnostics).toMatchObject([{ level: 'warning', message: expect.stringContaining('Mixed UV availability') }]);
  });

  it.each([
    ['normal', triangleObj.replace('vn 0 0 1', 'vn NaN 0 1')],
    ['UV', triangleObj.replace('vt 0 0', 'vt NaN 0')],
  ])('rejects nonfinite %s data', async (attribute, obj) => {
    const scene = await stage('def Mesh "mesh" { asset engine:geometry:file = @invalid.obj@ }');
    const diagnostics: Diagnostic[] = [];
    await expect(loadExternalMeshSource(scene, empty, (d) => diagnostics.push(d), async () => bytes(obj)))
      .rejects.toThrow(`Invalid ${attribute}`);
    expect(diagnostics).toMatchObject([{ level: 'error' }]);
  });

  it('resolves geometry relative to its authoring sublayer', async () => {
    const scene = await importUsdStage('/root.usda', { reader: { read: async (uri) => uri === '/root.usda'
      ? '#usda 1.0\n(subLayers = [@layers/geometry.usda@])'
      : '#usda 1.0\ndef Mesh "mesh" { asset engine:geometry:file = @../assets/triangle.obj@ }' } });
    const read = vi.fn(async () => bytes(triangleObj));
    await loadExternalMeshSource(scene, empty, () => {}, read);
    expect(read).toHaveBeenCalledWith('/assets/triangle.obj');
  });

  it('preserves inline meshes in a mixed scene', async () => {
    const scene = await stage('def Mesh "inline" {}');
    const raw = { points: [0, 0, 0], faceVertexCounts: [], faceVertexIndices: [] };
    const read = vi.fn();
    const source = await loadExternalMeshSource(scene, { meshFor: () => raw }, () => {}, read);
    expect(source.meshFor('/inline')).toBe(raw);
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ['missing.obj', 'Triangle', 'unavailable'],
    ['triangle.obj', 'Missing', 'found 0'],
    ['mesh.fbx', '', 'Unsupported geometry format'],
    ['triangle.glb', '', 'Unexpected'],
  ])('reports and rejects invalid geometry: %s %s', async (file, objectName, reason) => {
    const scene = await stage(`def Mesh "mesh" {
      asset engine:geometry:file = @${file}@
      ${objectName ? `string engine:geometry:object = "${objectName}"` : ''}
    }`);
    const diagnostics: Diagnostic[] = [];
    const read = async () => {
      if (file === 'missing.obj') throw new Error('unavailable');
      return bytes(triangleObj);
    };
    await expect(loadExternalMeshSource(scene, empty, (d) => diagnostics.push(d), read)).rejects.toThrow(reason);
    expect(diagnostics).toMatchObject([{ level: 'error', message: expect.stringContaining('/mesh') }]);
  });
});
