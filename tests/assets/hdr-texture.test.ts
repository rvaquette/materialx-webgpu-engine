import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { decodeHdr } from '../../src/assets/hdr.ts';
import { packHdrTexture } from '../../src/assets/hdr-texture.ts';

function fromHalf(bits: number): number {
  const exponent = (bits >>> 10) & 31;
  const mantissa = bits & 1023;
  return exponent === 0 ? mantissa * 2 ** -24 : (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

describe('HDR half-float texture packing', () => {
  it('leaves ordinary radiance and alpha unchanged', () => {
    const packed = packHdrTexture({ width: 1, height: 1, data: new Float32Array([0, 1, 65504]) });
    expect(packed.radianceScale).toBe(1);
    expect(Array.from(packed.data)).toEqual([0, 0x3c00, 0x7bff, 0x3c00]);
  });

  it('scales uniformly instead of clipping high radiance', () => {
    const values = new Float32Array([91648, 81920, 1.25]);
    const packed = packHdrTexture({ width: 1, height: 1, data: values });
    expect(packed.radianceScale).toBe(2);
    for (let c = 0; c < 3; c++) expect(fromHalf(packed.data[c]!) * packed.radianceScale).toBe(values[c]);
  });

  it.each([NaN, Infinity, -1])('rejects invalid radiance %s', (value) => {
    expect(() => packHdrTexture({ width: 1, height: 1, data: new Float32Array([value, 0, 0]) }))
      .toThrow('finite and nonnegative');
  });

  it('rejects malformed dimensions', () => {
    expect(() => packHdrTexture({ width: 2, height: 1, data: new Float32Array(3) })).toThrow('dimensions');
  });

  it('keeps the actual RVA environment finite and preserves its energy', async () => {
    const image = decodeHdr(await readFile('scenes\\standard-shader-ball\\openpbr-rva-standard-shader-ball\\HDR\\san_giuseppe_bridge_2k_rotate90_right.hdr'));
    const packed = packHdrTexture(image);
    expect(packed.radianceScale).toBe(2);
    let originalSum = 0, restoredSum = 0, maximumError = 0;
    for (let i = 0; i < image.data.length; i++) {
      const bits = packed.data[Math.floor(i / 3) * 4 + i % 3]!;
      if ((bits & 0x7c00) === 0x7c00) throw new Error(`Non-finite half at ${i}`);
      const value = image.data[i]!;
      const restored = fromHalf(bits) * packed.radianceScale;
      originalSum += value;
      restoredSum += restored;
      maximumError = Math.max(maximumError, Math.abs(value - restored));
    }
    expect(Math.abs(restoredSum - originalSum) / originalSum).toBeLessThan(0.001);
    expect(maximumError).toBeLessThanOrEqual(64);
  });
});
