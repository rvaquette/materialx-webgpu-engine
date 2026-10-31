import { afterEach, describe, expect, it, vi } from 'vitest';
import { importLocalGltf, resolveLocalGltfFile } from '../../src/scene/local-gltf.ts';

function fixture(binaryUri?: string) {
  const binary = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Parent', translation: [2, 0, 0], children: [1, 2] }, { name: 'First', mesh: 0 }, { name: 'Second', mesh: 0, scale: [-1, 1, 1] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ name: 'Copper', pbrMetallicRoughness: { baseColorFactor: [0.8, 0.4, 0.2, 1], metallicFactor: 0.9, roughnessFactor: 0.25 } }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36, ...(binaryUri ? { uri: binaryUri } : {}) }],
  };
  return { json, binary };
}

function glb(): File {
  const { json, binary } = fixture();
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonSize = Math.ceil(text.length / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + jsonSize + 8 + binary.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonSize, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + jsonSize); bytes.set(text, 20);
  view.setUint32(20 + jsonSize, binary.byteLength, true); view.setUint32(24 + jsonSize, 0x004e4942, true);
  bytes.set(new Uint8Array(binary.buffer), 28 + jsonSize);
  return new File([bytes], 'fixture.glb');
}

afterEach(() => vi.unstubAllGlobals());

describe('local glTF resources', () => {
  it('resolves selected dependencies, rejects missing, ambiguous and network resources', () => {
    const entry = new File([], 'scene.gltf');
    const image = new File([], 'base color.png');
    expect(resolveLocalGltfFile([entry, image], 'textures/base%20color.png', entry)).toBe(image);
    expect(() => resolveLocalGltfFile([entry], 'geometry.bin', entry)).toThrow('Missing or ambiguous');
    expect(() => resolveLocalGltfFile([entry, image, new File([], image.name)], 'textures/base%20color.png', entry)).toThrow('ambiguous');
    expect(() => resolveLocalGltfFile([entry], 'https://example.com/model.bin', entry)).toThrow('not allowed');
  });

  it('uses exact folder paths when textures share a basename', () => {
    const entry = new File([], 'scene.gltf');
    const first = new File([], 'color.png');
    const second = new File([], 'color.png');
    Object.defineProperty(entry, 'webkitRelativePath', { value: 'model/scene.gltf' });
    Object.defineProperty(first, 'webkitRelativePath', { value: 'model/first/color.png' });
    Object.defineProperty(second, 'webkitRelativePath', { value: 'model/second/color.png' });
    expect(resolveLocalGltfFile([entry, first, second], 'second/color.png', entry)).toBe(second);
  });

  it('imports GLB geometry, transforms, mirrored winding, shared materials and generated XML', async () => {
    vi.stubGlobal('document', { baseURI: 'http://localhost/app/' });
    const scene = await importLocalGltf([glb()]);
    try {
      expect(scene.options.imported?.scene.materials).toHaveLength(1);
      const geometries = [...scene.options.imported!.scene.prims.values()].filter(prim => prim.typeName === 'Mesh');
      expect(geometries).toHaveLength(2);
      const source = scene.options.imported!.meshSource;
      expect(source.meshFor(geometries[0]!.path)?.points).toEqual([2, 0, 0, 3, 0, 0, 2, 1, 0]);
      expect(source.meshFor(geometries[1]!.path)?.faceVertexIndices).toEqual([0, 2, 1]);
      const xml = [...scene.materialTexts.values()][0]!;
      expect(xml).toContain('disney_principled');
      expect(xml).toContain('Copper');
      expect(xml).toContain('value="0.9"');
      expect(scene.warnings.length).toBeGreaterThan(0);
    } finally { scene.dispose(); }
  });

  it('rejects multiple scene entries or missing glTF binary buffers explicitly', async () => {
    await expect(importLocalGltf([glb(), glb()])).rejects.toThrow('exactly one');
    const { json } = fixture('missing.bin');
    await expect(importLocalGltf([new File([JSON.stringify(json)], 'scene.gltf')])).rejects.toThrow('Missing or ambiguous');
  });
});
