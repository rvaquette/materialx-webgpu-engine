import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { IDENTITY4, scaling4, translation4 } from '../../../src/scene/transforms.ts';
import { importLights, type SceneLight } from '../../../src/usd/lights.ts';
import { importUsdStage } from '../../../src/usd/importer.ts';
import { packDisneyLights } from '../../../src/render/pathtracing/disney-lights.ts';

function light(type: SceneLight['type'], overrides: Partial<SceneLight> = {}): SceneLight {
  return {
    path: '/Light', type, usdType: 'TestLight', color: [1, 0.5, 0.25], intensity: 4, exposure: 1,
    normalize: false, transform: IDENTITY4, ...overrides,
  };
}

describe('Disney light packing', () => {
  it('packs rect, sphere and distant lights using source record layout and gain', () => {
    const rect = light('rect', { transform: translation4(1, 2, 3), width: 2, height: 3, normalize: true });
    const sphere = light('sphere', { transform: scaling4(2, 2, 2), radius: 0.5 });
    const distant = light('distant');
    const result = packDisneyLights([rect, sphere, distant]);
    expect(result.count).toBe(3);
    const expectRecord = (record: Float32Array, expected: number[]) =>
      expect(Array.from(record)).toEqual(Array.from(new Float32Array(expected)));
    expectRecord(result.data.slice(0, 20), [
      0, 3.5, 3, 0, 8 / 6, 4 / 6, 2 / 6, 0, 2, 0, 0, 0, 0, -3, 0, 6, 0, 6, 0, 0,
    ]);
    expectRecord(result.data.slice(20, 40), [
      0, 0, 0, 0, 8, 4, 2, 0, 0, 0, 0, 1, 0, 0, 0, 4 * Math.PI,
      1, 4 * Math.PI, 1, 0,
    ]);
    expectRecord(result.data.slice(40, 60), [
      0, 0, 1, 0, 8, 4, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0,
    ]);
  });

  it('matches Coffee Pot emitter geometry, including the emitting side', async () => {
    const scene = await importUsdStage(resolve('scenes', 'pathtracer', 'coffee_pot.usda'), {
      reader: { read: uri => readFile(uri, 'utf8') },
    });
    const lights = importLights(scene);
    const packed = packDisneyLights(lights);
    expect(packed.count).toBe(3);
    for (const [index, light] of lights.entries()) {
      const points = scene.prims.get(`${light.path}_Geometry`)?.attributes.get('points')?.value;
      if (!Array.isArray(points) || points.length !== 12 || !points.every(x => typeof x === 'number')) {
        throw new Error(`Missing emitter vertices for ${light.path}.`);
      }
      const base = index * 20;
      for (let axis = 0; axis < 3; axis++) {
        const corner = packed.data[base + axis]!;
        const u = packed.data[base + 8 + axis]!;
        const v = packed.data[base + 12 + axis]!;
        expect(corner).toBeCloseTo(points[axis] as number, 6);
        expect(corner + u).toBeCloseTo(points[3 + axis] as number, 6);
        expect(corner + v).toBeCloseTo(points[9 + axis] as number, 6);
      }
    }
  });

  it('returns a bindable empty record and rejects unsupported shaping or geometry', () => {
    const empty = packDisneyLights([light('dome')]);
    expect(empty.count).toBe(0);
    expect(empty.data).toHaveLength(20);
    expect(empty.data.every(value => value === 0)).toBe(true);
    expect(() => packDisneyLights([light('point')])).toThrow(/Unsupported/);
    expect(() => packDisneyLights([light('rect', { width: 0 })])).toThrow(/Degenerate/);
    expect(() => packDisneyLights([light('sphere', { transform: scaling4(1, 2, 1) })])).toThrow(/Non-uniform/);
    expect(() => packDisneyLights([light('distant', { transform: scaling4(0, 0, 0) })])).toThrow(/Degenerate/);
  });
});
