// Volume decoder adapter. The target corpus contains no OpenVDB field (0 `.vdb`;
// transmission is BSDF surface transmission, not a volumetric grid), so no
// OpenVDB/NanoVDB dependency is added now (docs/dependencies.md T004, plan
// section 3). This module provides the structural hook: a pluggable decoder
// registry that fails with a clear diagnostic rather than silently succeeding
// when a volume asset appears without a configured reader (REQ-008/013).

import { throwIfAborted, defaultDiagnosticSink, type DiagnosticSink } from '../core/diagnostics.ts';

export type VolumeComponentType = 'float16' | 'float32';

export interface VolumeGrid {
  name: string;
  componentType: VolumeComponentType;
  channels: number;
  /** Decoder-owned sparse payload (e.g. NanoVDB buffer); engine-interpreted later. */
  data: ArrayBufferView;
}

export interface DecodedVolume {
  name: string;
  dimensions: readonly [number, number, number];
  bbox: { min: readonly [number, number, number]; max: readonly [number, number, number] };
  grids: VolumeGrid[];
}

export type VolumeFormat = 'vdb';

export interface DecodeVolumeRequest {
  bytes: ArrayBuffer | Uint8Array;
  format?: VolumeFormat;
  name?: string;
  signal?: AbortSignal;
}

export type VolumeDecoder = (request: DecodeVolumeRequest) => Promise<DecodedVolume>;

export class VolumeDecodeError extends Error {
  override readonly name = 'VolumeDecodeError';
}

/** Detect a volume format from a file name/URL extension. */
export function detectVolumeFormat(name: string): VolumeFormat | undefined {
  const clean = name.split(/[?#]/, 1)[0] ?? name;
  return /\.vdb$/i.test(clean) ? 'vdb' : undefined;
}

export function isVolumeAsset(name: string): boolean {
  return detectVolumeFormat(name) !== undefined;
}

/**
 * Dispatches volume decoding to a registered decoder. With no decoder
 * registered (the default for this corpus) it raises VolumeDecodeError instead
 * of returning an empty/placeholder volume.
 */
export class VolumeDecoderRegistry {
  private readonly decoders = new Map<VolumeFormat, VolumeDecoder>();

  constructor(private readonly diag: DiagnosticSink = defaultDiagnosticSink) {}

  register(format: VolumeFormat, decoder: VolumeDecoder): this {
    this.decoders.set(format, decoder);
    return this;
  }

  has(format: VolumeFormat): boolean {
    return this.decoders.has(format);
  }

  async decode(request: DecodeVolumeRequest): Promise<DecodedVolume> {
    throwIfAborted(request.signal);

    const format =
      request.format ?? (request.name ? detectVolumeFormat(request.name) : undefined);
    if (!format) {
      throw this.fail(`Unknown volume format for ${request.name ?? '<unnamed>'}.`, request.name);
    }

    const decoder = this.decoders.get(format);
    if (!decoder) {
      throw this.fail(
        `No volume decoder registered for '${format}'. Volumes are out of scope for this corpus; ` +
          `configure an OpenVDB/NanoVDB reader before decoding volume assets.`,
        request.name,
      );
    }

    return decoder(request);
  }

  private fail(message: string, name: string | undefined): VolumeDecodeError {
    this.diag({ level: 'error', message, detail: name ? { name } : undefined });
    return new VolumeDecodeError(message);
  }
}
