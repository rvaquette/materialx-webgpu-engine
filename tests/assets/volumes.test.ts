import { describe, it, expect, vi } from 'vitest';
import {
  VolumeDecoderRegistry,
  VolumeDecodeError,
  detectVolumeFormat,
  isVolumeAsset,
  type DecodedVolume,
} from '../../src/assets/volumes.ts';

describe('detectVolumeFormat / isVolumeAsset', () => {
  it('recognizes .vdb only', () => {
    expect(detectVolumeFormat('cloud.vdb')).toBe('vdb');
    expect(detectVolumeFormat('cloud.VDB?v=1')).toBe('vdb');
    expect(detectVolumeFormat('color.tif')).toBeUndefined();
    expect(isVolumeAsset('smoke.vdb')).toBe(true);
    expect(isVolumeAsset('albedo.png')).toBe(false);
  });
});

describe('VolumeDecoderRegistry', () => {
  it('fails with a diagnostic when no decoder is registered (out of scope)', async () => {
    const onDiagnostic = vi.fn();
    const registry = new VolumeDecoderRegistry(onDiagnostic);
    await expect(
      registry.decode({ bytes: new Uint8Array(), name: 'smoke.vdb' }),
    ).rejects.toBeInstanceOf(VolumeDecodeError);
    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });

  it('fails on unknown volume format', async () => {
    const registry = new VolumeDecoderRegistry();
    await expect(registry.decode({ bytes: new Uint8Array(), name: 'a.bin' })).rejects.toBeInstanceOf(
      VolumeDecodeError,
    );
  });

  it('dispatches to a registered decoder', async () => {
    const volume: DecodedVolume = {
      name: 'density',
      dimensions: [4, 4, 4],
      bbox: { min: [0, 0, 0], max: [1, 1, 1] },
      grids: [{ name: 'density', componentType: 'float32', channels: 1, data: new Float32Array(1) }],
    };
    const decoder = vi.fn(async () => volume);
    const registry = new VolumeDecoderRegistry().register('vdb', decoder);
    await expect(registry.decode({ bytes: new Uint8Array(), name: 'd.vdb' })).resolves.toBe(volume);
    expect(decoder).toHaveBeenCalledOnce();
  });

  it('rejects an already-aborted request', async () => {
    const registry = new VolumeDecoderRegistry();
    await expect(
      registry.decode({ bytes: new Uint8Array(), name: 'd.vdb', signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
