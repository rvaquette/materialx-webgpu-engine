// Radiance RGBE (.hdr) decoder. Ported from three.js RGBELoader
// (https://github.com/mrdoob/three.js, MIT): parses the Radiance header and the
// adaptive run-length-encoded scanlines, then expands each RGBE pixel to linear
// Float32 RGB. Used to load equirectangular environment maps referenced by a
// UsdLuxDomeLight's inputs:texture:file. Pure (no DOM/GPU), so it is Node-testable.

export interface HdrImage {
  width: number;
  height: number;
  /** Linear RGB, row-major, 3 floats per pixel (top row first). */
  data: Float32Array;
}

function fgets(buffer: Uint8Array, offset: { value: number }): string {
  const end = buffer.length;
  let line = '';
  for (let i = offset.value; i < end; i++) {
    const c = buffer[i]!;
    if (c === 0x0a) {
      offset.value = i + 1;
      return line;
    }
    line += String.fromCharCode(c);
  }
  offset.value = end;
  return line;
}

interface HdrHeader {
  width: number;
  height: number;
  dataStart: number;
}

function readHeader(buffer: Uint8Array): HdrHeader {
  const offset = { value: 0 };
  const magic = fgets(buffer, offset);
  if (!/^#\?(RADIANCE|RGBE)/.test(magic)) {
    throw new Error('Invalid HDR file: missing #?RADIANCE / #?RGBE magic');
  }
  let formatOk = false;
  for (;;) {
    const line = fgets(buffer, offset);
    if (line === '') break; // blank line terminates the header
    if (/^\s*FORMAT=32-bit_rle_rgbe/.test(line)) formatOk = true;
  }
  if (!formatOk) throw new Error('Unsupported HDR format (expected 32-bit_rle_rgbe)');
  const dims = fgets(buffer, offset);
  const m = /^-Y (\d+) \+X (\d+)/.exec(dims);
  if (!m) throw new Error(`Unsupported HDR resolution line: ${dims}`);
  return { height: Number(m[1]), width: Number(m[2]), dataStart: offset.value };
}

/** Expand one RGBE pixel to linear float RGB (Radiance ldexp convention). */
function rgbeToFloat(r: number, g: number, b: number, e: number, out: Float32Array, o: number): void {
  if (e === 0) {
    out[o] = 0;
    out[o + 1] = 0;
    out[o + 2] = 0;
    return;
  }
  const f = Math.pow(2, e - (128 + 8));
  out[o] = r * f;
  out[o + 1] = g * f;
  out[o + 2] = b * f;
}

export function decodeHdr(bytes: Uint8Array): HdrImage {
  const { width, height, dataStart } = readHeader(bytes);
  const out = new Float32Array(width * height * 3);
  // Adaptive RLE is only used for scanlines 8..0x7fff wide; otherwise flat RGBE.
  const scanlineRle = width >= 8 && width < 0x8000;
  let p = dataStart;
  const scanline = new Uint8Array(width * 4);

  for (let y = 0; y < height; y++) {
    let flat = !scanlineRle;
    if (scanlineRle) {
      const r = bytes[p]!, g = bytes[p + 1]!, hi = bytes[p + 2]!, lo = bytes[p + 3]!;
      if (r !== 2 || g !== 2 || (hi & 0x80) !== 0 || ((hi << 8) | lo) !== width) {
        flat = true; // not new-format RLE: fall back to flat for the whole image
      } else {
        p += 4;
        for (let ch = 0; ch < 4; ch++) {
          let x = 0;
          while (x < width) {
            let count = bytes[p++]!;
            if (count > 128) {
              const value = bytes[p++]!;
              count -= 128;
              while (count-- > 0) scanline[x++ * 4 + ch] = value;
            } else {
              while (count-- > 0) scanline[x++ * 4 + ch] = bytes[p++]!;
            }
          }
        }
        const row = y * width * 3;
        for (let x = 0; x < width; x++) {
          const s = x * 4;
          rgbeToFloat(scanline[s]!, scanline[s + 1]!, scanline[s + 2]!, scanline[s + 3]!, out, row + x * 3);
        }
      }
    }
    if (flat) {
      const row = y * width * 3;
      for (let x = 0; x < width; x++) {
        rgbeToFloat(bytes[p]!, bytes[p + 1]!, bytes[p + 2]!, bytes[p + 3]!, out, row + x * 3);
        p += 4;
      }
    }
  }
  return { width, height, data: out };
}
