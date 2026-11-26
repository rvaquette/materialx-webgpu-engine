import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  downloadDisplayedAovPng, downloadPathTraceAovPfm, encodePathTraceAovPfm,
} from '../../src/render/aov-export.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('displayed AOV export', () => {
  it('downloads the selected view as a size-labeled PNG and releases its temporary URL', async () => {
    vi.useFakeTimers();
    const anchor = { href: '', download: '', style: {}, click: vi.fn(), remove: vi.fn() };
    const body = { appendChild: vi.fn() };
    const createObjectURL = vi.fn(() => 'blob:current-aov');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('document', { body, createElement: vi.fn(() => anchor) });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const canvas = {
      width: 256,
      height: 128,
      toBlob: (callback: BlobCallback) => callback(new Blob(['png'], { type: 'image/png' })),
    } as HTMLCanvasElement;

    await downloadDisplayedAovPng(canvas, '/scenes/test scene.usda', 'transmission');

    expect(anchor.download).toBe('test-scene_transmission_256x128.png');
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(body.appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await vi.runOnlyPendingTimersAsync();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:current-aov');
  });

  it('reports PNG encoding failures without creating a download', async () => {
    const createObjectURL = vi.fn();
    vi.stubGlobal('document', { createElement: vi.fn() });
    vi.stubGlobal('URL', { createObjectURL });
    const canvas = { toBlob: (callback: BlobCallback) => callback(null) } as HTMLCanvasElement;

    await expect(downloadDisplayedAovPng(canvas, 'scene.usda', 'normal'))
      .rejects.toThrow('The browser could not encode the selected AOV as PNG.');
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});

describe('floating-point AOV export', () => {
  it('encodes RGB data bottom-up as little-endian PFM floats', () => {
    const bytes = encodePathTraceAovPfm({
      width: 1, height: 2, channels: 3, values: new Float32Array([1, 2, 3, 4, 5, 6]),
    });
    const header = new TextDecoder().decode(bytes.subarray(0, 12));
    const headerBytes = new TextEncoder().encode(header).length;
    const values = new DataView(bytes.buffer, bytes.byteOffset + headerBytes);

    expect(header).toBe('PF\n1 2\n-1.0\n');
    expect(Array.from({ length: 6 }, (_, index) => values.getFloat32(index * 4, true)))
      .toEqual([4, 5, 6, 1, 2, 3]);
  });

  it('encodes variance as a grayscale PFM and rejects mismatched image data', () => {
    const bytes = encodePathTraceAovPfm({
      width: 2, height: 1, channels: 1, values: new Float32Array([0.25, Number.NaN]),
    });

    expect(new TextDecoder().decode(bytes.subarray(0, 12))).toBe('Pf\n2 1\n-1.0\n');
    expect(() => encodePathTraceAovPfm({
      width: 2, height: 1, channels: 3, values: new Float32Array([1, 2, 3]),
    })).toThrow('Invalid path-tracing AOV image for PFM export.');
  });

  it('downloads the raw AOV with its resolution in the filename', async () => {
    const anchor = { href: '', download: '', style: {}, click: vi.fn(), remove: vi.fn() };
    const createObjectURL = vi.fn((blob: Blob) => {
      expect(blob.type).toBe('image/x-portable-floatmap');
      return 'blob:raw-aov';
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('document', { body: { appendChild: vi.fn() }, createElement: vi.fn(() => anchor) });
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    await downloadPathTraceAovPfm('/scenes/test scene.usda', 'variance', {
      width: 2, height: 1, channels: 1, values: new Float32Array([0.25, 0.5]),
    });

    expect(anchor.download).toBe('test-scene_variance_2x1.pfm');
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    await downloadPathTraceAovPfm('/scenes/test scene.usda', 'custom:object-mask:material_mask:7', {
      width: 1, height: 1, channels: 1, values: new Float32Array([0.75]),
    });
    expect(anchor.download).toBe('test-scene_object-mask_1x1.pfm');
  });
});
