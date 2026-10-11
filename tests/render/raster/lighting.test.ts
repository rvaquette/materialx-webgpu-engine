import { describe, expect, it } from 'vitest';
import {
  assignLightsToClusters,
  buildClusterGrid,
  clusterZSliceForDepth,
  computeCascadeSplits,
  evaluateLightRadiance,
  prepareEnvironment,
  type ClusterLight,
} from '../../../src/render/raster/lighting.ts';
import type { SceneLight } from '../../../src/usd/lights.ts';
import { IDENTITY4 } from '../../../src/scene/transforms.ts';

function light(overrides: Partial<SceneLight>): SceneLight {
  return {
    path: '/L',
    type: 'sphere',
    usdType: 'SphereLight',
    color: [1, 1, 1],
    intensity: 1,
    exposure: 0,
    normalize: false,
    transform: IDENTITY4,
    ...overrides,
  };
}

describe('buildClusterGrid', () => {
  it('derives grid dimensions and exponential z slices', () => {
    const grid = buildClusterGrid({ screenWidth: 128, screenHeight: 64, tileSize: 64, zSlices: 4, near: 1, far: 100 });
    expect([grid.dimX, grid.dimY, grid.dimZ]).toEqual([2, 1, 4]);
    expect(grid.clusterCount).toBe(8);
    expect(grid.zSlices).toHaveLength(5);
    expect(grid.zSlices[0]).toBeCloseTo(1);
    expect(grid.zSlices[4]).toBeCloseTo(100);
  });

  it('maps depth to a clamped z slice', () => {
    const grid = buildClusterGrid({ screenWidth: 64, screenHeight: 64, tileSize: 64, zSlices: 4, near: 1, far: 100 });
    expect(clusterZSliceForDepth(grid, 0.5)).toBe(0);
    expect(clusterZSliceForDepth(grid, 1000)).toBe(3);
  });
});

describe('assignLightsToClusters', () => {
  it('assigns a point light to the clusters it overlaps and lists directional lights globally', () => {
    const grid = buildClusterGrid({ screenWidth: 128, screenHeight: 64, tileSize: 64, zSlices: 4, near: 1, far: 100 });
    const lights: ClusterLight[] = [
      { id: 'p', type: 'point', viewDepth: 10, radius: 1, screenBounds: [0, 0, 10, 10] },
      { id: 'sun', type: 'directional' },
    ];
    const result = assignLightsToClusters(grid, lights);
    const assigned = result.counts.reduce((a, b) => a + b, 0);
    expect(assigned).toBeGreaterThan(0);
    expect(Array.from(result.indices)).toContain(0); // point light index
    expect(Array.from(result.global)).toEqual([1]); // directional light index
  });

  it('keeps a point light out of clusters outside its screen tile', () => {
    const grid = buildClusterGrid({ screenWidth: 128, screenHeight: 64, tileSize: 64, zSlices: 1, near: 1, far: 100 });
    const result = assignLightsToClusters(grid, [{ id: 'p', type: 'point', viewDepth: 10, radius: 1, screenBounds: [0, 0, 10, 10] }]);
    expect(result.counts[0]).toBe(1); // tile x=0
    expect(result.counts[1]).toBe(0); // tile x=1 untouched
  });
});

describe('prepareEnvironment', () => {
  it('folds exposure into dome intensity', () => {
    const env = prepareEnvironment({ intensity: 2, exposure: 1, textureFile: 'env.hdr' });
    expect(env.source).toBe('dome');
    expect(env.intensity).toBeCloseTo(4);
    expect(env.textureFile).toBe('env.hdr');
  });

  it('reports no environment when there is no dome', () => {
    expect(prepareEnvironment().source).toBe('none');
  });
});

describe('computeCascadeSplits', () => {
  it('returns increasing boundaries from near to far', () => {
    const splits = computeCascadeSplits(1, 100, 4);
    expect(splits).toHaveLength(5);
    expect(splits[0]).toBeCloseTo(1);
    expect(splits[4]).toBeCloseTo(100);
    for (let i = 1; i < splits.length; i++) expect(splits[i]!).toBeGreaterThan(splits[i - 1]!);
  });
});

describe('evaluateLightRadiance', () => {
  it('applies intensity and exposure', () => {
    const r = evaluateLightRadiance(light({ intensity: 3, exposure: 1, color: [1, 0.5, 0.25] }));
    expect(r.color[0]).toBeCloseTo(6);
    expect(r.normalized).toBe(false);
  });

  it('normalizes area lights by their area when requested', () => {
    const r = evaluateLightRadiance(light({ type: 'rect', width: 2, height: 4, intensity: 8, normalize: true }));
    expect(r.normalized).toBe(true);
    expect(r.color[0]).toBeCloseTo(1); // 8 / (2*4)
  });
});
