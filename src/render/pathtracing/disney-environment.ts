/*
 * Environment CDF adapted from GLSL-PathTracer.
 * Copyright (c) 2019 Asif Ali
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import type { HdrImage } from '../../assets/hdr.ts';

/**
 * Builds the source renderer's flat CDF. Both weights and each cumulative sum
 * are rounded to float32, as in EnvironmentMap.buildCDF.
 */
export function buildDisneyEnvironmentCdf(image: HdrImage): {
  cdf: Float32Array; totalSum: number; width: number; height: number;
} {
  const { width, height, data } = image;
  const count = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width <= 0 || height <= 0 || !Number.isSafeInteger(count) ||
      data.length !== count * 3) {
    throw new Error('Invalid Disney environment dimensions or RGB data length.');
  }
  const cdf = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = data[i * 3]!;
    const g = data[i * 3 + 1]!;
    const b = data[i * 3 + 2]!;
    if (![r, g, b].every(Number.isFinite) || r < 0 || g < 0 || b < 0) {
      throw new Error(`Invalid Disney environment radiance at pixel ${i}.`);
    }
    const weight = Math.fround(0.212671 * r + 0.715160 * g + 0.072169 * b);
    cdf[i] = (i === 0 ? 0 : cdf[i - 1]!) + weight;
    if (!Number.isFinite(cdf[i]!)) throw new Error('Disney environment CDF overflow.');
  }
  const totalSum = cdf[count - 1]!;
  if (totalSum <= 0) throw new Error('Disney environment has zero total luminance.');
  return { cdf, totalSum, width, height };
}
