// T057m2: assemble the path tracer graph-path device bindings as a pure plan the
// harness turns into GPUBuffers/textures. The megakernel's group-0 layout is
// fixed (uniform, nodes, tris, triOrder, materials, accum, triUv, triTangent, and
// MxUniforms at 8 and converted analytic lights at 9 when present); group 1 holds the deduped textures and group 2 their
// samplers (texture-registry, T057j). This maps each registry slot to its decoded
// image -- decoding each unique file once via the injected provider so materials
// sharing a file share a single upload -- and orders the scene storage buffers.
// No WebGPU here: device.createTexture/createBindGroup stay in the harness (m3).

import type { DecodedPixelImage } from '../../assets/images.ts';
import type { Diagnostic, DiagnosticSink } from '../../core/diagnostics.ts';
import type { PtMaterialDispatch } from './material-variant.ts';
import type { PathTraceScene } from './scene-buffers.ts';
import { imageSamplerDescriptor, type ImageSamplerDescriptor } from '../../assets/samplers.ts';

/** Decodes a texture file reference to pixels; injected so the resolver/decoder
 *  (and its colorspace policy) stay out of this pure planner. Called once per
 *  unique file (the registry already deduped by file reference). */
export interface PtImageProvider {
  decode(fileRef: string): Promise<DecodedPixelImage | undefined> | DecodedPixelImage | undefined;
}

/** A group-0 buffer slot in megakernel binding order. `data` is the scene-sourced
 *  payload; it is absent for the per-frame uniform and the accumulation buffer,
 *  which the harness sizes from the render target. */
export type PtBufferRole =
  | 'uniform'
  | 'nodes'
  | 'triangles'
  | 'triangleOrder'
  | 'materials'
  | 'accum'
  | 'triangleUv'
  | 'triangleTangent'
  | 'mxUniforms'
  | 'analyticLights';

export interface PtBufferSlot {
  binding: number;
  role: PtBufferRole;
  usage: 'uniform' | 'storage';
  access: 'read' | 'read_write';
  data?: Float32Array | Uint32Array;
}

/** MaterialX image addressing/filtering mapped to the device sampler. */
export type PtSamplerDescriptor = ImageSamplerDescriptor;

export interface PtTextureBinding {
  /** group-1 binding index. */
  binding: number;
  handle: string;
  /** Index into `images` (shared when materials reference the same file). */
  imageIndex: number;
  format: 'rgba8unorm' | 'rgba8unorm-srgb';
}

export interface PtSamplerBinding {
  /** group-2 binding index. */
  binding: number;
  handle: string;
  descriptor: PtSamplerDescriptor;
}

export interface PtDeviceBindings {
  /** group-0 slots in binding order (0..7, optional MxUniforms at 8 and lights at 9). */
  group0: PtBufferSlot[];
  /** group-1 texture slots; empty when no material references a texture. */
  textures: PtTextureBinding[];
  /** group-2 sampler slots, one per texture slot. */
  samplers: PtSamplerBinding[];
  /** Unique decoded images aligned to the registry (deduped by file); `undefined`
   *  marks a file that failed to decode (diagnostic emitted) or a fileless slot. */
  images: (DecodedPixelImage | undefined)[];
}

export interface BuildPtDeviceBindingsOptions {
  sink?: DiagnosticSink;
}

function group0Slots(scene: PathTraceScene, dispatch: PtMaterialDispatch): PtBufferSlot[] {
  const slots: PtBufferSlot[] = [
    { binding: 0, role: 'uniform', usage: 'uniform', access: 'read' },
    { binding: 1, role: 'nodes', usage: 'storage', access: 'read', data: scene.nodes },
    { binding: 2, role: 'triangles', usage: 'storage', access: 'read', data: scene.triangles },
    { binding: 3, role: 'triangleOrder', usage: 'storage', access: 'read', data: scene.triangleOrder },
    { binding: 4, role: 'materials', usage: 'storage', access: 'read', data: scene.materials },
    { binding: 5, role: 'accum', usage: 'storage', access: 'read_write' },
    { binding: 6, role: 'triangleUv', usage: 'storage', access: 'read', data: scene.triangleUv },
    { binding: 7, role: 'triangleTangent', usage: 'storage', access: 'read', data: scene.triangleTangent },
  ];
  // The editable-params block sits past the scene buffers (currently empty, T057i3).
  if (dispatch.uniforms.length > 0) {
    slots.push({ binding: 8, role: 'mxUniforms', usage: 'uniform', access: 'read' });
  }
  if (scene.analyticLights) slots.push({ binding: 9, role: 'analyticLights', usage: 'storage', access: 'read', data: scene.analyticLights });
  return slots;
}

/** Build the graph-path device binding plan: decode the deduped registry images,
 *  map texture/sampler slots to them, and order the scene storage buffers. */
export async function buildPtDeviceBindings(
  dispatch: PtMaterialDispatch,
  scene: PathTraceScene,
  provider: PtImageProvider,
  options: BuildPtDeviceBindingsOptions = {},
): Promise<PtDeviceBindings> {
  const emit: (d: Diagnostic) => void = options.sink ?? (() => undefined);
  const registry = dispatch.textureRegistry;

  // Decode each unique image once (dedup already applied by file reference).
  const images: (DecodedPixelImage | undefined)[] = [];
  for (const fileRef of registry.images) {
    if (fileRef === undefined) {
      images.push(undefined);
      continue;
    }
    const decoded = await provider.decode(fileRef);
    if (!decoded) {
      emit({ level: 'warning', message: `Texture image failed to decode: ${fileRef}`, detail: { file: fileRef } });
    }
    images.push(decoded ?? undefined);
  }

  const textures: PtTextureBinding[] = registry.textures.map((t, i) => ({
    binding: t.binding,
    handle: t.handle,
    imageIndex: registry.textureImage[i]!,
    format: registry.textures[i]!.colorSpace === 'srgb_texture' ? 'rgba8unorm-srgb' : 'rgba8unorm',
  }));
  const samplers: PtSamplerBinding[] = registry.samplers.map((s) => ({
    binding: s.binding,
    handle: s.handle,
    descriptor: imageSamplerDescriptor(s.sampler ?? {}),
  }));

  return { group0: group0Slots(scene, dispatch), textures, samplers, images };
}
