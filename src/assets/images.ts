// Image decoder adapters behind a common registry. Heavy decoders (UTIF /
// geotiff for TIFF, three.js EXRLoader for HDR) are dependency-injected so the
// engine stays decoupled from any single library and testable before they are
// installed (docs/dependencies.md T004).
//
// Policy (plan sections 9.4, 10, REQ-011/013):
//  - Colorspace is ALWAYS supplied by the caller (from the MaterialX `image`
//    input); it is never inferred from the file. A missing colorspace is an error.
//  - High-precision sources (TIFF 16-bit, EXR half/float) decode through the
//    `pixels` path preserving bit depth -- never silently downconverted to 8-bit.
//  - 8-bit color/data (PNG/JPEG) may decode through the efficient `bitmap` path.

import { throwIfAborted, defaultDiagnosticSink, type DiagnosticSink } from '../core/diagnostics.ts';

export type ImageFormat = 'png' | 'jpeg' | 'tiff' | 'exr' | 'hdr';

export type ImageComponentType = 'uint8' | 'uint16' | 'float16' | 'float32';

export interface DecodedBitmapImage {
  kind: 'bitmap';
  bitmap: ImageBitmap;
  width: number;
  height: number;
  /** Declared colorspace carried from the MaterialX input. */
  colorSpace: string;
}

export interface DecodedPixelImage {
  kind: 'pixels';
  data: Uint8Array | Uint16Array | Float32Array;
  componentType: ImageComponentType;
  channels: 1 | 2 | 3 | 4;
  width: number;
  height: number;
  /** Declared colorspace carried from the MaterialX input. */
  colorSpace: string;
}

export type DecodedImage = DecodedBitmapImage | DecodedPixelImage;

export interface DecodeImageRequest {
  bytes: ArrayBuffer | Uint8Array;
  /** Declared by MaterialX; required and never inferred from the file. */
  colorSpace: string;
  format?: ImageFormat;
  /** Source name/URL, used for format detection and diagnostics. */
  name?: string;
  signal?: AbortSignal;
}

export type ImageDecoder = (request: DecodeImageRequest) => Promise<DecodedImage>;

export class ImageDecodeError extends Error {
  override readonly name = 'ImageDecodeError';
}

const EXTENSION_FORMATS: Readonly<Record<string, ImageFormat>> = {
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  tif: 'tiff',
  tiff: 'tiff',
  exr: 'exr',
  hdr: 'hdr',
};

/** Detect an image format from a file name/URL extension (UDIM-tolerant). */
export function detectImageFormat(name: string): ImageFormat | undefined {
  const clean = name.split(/[?#]/, 1)[0] ?? name;
  const dot = clean.lastIndexOf('.');
  if (dot < 0) return undefined;
  return EXTENSION_FORMATS[clean.slice(dot + 1).toLowerCase()];
}

export function toUint8(bytes: ArrayBuffer | Uint8Array): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

/**
 * Build a `bitmap`-path decoder from an injected `createImageBitmap`-like
 * function. Suitable for 8-bit PNG/JPEG uploaded directly to the GPU.
 */
export function createBitmapImageDecoder(
  createBitmap: (bytes: Uint8Array, request: DecodeImageRequest) => Promise<ImageBitmap>,
): ImageDecoder {
  return async (request) => {
    throwIfAborted(request.signal);
    const bitmap = await createBitmap(toUint8(request.bytes), request);
    return {
      kind: 'bitmap',
      bitmap,
      width: bitmap.width,
      height: bitmap.height,
      colorSpace: request.colorSpace,
    };
  };
}

/** Dispatches image decoding to a registered, format-specific decoder. */
export class ImageDecoderRegistry {
  private readonly decoders = new Map<ImageFormat, ImageDecoder>();

  constructor(private readonly diag: DiagnosticSink = defaultDiagnosticSink) {}

  register(format: ImageFormat, decoder: ImageDecoder): this {
    this.decoders.set(format, decoder);
    return this;
  }

  has(format: ImageFormat): boolean {
    return this.decoders.has(format);
  }

  async decode(request: DecodeImageRequest): Promise<DecodedImage> {
    throwIfAborted(request.signal);

    if (!request.colorSpace) {
      throw this.fail('Image decode requires an explicit colorSpace; none was inferred.', request.name);
    }

    const format =
      request.format ?? (request.name ? detectImageFormat(request.name) : undefined);
    if (!format) {
      throw this.fail(`Unknown image format for ${request.name ?? '<unnamed>'}.`, request.name);
    }

    const decoder = this.decoders.get(format);
    if (!decoder) {
      throw this.fail(`No decoder registered for image format '${format}'.`, request.name);
    }

    return decoder(request);
  }

  private fail(message: string, name: string | undefined): ImageDecodeError {
    this.diag({ level: 'error', message, detail: name ? { name } : undefined });
    return new ImageDecodeError(message);
  }
}
