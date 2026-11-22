import { describe, expect, it } from 'vitest';
import { lightGuideValuesOffset, packLightGuide, PT_LIGHT_GUIDE_CELLS, PT_LIGHT_GUIDE_RESOLUTION } from '../../../src/render/pathtracing/light-guide.ts';

describe('observed-visibility light guide', () => {
  const bounds = { min: [-1, 0, 2], max: [3, 2, 2] } as const;

  it('starts with neutral visibilities on a grid covering the scene bounds', () => {
    const guide = packLightGuide(bounds, 3);
    expect([...guide.subarray(0, 4)]).toEqual([-1, 0, 2, PT_LIGHT_GUIDE_RESOLUTION]);
    // Degenerate (flat) axes collapse to one cell; others map the extent onto the grid.
    expect(guide[4]! * 4).toBeCloseTo(PT_LIGHT_GUIDE_RESOLUTION, 2);
    expect(guide[6]).toBe(0);
    expect(guide.length).toBe(8 + PT_LIGHT_GUIDE_CELLS * 3);
    expect(guide.subarray(8).every(value => value === 1)).toBe(true);
    expect(lightGuideValuesOffset(3)).toBe((3 * 7 + 2) * 16);
  });

  it('is disabled for a single light', () => {
    const guide = packLightGuide(bounds, 1);
    expect(guide[3]).toBe(0);
    expect(guide.length).toBe(8);
  });
});
