import { describe, it, expect, vi } from 'vitest';
import {
  ImageDecoderRegistry,
  ImageDecodeError,
  detectImageFormat,
  createBitmapImageDecoder,
  type DecodedImage,
  type DecodeImageRequest,
} from '../../src/assets/images.ts';

describe('detectImageFormat', () => {
  it('maps extensions, including UDIM tiles and query strings', () => {
    expect(detectImageFormat('floor.png')).toBe('png');
    expect(detectImageFormat('a.JPG')).toBe('jpeg');
    expect(detectImageFormat('color.1001.tif')).toBe('tiff');
    expect(detectImageFormat('env.exr?v=2')).toBe('exr');
    expect(detectImageFormat('sky.hdr#frag')).toBe('hdr');
    expect(detectImageFormat('noext')).toBeUndefined();
    expect(detectImageFormat('data.bin')).toBeUndefined();
  });
});

describe('createBitmapImageDecoder', () => {
  it('produces a bitmap image carrying the declared colorspace', async () => {
    const bitmap = { width: 4, height: 2, close: () => {} } as unknown as ImageBitmap;
    const createBitmap = vi.fn(async () => bitmap);
    const decoder = createBitmapImageDecoder(createBitmap);
    const result = await decoder({ bytes: new Uint8Array([1, 2]), colorSpace: 'srgb_tx', name: 'a.png' });
    expect(result).toEqual({ kind: 'bitmap', bitmap, width: 4, height: 2, colorSpace: 'srgb_tx' });
  });
});

describe('ImageDecoderRegistry', () => {
  const makePixelDecoder = (image: DecodedImage) => vi.fn(async (_req: DecodeImageRequest) => image);

  it('dispatches by detected format and preserves precision + colorspace', async () => {
    const tiffImage: DecodedImage = {
      kind: 'pixels',
      data: new Uint16Array([0xffff, 0, 0, 0xffff]),
      componentType: 'uint16',
      channels: 1,
      width: 2,
      height: 2,
      colorSpace: 'Raw',
    };
    const decoder = makePixelDecoder(tiffImage);
    const registry = new ImageDecoderRegistry().register('tiff', decoder);
    const result = await registry.decode({ bytes: new Uint8Array(), colorSpace: 'Raw', name: 'r.1001.tif' });
    expect(result).toBe(tiffImage);
    expect((result as { componentType: string }).componentType).toBe('uint16');
    expect(result.colorSpace).toBe('Raw');
    expect(decoder).toHaveBeenCalledOnce();
  });

  it('requires an explicit colorspace', async () => {
    const onDiagnostic = vi.fn();
    const registry = new ImageDecoderRegistry(onDiagnostic);
    await expect(
      registry.decode({ bytes: new Uint8Array(), colorSpace: '', name: 'a.png' }),
    ).rejects.toBeInstanceOf(ImageDecodeError);
    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });

  it('fails when the format is unknown', async () => {
    const registry = new ImageDecoderRegistry();
    await expect(
      registry.decode({ bytes: new Uint8Array(), colorSpace: 'srgb', name: 'a.bin' }),
    ).rejects.toBeInstanceOf(ImageDecodeError);
  });

  it('fails when no decoder is registered for the format', async () => {
    const onDiagnostic = vi.fn();
    const registry = new ImageDecoderRegistry(onDiagnostic);
    await expect(
      registry.decode({ bytes: new Uint8Array(), colorSpace: 'srgb', format: 'exr' }),
    ).rejects.toBeInstanceOf(ImageDecodeError);
    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });

  it('rejects an already-aborted request', async () => {
    const registry = new ImageDecoderRegistry();
    await expect(
      registry.decode({ bytes: new Uint8Array(), colorSpace: 'srgb', name: 'a.png', signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
