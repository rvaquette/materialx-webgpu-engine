// Progressive texture streaming. Textures decode in the background while
// partial scenes render with placeholders; each snapshot resolves every file to
// its best available version (real image, or a flat placeholder), and UDIM
// sets fill tile by tile.

import { AssetResolver } from './resolver.ts';
import type { DecodedPixelImage } from './images.ts';
import type { PtImageProvider } from '../render/pathtracing/device-bindings.ts';

const placeholders = new WeakSet<DecodedPixelImage>();

/** Placeholders are uploaded as mid grey for colour (sRGB) textures and as a flat normal for data textures. */
export function isPlaceholderImage(image: DecodedPixelImage | undefined): boolean {
  return image !== undefined && placeholders.has(image);
}

export function placeholderImage(width = 1, height = 1): DecodedPixelImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = 128; data[i + 1] = 128; data[i + 2] = 128; data[i + 3] = 255; }
  const image: DecodedPixelImage = { kind: 'pixels', data, componentType: 'uint8', channels: 4, width, height, colorSpace: '' };
  placeholders.add(image);
  return image;
}

/** RGBA8 pixels a placeholder uploads with, for the destination format. */
export function placeholderPixels(image: DecodedPixelImage, format: GPUTextureFormat): Uint8Array {
  if (format.endsWith('-srgb')) return image.data as Uint8Array;
  const data = new Uint8Array(image.width * image.height * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = 128; data[i + 1] = 128; data[i + 2] = 255; data[i + 3] = 255; }
  return data;
}

export interface StreamingImagesProgress {
  readonly pending: number;
  readonly decoded: number;
}

export class StreamingImages {
  readonly #source: PtImageProvider;
  readonly #images = new Map<string, DecodedPixelImage | undefined>();
  readonly #tiles = new Map<string, readonly number[]>();
  readonly #queued = new Set<string>();
  readonly #jobs: Promise<void>[] = [];
  #pending = 0;
  #onProgress: (() => void) | undefined;

  constructor(source: PtImageProvider, onProgress?: () => void) {
    this.#source = source;
    this.#onProgress = onProgress;
  }

  get progress(): StreamingImagesProgress {
    return { pending: this.#pending, decoded: this.#images.size };
  }

  /** Starts decoding files (UDIM sets per tile) at most `concurrency` at a time; failures are left to the final load. */
  prefetch(files: Iterable<string>, concurrency = 4): void {
    const queue: string[] = [];
    for (const file of files) {
      if (this.#queued.has(file)) continue;
      this.#queued.add(file);
      if (AssetResolver.hasUdim(file)) {
        const tiles = this.#source.exportSource?.(file)?.tiles ?? [];
        this.#tiles.set(file, tiles);
        for (const tile of tiles) queue.push(AssetResolver.expandUdim(file, tile));
      } else {
        queue.push(file);
      }
    }
    this.#pending += queue.length;
    const worker = async (): Promise<void> => {
      for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
        try {
          this.#images.set(file, (await this.#source.decode(file)) ?? undefined);
        } catch {
          this.#images.set(file, undefined);
        }
        this.#pending--;
        this.#onProgress?.();
      }
    };
    for (let i = 0; i < Math.min(concurrency, queue.length); i++) this.#jobs.push(worker());
  }

  /** Resolves when every prefetched file has been attempted. */
  async settled(): Promise<void> {
    while (this.#jobs.length) await Promise.all(this.#jobs.splice(0));
  }

  /** A provider frozen on the images decoded so far. */
  snapshot(): PtImageProvider {
    const images = new Map(this.#images);
    const resolve = (file: string): DecodedPixelImage | undefined => {
      if (!AssetResolver.hasUdim(file)) return images.has(file) ? images.get(file) : placeholderImage();
      const tiles = this.#tiles.get(file) ?? this.#source.exportSource?.(file)?.tiles ?? [];
      if (!tiles.length) return placeholderImage();
      const decoded = tiles.map(tile => images.get(AssetResolver.expandUdim(file, tile)));
      const first = decoded.find(image => image?.componentType === 'uint8' && image.channels === 4);
      const layers = tiles.map((tile, index) => {
        const image = decoded[index];
        const usable = image && first && image.width === first.width && image.height === first.height
          && image.componentType === 'uint8' && image.channels === 4 && !image.udim;
        return { tile, image: usable ? image : placeholderImage(first?.width ?? 1, first?.height ?? 1) };
      });
      return { ...layers[0]!.image, udim: layers };
    };
    return { decode: resolve, ...(this.#source.exportSource ? { exportSource: this.#source.exportSource.bind(this.#source) } : {}) };
  }
}
