// GPU memory accounting. WebGPU exposes no memory query, so the tracker wraps
// the device's createBuffer/createTexture and sums the bytes of live resources
// (released on destroy(), or when the wrapper is garbage-collected). Driver
// overheads (alignment, pipelines, swap chains) are not included.

import { interceptMethod } from './intercept.ts';

export interface GpuMemoryUsage {
  buffers: number;
  textures: number;
  total: number;
  /** Highest total since the tracker started. */
  peak: number;
}

const BYTES_PER_TEXEL: Readonly<Record<string, number>> = {
  r8unorm: 1, r8snorm: 1, r8uint: 1, r8sint: 1, stencil8: 1,
  rg8unorm: 2, rg8snorm: 2, rg8uint: 2, rg8sint: 2, r16float: 2, r16uint: 2, r16sint: 2, depth16unorm: 2,
  rg16float: 4, rg16uint: 4, rg16sint: 4, r32float: 4, r32uint: 4, r32sint: 4,
  rgba8unorm: 4, 'rgba8unorm-srgb': 4, rgba8snorm: 4, rgba8uint: 4, rgba8sint: 4,
  bgra8unorm: 4, 'bgra8unorm-srgb': 4, rgb10a2unorm: 4, rgb10a2uint: 4, rg11b10ufloat: 4, rgb9e5ufloat: 4,
  depth24plus: 4, 'depth24plus-stencil8': 4, depth32float: 4, 'depth32float-stencil8': 5,
  rg32float: 8, rg32uint: 8, rg32sint: 8, rgba16float: 8, rgba16uint: 8, rgba16sint: 8,
  rgba32float: 16, rgba32uint: 16, rgba32sint: 16,
};

function extent(size: GPUExtent3D): [number, number, number] {
  if (Symbol.iterator in Object(size)) {
    const [width = 1, height = 1, depth = 1] = [...(size as Iterable<number>)];
    return [width, height, depth];
  }
  const dict = size as GPUExtent3DDict;
  return [dict.width, dict.height ?? 1, dict.depthOrArrayLayers ?? 1];
}

/** Bytes of a texture with all its mip levels (block-compressed formats count 1 byte per texel). */
export function textureBytes(descriptor: GPUTextureDescriptor): number {
  const [width, height, depth] = extent(descriptor.size);
  const texel = BYTES_PER_TEXEL[descriptor.format] ?? (descriptor.format.startsWith('bc') || descriptor.format.startsWith('etc2')
    || descriptor.format.startsWith('astc') || descriptor.format.startsWith('eac') ? 1 : 4);
  const volume = descriptor.dimension === '3d';
  let bytes = 0;
  for (let level = 0; level < (descriptor.mipLevelCount ?? 1); level++) {
    bytes += Math.max(1, width >> level) * Math.max(1, height >> level) * (volume ? Math.max(1, depth >> level) : depth);
  }
  return bytes * texel * (descriptor.sampleCount ?? 1);
}

type Tracked = { kind: 'buffers' | 'textures'; bytes: number; released: boolean };

export class GpuMemoryTracker {
  #usage = { buffers: 0, textures: 0, peak: 0 };
  #listeners = new Set<(usage: GpuMemoryUsage) => void>();
  #restore: () => void;
  #registry = new FinalizationRegistry<Tracked>(entry => this.#release(entry));

  constructor(device: GPUDevice) {
    let active = true;
    const restoreBuffer = interceptMethod(device, 'createBuffer', (call, args) => {
      const buffer = call(...args) as GPUBuffer;
      if (active) this.#track(buffer, 'buffers', (args[0] as GPUBufferDescriptor).size);
      return buffer;
    });
    const restoreTexture = interceptMethod(device, 'createTexture', (call, args) => {
      const texture = call(...args) as GPUTexture;
      if (active) this.#track(texture, 'textures', textureBytes(args[0] as GPUTextureDescriptor));
      return texture;
    });
    this.#restore = () => { active = false; restoreTexture(); restoreBuffer(); };
  }

  get usage(): GpuMemoryUsage {
    const { buffers, textures, peak } = this.#usage;
    return { buffers, textures, total: buffers + textures, peak };
  }

  onChange(listener: (usage: GpuMemoryUsage) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Stops tracking new resources and restores the device methods. */
  dispose(): void {
    this.#restore();
    this.#listeners.clear();
  }

  #track(resource: GPUBuffer | GPUTexture, kind: Tracked['kind'], bytes: number): void {
    const entry: Tracked = { kind, bytes, released: false };
    if (typeof resource?.destroy !== 'function') return;
    interceptMethod(resource as { destroy(): void }, 'destroy', (call, args) => {
      this.#release(entry);
      return call(...args);
    });
    this.#registry.register(resource, entry);
    this.#usage[kind] += bytes;
    this.#usage.peak = Math.max(this.#usage.peak, this.#usage.buffers + this.#usage.textures);
    this.#notify();
  }

  #release(entry: Tracked): void {
    if (entry.released) return;
    entry.released = true;
    this.#usage[entry.kind] -= entry.bytes;
    this.#notify();
  }

  #notify(): void {
    if (this.#listeners.size === 0) return;
    const usage = this.usage;
    for (const listener of this.#listeners) listener(usage);
  }
}
