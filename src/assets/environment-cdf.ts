import type { HdrImage } from './hdr.ts';

/** Row-major luminance CDF shared by raster and path-traced dome sampling. */
export function buildEnvCdf(image: HdrImage) {
  const { width, height, data } = image;
  const cdf = new Float32Array(width * height);
  let totalSum = 0;
  for (let i = 0; i < cdf.length; i++) {
    const o = i * 3;
    totalSum += Math.max(0, 0.212671 * data[o]! + 0.71516 * data[o + 1]! + 0.072169 * data[o + 2]!);
    cdf[i] = totalSum;
  }
  return { cdf, totalSum, width, height };
}
