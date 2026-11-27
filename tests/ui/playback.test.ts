import { afterEach, describe, expect, it, vi } from 'vitest';
import { schedulePlaybackFrames } from '../../src/ui/playback.ts';

describe('animation playback scheduling', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('coalesces delayed frames without overlapping updates and stops cleanly', async () => {
    let id = 0;
    const callbacks = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => callbacks.delete(frame));
    const tick = (time: number) => {
      const [frame, callback] = callbacks.entries().next().value!;
      callbacks.delete(frame);
      callback(time);
    };
    const pending: Array<(value: boolean) => void> = [];
    const update = vi.fn(() => new Promise<boolean>(resolve => pending.push(resolve)));
    const onError = vi.fn();
    const stop = schedulePlaybackFrames(update, onError);
    tick(10);
    tick(20);
    tick(30);
    expect(update.mock.calls).toEqual([[10]]);
    pending.shift()!(true);
    await Promise.resolve();
    expect(update.mock.calls).toEqual([[10], [30]]);
    tick(40);
    stop();
    pending.shift()!(true);
    await Promise.resolve();
    expect(update.mock.calls).toEqual([[10], [30]]);
    expect(callbacks.size).toBe(0);
    expect(onError).not.toHaveBeenCalled();
  });

  it('stops and reports failed updates', async () => {
    let callback: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => { callback = next; return 1; });
    const cancel = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const error = new Error('update failed');
    const onError = vi.fn();
    schedulePlaybackFrames(async () => { throw error; }, onError);
    callback!(10);
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(error);
    expect(cancel).toHaveBeenCalled();
  });
});
