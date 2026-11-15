import { describe, expect, it } from 'vitest';
import {
  DISNEY_RENDER_UNIFORM_BYTES, disneyTileForIndex, packDisneyRenderSettings, type DisneyRenderSettings,
} from '../../../src/render/pathtracing/disney-render.ts';

const settings: DisneyRenderSettings = {
  resolution: [512, 512], tileOrigin: [64, 128], tileSize: [64, 64],
  tileOffset: [0.125, 0.25], inverseTileCount: [0.125, 0.125], frame: 2, root: 3,
  camera: { position: [1, 2, 3], right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1],
    fov: 1, focalDistance: 1, aperture: 0 },
  lightCount: 2, maxDepth: 8, rrDepth: 3, russianRoulette: true, environment: true,
  uniformLight: false, hideEmitters: false, transparentBackground: false, alphaTest: true,
  medium: false, volumeMis: false, flipNormalY: false, mollify: false, environmentLinear: true,
  mollificationAmount: 0, environmentTotal: 2, environmentRotation: 0, environmentIntensity: 1,
  uniformColor: [1, 1, 1],
};

describe('Disney render settings', () => {
  it('schedules source tiles top-to-bottom while keeping bottom-left tile coordinates', () => {
    expect(disneyTileForIndex(0, [128, 128], 64)).toEqual({
      tileOrigin: [0, 64], tileSize: [64, 64], tileOffset: [0, 0.5],
      inverseTileCount: [0.5, 0.5], tileCount: 4,
    });
    expect(disneyTileForIndex(3, [100, 70], 64)).toEqual({
      tileOrigin: [64, 0], tileSize: [36, 64], tileOffset: [0.5, 0],
      inverseTileCount: [0.5, 0.5], tileCount: 4,
    });
    expect(() => disneyTileForIndex(4, [128, 128], 64)).toThrow(/outside/);
  });

  it('packs tile coordinates, flags and camera values in the GPU layout', () => {
    const buffer = packDisneyRenderSettings(settings);
    const integers = new Uint32Array(buffer), floats = new Float32Array(buffer);
    expect(buffer.byteLength).toBe(DISNEY_RENDER_UNIFORM_BYTES);
    expect(Array.from(integers.slice(0, 8))).toEqual([512, 512, 64, 128, 64, 64, 2, 3]);
    expect(Array.from(floats.slice(8, 12))).toEqual([0.125, 0.25, 0.125, 0.125]);
    expect(Array.from(integers.slice(32, 36))).toEqual([2, 8, 3, 1 | 2 | 32 | 1024]);
    const orthographic = packDisneyRenderSettings({
      ...settings, camera: { ...settings.camera, orthographic: true },
    });
    expect(new Float32Array(orthographic)[31]).toBe(1);
  });

  it('rejects tiles outside the image and unsupported volume MIS options', () => {
    expect(() => packDisneyRenderSettings({ ...settings, tileOrigin: [500, 128] })).toThrow(/dimensions/);
    expect(() => packDisneyRenderSettings({ ...settings, resolution: [65536, 65536] })).toThrow(/dimensions/);
    expect(() => packDisneyRenderSettings({ ...settings, medium: true, volumeMis: true, hideEmitters: true })).toThrow(/unsupported/);
    expect(() => packDisneyRenderSettings({ ...settings, medium: true, volumeMis: true, mollify: true })).toThrow(/unsupported/);
  });

  it('rejects values that become invalid when converted to float32', () => {
    for (const camera of [
      { ...settings.camera, fov: Number.MIN_VALUE },
      { ...settings.camera, fov: Math.PI - 1e-9 },
      { ...settings.camera, focalDistance: Number.MIN_VALUE },
    ]) expect(() => packDisneyRenderSettings({ ...settings, camera })).toThrow(/settings/);
    expect(() => packDisneyRenderSettings({ ...settings, inverseTileCount: [Number.MIN_VALUE, 1] })).toThrow(/settings/);
    expect(() => packDisneyRenderSettings({ ...settings, environmentTotal: Number.MIN_VALUE })).toThrow(/settings/);
    expect(() => packDisneyRenderSettings({ ...settings, environmentIntensity: Number.MAX_VALUE })).toThrow(/settings/);
  });
});
