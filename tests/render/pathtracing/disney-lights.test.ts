import { describe, expect, it } from 'vitest';
import { IDENTITY4, scaling4, translation4 } from '../../../src/scene/transforms.ts';
import type { SceneLight } from '../../../src/usd/lights.ts';
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
      1, 2, 3, 0, 8 / 6, 4 / 6, 2 / 6, 0, 2, 0, 0, 0, 0, 3, 0, 6, 0, 6, 0, 0,
    ]);
    expectRecord(result.data.slice(20, 40), [
      0, 0, 0, 0, 8, 4, 2, 0, 0, 0, 0, 1, 0, 0, 0, 4 * Math.PI,
      1, 4 * Math.PI, 1, 0,
    ]);
    expectRecord(result.data.slice(40, 60), [
      0, 0, 1, 0, 8, 4, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0,
    ]);
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
