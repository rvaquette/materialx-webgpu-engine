import { AsyncResourceCache } from './cache.ts';
import type { DecodedPixelImage } from './images.ts';

const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;

export class DecodedImageCache {
  private readonly cache: AsyncResourceCache<DecodedPixelImage>;

  constructor(maxBytes = DEFAULT_MAX_BYTES) {
    this.cache = new AsyncResourceCache({
      maxBytes,
      onDiagnostic: (diagnostic) => console.warn(diagnostic.message),
    });
  }

  async get(url: string, load: (signal: AbortSignal) => Promise<DecodedPixelImage>): Promise<DecodedPixelImage> {
    const keyUrl = new URL(url);
    keyUrl.hash = '';
    const key = keyUrl.href;
    const hit = this.cache.has(key);
    const started = performance.now();
    const image = await this.cache.get(key, async (signal) => {
      const value = await load(signal);
      return { value, size: value.data.byteLength };
    });
    performance.measure('assets:texture-cache', {
      start: started,
      end: performance.now(),
      detail: { hit, url: key, bytes: image.data.byteLength },
    });
    return image;
  }
}
