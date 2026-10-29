import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importUsdStage } from '../../src/usd/importer.ts';
import { importCameras } from '../../src/usd/cameras.ts';
import { importLights } from '../../src/usd/lights.ts';
import { computeWorldTransforms, transformDirection } from '../../src/scene/transforms.ts';
import { loadExternalMeshSource } from '../../src/geometry/external-mesh.ts';

const directory = join('scenes', 'pathtracer');
const files = readdirSync(directory).filter(file => file.endsWith('.usda')).sort();
const knownMissing = new Set(['jinx.gltf', 'panther/panther.obj']);
const read = (file: string) => readFileSync(join(directory, file), 'utf8');

async function load(file: string) {
  const diagnostics: string[] = [];
  const scene = await importUsdStage(`/scenes/pathtracer/${file}`, {
    reader: { read: async uri => read(uri.split('/').at(-1)!) },
    sink: diagnostic => { if (diagnostic.level === 'error') diagnostics.push(diagnostic.message); },
  });
  expect(diagnostics).toEqual([]);
  return scene;
}

describe('converted pathtracer USDA scenes', () => {
  it('covers all 59 stages and records only the two known missing assets', () => {
    expect(files).toHaveLength(59);
    const missing = new Set<string>();
    for (const file of files) {
      for (const match of read(file).matchAll(/@\.\/([^@]+)@/g)) {
        if (!existsSync(join(directory, match[1]!))) missing.add(match[1]!);
      }
    }
    expect(missing).toEqual(knownMissing);
  });

  it.each(files)('%s imports geometry contracts, bindings, camera and USD lights', async file => {
    const text = read(file);
    expect(text).not.toContain('engine:geometry:source');
    const source = read(file.replace('.usda', '.scene')).replace(/#.*|\/\/[^\n]*/g, '');
    const scene = await load(file);
    const camera = importCameras(scene)[0]!;
    expect(importCameras(scene)).toHaveLength(1);
    expect(camera.transform.every(Number.isFinite)).toBe(true);
    const fov = Number(/^\s*fov\s+(\S+)/m.exec(source)?.[1] ?? 45);
    const resolution = /^\s*resolution\s+(\d+)\s+(\d+)/m.exec(source)!;
    expect(camera.aspectRatio).toBeCloseTo(Number(resolution[1]) / Number(resolution[2]), 7);
    expect(2 * Math.atan(camera.horizontalAperture / (2 * camera.focalLength)) * 180 / Math.PI).toBeCloseTo(fov, 7);
    expect(camera.clippingRange[0]).toBeGreaterThan(0);
    const target = scene.prims.get('/World/Camera')!.attributes.get('pathtracer:lookAt')!.value as number[];
    const delta = target.map((value, i) => value - camera.transform[12 + i]!);
    const direction = transformDirection(camera.transform, [0, 0, -1]);
    direction.forEach((value, i) => expect(value).toBeCloseTo(delta[i]! / Math.hypot(...delta), 6));

    const geometry = [...scene.prims.values()].filter(prim => prim.attributes.has('engine:geometry:file'));
    expect(geometry.length).toBeGreaterThan(0);
    for (const prim of geometry) {
      expect(prim.typeName).toBe('Mesh');
      expect(scene.prims.has(prim.materialBinding!.target)).toBe(true);
      expect(scene.materials.some(material => material.primPath === prim.materialBinding!.target)).toBe(true);
    }
    const lights = importLights(scene);
    const sourceLights = [...source.matchAll(/^\s*light\s*\{([^{}]*)\}/gm)];
    const areaLights = lights.filter(light => light.type !== 'dome');
    expect(areaLights).toHaveLength(sourceLights.length);
    sourceLights.forEach((match, index) => {
      const body = match[1]!;
      const vector = (name: string) => {
        const values = new RegExp(`^\\s*${name}\\s+([^\\n]+)`, 'm').exec(body)![1]!;
        return values.trim().split(/\s+/).map(Number);
      };
      const p = vector('position'), emission = vector('emission');
      const light = areaLights[index]!;
      emission.forEach((value, i) => expect(light.color[i]! * light.intensity).toBeCloseTo(value, 6));
      if (light.type === 'rect') {
        const a = vector('v1'), b = vector('v2');
        p.forEach((_, i) => expect(light.transform[12 + i]).toBeCloseTo((a[i]! + b[i]!) / 2, 6));
        expect(light.width).toBeCloseTo(Math.hypot(...a.map((value, i) => value - p[i]!)), 6);
        expect(light.height).toBeCloseTo(Math.hypot(...b.map((value, i) => value - p[i]!)), 6);
      } else {
        p.forEach((value, i) => expect(light.transform[12 + i]).toBeCloseTo(value, 6));
      }
    });
    expect(lights.filter(light => light.type === 'dome')).toHaveLength(/^\s*envmapfile\s+/m.test(source) ? 1 : 0);
    for (const light of lights) {
      expect(light.type).not.toBe('unknown');
      expect(light.transform.every(Number.isFinite)).toBe(true);
      expect(light.intensity).toBeGreaterThanOrEqual(0);
      if (light.type === 'rect') {
        expect(light.width).toBeGreaterThan(0);
        expect(light.height).toBeGreaterThan(0);
      }
      if (light.type === 'sphere') expect(light.radius).toBeGreaterThan(0);
    }
  });

  it('passes every OBJ prim through the real external-geometry loader', async () => {
    let count = 0;
    const triangle = new TextEncoder().encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n').buffer;
    for (const file of files) {
      const imported = await load(file);
      const prims = new Map([...imported.prims].filter(([, prim]) =>
        prim.attributes.get('engine:geometry:file')?.value?.toString().endsWith('.obj')));
      count += prims.size;
      const scene = { ...imported, prims };
      const meshSource = await loadExternalMeshSource(scene, { meshFor: () => undefined }, () => {}, async () => triangle);
      for (const [path] of scene.prims) expect(meshSource.meshFor(path)?.faceVertexCounts).toEqual([3]);
    }
    expect(count).toBe(548);
  });

  it('preserves source row-major mesh matrices and splits named GLB material assignments', async () => {
    const tungsten = await load('tungsten-material-testball.usda');
    const world = computeWorldTransforms(tungsten);
    const mesh = world.get('/World/Geometry/Mesh000')!;
    expect(mesh[0]).toBeCloseTo(0.482906);
    expect(mesh.slice(12, 15)).toEqual([0.110507, 0.494301, 0.126194]);
    const ball = await load('openpbr_rva_standard_shader_ball.usda');
    for (const [name, material] of [['Preview_Mesh', 'mtlx_test'], ['Calibration_Mesh', 'mtlx_default']]) {
      const prim = ball.prims.get(`/World/Geometry/${name}`)!;
      expect(prim.attributes.get('engine:geometry:object')?.value).toBe(name);
      expect(prim.materialBinding?.target).toBe(`/World/Looks/${material}`);
    }
  });
});
