import type { DecodedPixelImage } from './images.ts';

/** Rasterize SVG through HTMLImageElement; Chromium cannot decode SVG blobs with createImageBitmap. */
export async function decodeBrowserImage(blob: Blob, sourceName: string): Promise<DecodedPixelImage> {
  const svg = blob.type.split(';')[0]?.trim().toLowerCase() === 'image/svg+xml' ||
    /\.svg(?:[?#]|$)/i.test(sourceName);
  let source: ImageBitmap | HTMLImageElement;
  let objectUrl: string | undefined;
  try {
    if (svg) {
      objectUrl = URL.createObjectURL(blob.type === 'image/svg+xml' ? blob : new Blob([blob], { type: 'image/svg+xml' }));
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      source = image;
    } else {
      source = await createImageBitmap(blob);
    }
    try {
      const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
      const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
      if (width <= 0 || height <= 0) throw new Error(`Texture has no raster dimensions: ${sourceName}`);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error(`Cannot create a 2D context for texture: ${sourceName}`);
      ctx.drawImage(source, 0, 0);
      const pixels = ctx.getImageData(0, 0, width, height);
      return {
        kind: 'pixels', data: new Uint8Array(pixels.data), componentType: 'uint8', channels: 4,
        width, height, colorSpace: 'lin_rec709',
      };
    } finally {
      if ('close' in source) source.close();
    }
  } finally {
    if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl);
  }
}
