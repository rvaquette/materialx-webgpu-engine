import type { HdrImage } from './hdr.ts';

const HALF_MAX = 65504;
const f32 = new Float32Array(1);
const i32 = new Uint32Array(f32.buffer);

function floatToHalf(value: number): number {
  f32[0] = value;
  const bits = i32[0]!;
  const exponent = ((bits >>> 23) & 0xff) - 127 + 15;
  let mantissa = bits & 0x7fffff;
  if (exponent <= 0) {
    if (exponent < -10) return 0;
    mantissa = (mantissa | 0x800000) >>> (1 - exponent);
    return mantissa >>> 13;
  }
  return (exponent << 10) | (mantissa >>> 13);
}

/** Scale the entire HDR uniformly so half-float filtering stays finite.
 * Restore radianceScale after sampling; SH and importance PDFs retain original units. */
export function packHdrTexture(image: HdrImage): { data: Uint16Array; radianceScale: number } {
  const { width, height, data } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
      data.length !== width * height * 3) throw new Error('Invalid HDR image dimensions');
  let maximum = 0;
  for (const value of data) {
    if (!Number.isFinite(value) || value < 0) throw new Error('HDR radiance must be finite and nonnegative');
    maximum = Math.max(maximum, value);
  }
  // Power-of-two scaling preserves float significands and leaves ordinary HDRs unchanged.
  const radianceScale = maximum > HALF_MAX ? 2 ** Math.ceil(Math.log2(maximum / HALF_MAX)) : 1;
  const packed = new Uint16Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) packed[i * 4 + c] = floatToHalf(data[i * 3 + c]! / radianceScale);
    packed[i * 4 + 3] = 0x3c00;
  }
  return { data: packed, radianceScale };
}
