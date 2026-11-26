import { describe, expect, it, vi } from 'vitest';
import { captureTurntable, turntableTransform } from '../../src/render/turntable.ts';
import { transformPoint, translation4 } from '../../src/scene/transforms.ts';

describe('turntable', () => {
  it('rotates an object at its own position and orbits a light around world Y', () => {
    const base = translation4(2, 3, 0);
    expect(transformPoint(turntableTransform(base, 'object', 90), [0, 0, 0])).toEqual([2, 3, 0]);
    const light = transformPoint(turntableTransform(base, 'light', 90), [0, 0, 0]);
    expect(light[0]).toBeCloseTo(0);
    expect(light[1]).toBe(3);
    expect(light[2]).toBeCloseTo(-2);
  });

  it('captures evenly spaced frames without duplicating the final angle and restores the scene', async () => {
    const apply = vi.fn(), restore = vi.fn(), progress = vi.fn();
    const images = await captureTurntable({
      frames: 4, angle: 45, signal: new AbortController().signal, apply, restore, progress,
      capture: async () => new Uint8Array([1]),
    });
    expect(apply.mock.calls.map(call => call[0])).toEqual([45, 135, 225, 315]);
    expect(Object.keys(images)).toEqual(['turntable_001.png', 'turntable_002.png', 'turntable_003.png', 'turntable_004.png']);
    expect(progress).toHaveBeenLastCalledWith(4, 4);
    expect(restore).toHaveBeenCalledOnce();
  });

  it('restores on errors or cancellation and never returns a partial sequence', async () => {
    const controller = new AbortController();
    const restore = vi.fn();
    const capture = vi.fn(async () => { controller.abort(); return new Uint8Array(); });
    await expect(captureTurntable({
      frames: 3, angle: 0, signal: controller.signal, apply: vi.fn(), capture, restore, progress: vi.fn(),
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(capture).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledOnce();
    const failRestore = vi.fn();
    await expect(captureTurntable({
      frames: 1, angle: 90, signal: new AbortController().signal, apply: vi.fn(),
      capture: async () => { throw new Error('GPU failure'); }, restore: failRestore, progress: vi.fn(),
    })).rejects.toThrow('GPU failure');
    expect(failRestore).toHaveBeenCalledOnce();
  });
});
