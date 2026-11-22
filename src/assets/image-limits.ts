// Texture resolution caps: images larger than the GPU limit or the memory
// budget's texture size are halved (2x2 box filter) until they fit, instead of
// failing the upload. Every reduction is reported.

import type { DecodedPixelImage } from './images.ts';
import type { PtImageProvider } from '../render/pathtracing/device-bindings.ts';

function halve(image: DecodedPixelImage): DecodedPixelImage {
  const width = Math.max(1, image.width >> 1), height = Math.max(1, image.height >> 1);
  const channels = image.channels;
  const source = image.data;
  const data = new (source.constructor as new (length: number) => typeof source)(width * height * channels);
  const integer = !(source instanceof Float32Array);
  for (let y = 0; y < height; y++) {
    const y0 = Math.min(image.height - 1, y * 2), y1 = Math.min(image.height - 1, y * 2 + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.min(image.width - 1, x * 2), x1 = Math.min(image.width - 1, x * 2 + 1);
      for (let c = 0; c < channels; c++) {
        const sum = source[(y0 * image.width + x0) * channels + c]! + source[(y0 * image.width + x1) * channels + c]!
          + source[(y1 * image.width + x0) * channels + c]! + source[(y1 * image.width + x1) * channels + c]!;
        data[(y * width + x) * channels + c] = integer ? Math.round(sum / 4) : sum / 4;
      }
    }
  }
  return { ...image, data, width, height };
}

/** Halves an image (and its UDIM tiles) until both sides are at most `maxSize`. */
export function downscaleImage(image: DecodedPixelImage, maxSize: number): DecodedPixelImage {
  const fit = (pixels: DecodedPixelImage): DecodedPixelImage => {
    let result = pixels;
    while (result.width > maxSize || result.height > maxSize) result = halve(result);
    return result;
  };
  if (!image.udim) return fit(image);
  const udim = image.udim.map(layer => ({ tile: layer.tile, image: fit(layer.image) }));
  return { ...udim[0]!.image, udim };
}

export interface TextureReduction {
  file: string;
  from: readonly [number, number];
  to: readonly [number, number];
}

/** Wraps a provider so decoded images never exceed `maxSize()` pixels per side. */
export function limitImageProvider(
  provider: PtImageProvider, maxSize: () => number, onReduce?: (reduction: TextureReduction) => void,
  onImage?: (image: DecodedPixelImage) => void,
): PtImageProvider {
  const reduced = new WeakMap<DecodedPixelImage, Map<number, DecodedPixelImage>>();
  const limit = (file: string, image: DecodedPixelImage | undefined): DecodedPixelImage | undefined => {
    if (image) onImage?.(image);
    const size = maxSize();
    if (!image || (image.width <= size && image.height <= size && !image.udim?.some(l => l.image.width > size || l.image.height > size))) return image;
    let sizes = reduced.get(image);
    if (!sizes) reduced.set(image, sizes = new Map());
    let result = sizes.get(size);
    if (!result) {
      result = downscaleImage(image, size);
      sizes.set(size, result);
      onReduce?.({ file, from: [image.width, image.height], to: [result.width, result.height] });
    }
    return result;
  };
  return {
    decode(file) {
      const image = provider.decode(file);
      return image instanceof Promise ? image.then(value => limit(file, value)) : limit(file, image);
    },
    ...(provider.exportSource ? { exportSource: provider.exportSource.bind(provider) } : {}),
  };
}
