import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeBrowserImage } from '../../src/assets/browser-image.ts';

describe('browser image decoding', () => {
  const decode = vi.fn(async () => {});
  const close = vi.fn();
  const drawImage = vi.fn();
  const bitmap = vi.fn(async (_blob: Blob) => ({ width: 2, height: 1, close }));
  const pixels = new Uint8ClampedArray([244, 244, 244, 255, 47, 47, 47, 255]);
  const getImageData = vi.fn(() => ({ data: pixels }));

  beforeEach(() => {
    vi.clearAllMocks();
    decode.mockResolvedValue(undefined);
    drawImage.mockImplementation(() => {});
    class MockImage {
      naturalWidth = 2;
      naturalHeight = 1;
      src = '';
      decode = decode;
    }
    vi.stubGlobal('Image', MockImage);
    vi.stubGlobal('HTMLImageElement', MockImage);
    vi.stubGlobal('createImageBitmap', bitmap);
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({ width: 0, height: 0, getContext: () => ({ drawImage, getImageData }) })),
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-image');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ['image/svg+xml', 'texture'],
    ['application/octet-stream', 'texture.SVG?v=1'],
  ])('rasterizes SVG detected by MIME or filename (%s, %s)', async (type, name) => {
    const image = await decodeBrowserImage(new Blob(['<svg/>'], { type }), name);
    expect(decode).toHaveBeenCalledOnce();
    expect(bitmap).not.toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/svg+xml' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-image');
    expect(drawImage).toHaveBeenCalledWith(expect.any(HTMLImageElement), 0, 0);
    expect(image).toMatchObject({ width: 2, height: 1, componentType: 'uint8', channels: 4 });
    expect(image.data).toEqual(new Uint8Array(pixels));
  });

  it('retains bitmap decoding and closes the bitmap for raster formats', async () => {
    const blob = new Blob(['png'], { type: 'image/png' });
    expect((await decodeBrowserImage(blob, 'texture.png')).data).toEqual(new Uint8Array(pixels));
    expect(bitmap).toHaveBeenCalledWith(blob);
    expect(close).toHaveBeenCalledOnce();
    expect(decode).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('surfaces SVG decoding errors and revokes its object URL', async () => {
    decode.mockRejectedValueOnce(new Error('Invalid SVG'));
    await expect(decodeBrowserImage(new Blob(['invalid'], { type: 'image/svg+xml' }), 'bad.svg')).rejects.toThrow('Invalid SVG');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-image');
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('surfaces bitmap decoding errors instead of returning black pixels', async () => {
    bitmap.mockRejectedValueOnce(new Error('Invalid bitmap'));
    await expect(decodeBrowserImage(new Blob(['invalid']), 'bad.png')).rejects.toThrow('Invalid bitmap');
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('cleans up the image source even when canvas drawing fails', async () => {
    drawImage.mockImplementationOnce(() => { throw new Error('Canvas failed'); });
    await expect(decodeBrowserImage(new Blob(['png']), 'texture.png')).rejects.toThrow('Canvas failed');
    expect(close).toHaveBeenCalledOnce();
    drawImage.mockImplementationOnce(() => { throw new Error('Canvas failed'); });
    await expect(decodeBrowserImage(new Blob(['svg']), 'texture.svg')).rejects.toThrow('Canvas failed');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-image');
  });
});
