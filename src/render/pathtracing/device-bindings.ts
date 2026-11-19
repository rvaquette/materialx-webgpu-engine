// T057m2: assemble the path tracer graph-path device bindings as a pure plan the
// harness turns into GPUBuffers/textures. The megakernel's group-0 layout is
// fixed (uniform, nodes, tris, triOrder, materials, accum, triUv, triTangent, and
// MxUniforms at 8 and converted analytic lights at 9 when present); group 1 holds the deduped textures and group 2 their
// samplers (texture-registry, T057j). This maps each registry slot to its decoded
// image -- decoding each unique file once via the injected provider so materials
// sharing a file share a single upload -- and orders the scene storage buffers.
// No WebGPU here: device.createTexture/createBindGroup stay in the harness (m3).

import type { DecodedPixelImage, TextureExportSource } from '../../assets/images.ts';
import type { Diagnostic, DiagnosticSink } from '../../core/diagnostics.ts';
import type { PtMaterialDispatch } from './material-variant.ts';
import { PT_OBJECT_VERTEX_FLOATS, PT_TRIANGLE_FLOATS, type PathTraceObjectGeometry, type PathTraceScene } from './scene-buffers.ts';
import { inverse4 } from '../../scene/transforms.ts';
import { OBJECT_TO_WORLD_INPUT, WORLD_TO_OBJECT_INPUT, OBJECT_GEOMETRY_INPUTS } from '../../compiler/ir.ts';
import { imageSamplerDescriptor, type ImageSamplerDescriptor } from '../../assets/samplers.ts';
import type { WgslBinding } from '../../compiler/wgsl.ts';

/** Decodes a texture file reference to pixels; injected so the resolver/decoder
 *  (and its colorspace policy) stay out of this pure planner. Called once per
 *  unique file (the registry already deduped by file reference). */
export interface PtImageProvider {
  decode(fileRef: string): Promise<DecodedPixelImage | undefined> | DecodedPixelImage | undefined;
  exportSource?(fileRef: string): TextureExportSource | undefined;
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
  | 'analyticLights'
  | 'volumeData';

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
  format: 'rgba8unorm' | 'rgba8unorm-srgb' | 'r32uint';
  textureKind?: WgslBinding['textureKind'];
  /** Image indices in array-layer order; absent for ordinary and UDIM bindings. */
  arrayImages?: number[];
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
  /** group-2 sampler slots, shared by effective addressing/filtering descriptor. */
  samplers: PtSamplerBinding[];
  /** Unique decoded images aligned to the registry (deduped by file); `undefined`
   *  marks a file that failed to decode (diagnostic emitted) or a fileless slot. */
  images: (DecodedPixelImage | undefined)[];
}

export interface BuildPtDeviceBindingsOptions {
  sink?: DiagnosticSink;
}

function group0Slots(scene: PathTraceScene, dispatch: PtMaterialDispatch): PtBufferSlot[] {
  const transforms = dispatch.extraInputs.has(OBJECT_TO_WORLD_INPUT) || dispatch.extraInputs.has(WORLD_TO_OBJECT_INPUT)
    || [...dispatch.extraInputs.keys()].some(name => OBJECT_GEOMETRY_INPUTS.has(name));
  const slots: PtBufferSlot[] = [
    { binding: 0, role: 'uniform', usage: 'uniform', access: 'read' },
    { binding: 1, role: 'nodes', usage: 'storage', access: 'read', data: scene.nodes },
    { binding: 2, role: 'triangles', usage: 'storage', access: 'read', data: scene.triangles },
    { binding: 3, role: 'triangleOrder', usage: 'storage', access: 'read', data: scene.triangleOrder },
    { binding: 4, role: 'materials', usage: 'storage', access: 'read', data: scene.materials },
    { binding: 5, role: 'accum', usage: 'storage', access: 'read_write' },
    { binding: 6, role: 'triangleUv', usage: 'storage', access: 'read', data: transforms ? packUvAndTransforms(scene, dispatch) : scene.triangleUv },
    { binding: 7, role: 'triangleTangent', usage: 'storage', access: 'read', data: scene.triangleTangent },
  ];
  // The editable-params block sits past the scene buffers (currently empty, T057i3).
  if (dispatch.uniforms.length > 0) {
    slots.push({ binding: 8, role: 'mxUniforms', usage: 'uniform', access: 'read' });
  }
  if (scene.analyticLights) slots.push({ binding: 9, role: 'analyticLights', usage: 'storage', access: 'read', data: scene.analyticLights });
  if (scene.volumeData) slots.push({ binding: 10, role: 'volumeData', usage: 'storage', access: 'read', data: scene.volumeData });
  return slots;
}

function packUvAndTransforms(scene: PathTraceScene, dispatch: PtMaterialDispatch): Float32Array {
  const ranges = scene.transformRanges;
  if (!ranges) throw new Error('Path tracing scene lacks instance transforms; rebuild or re-export it.');
  const count = scene.triangleCount;
  if (scene.triangleUv.length !== count * 6) throw new Error('Invalid triangle UV buffer for instance transforms.');
  const inverseMaterials = new Set(dispatch.variants
    .filter(variant => variant.extraInputs.has(WORLD_TO_OBJECT_INPUT))
    .map(variant => variant.index));
  const geometryMaterials = new Set(dispatch.variants
    .filter(variant => [...variant.extraInputs.keys()].some(name => OBJECT_GEOMETRY_INPUTS.has(name)))
    .map(variant => variant.index));
  if ([...dispatch.extraInputs.keys()].some(name => OBJECT_GEOMETRY_INPUTS.has(name)) && geometryMaterials.size === 0) {
    throw new Error('Object-space geometry is missing from path tracing material variants.');
  }
  if (ranges.length > 2 ** 24) throw new Error('Too many instances for path tracing transform indices.');
  const geometryOffsets = new Map<string, { first: number; geometry: PathTraceObjectGeometry }>();
  let vertexCount = geometryMaterials.size ? 1 : 0;
  for (const range of ranges) {
    if (!geometryMaterials.has(range.materialIndex)) continue;
    const id = range.prototypeId;
    const geometry = id !== undefined ? scene.objectGeometry?.get(id) : undefined;
    if (!id || !geometry) throw new Error(`Missing object-space geometry for instance '${range.instanceId}'; rebuild or re-export the scene.`);
    const vertices = geometry.positions.length / 3;
    if (!Number.isSafeInteger(vertices) || geometry.indices.length !== range.triangleCount * 3
        || geometry.indices.some(index => index >= vertices)
        || (geometry.normals && geometry.normals.length !== vertices * 3)
        || (geometry.tangents && (geometry.tangentComponents !== 3 && geometry.tangentComponents !== 4
          || geometry.tangents.length !== vertices * geometry.tangentComponents))
        || geometry.positions.some(value => !Number.isFinite(value))
        || geometry.normals?.some(value => !Number.isFinite(value))
        || geometry.tangents?.some(value => !Number.isFinite(value))) {
      throw new Error(`Invalid object-space geometry for instance '${range.instanceId}'.`);
    }
    if (!geometryOffsets.has(id)) {
      geometryOffsets.set(id, { first: vertexCount, geometry });
      vertexCount += vertices;
      if (vertexCount > 2 ** 24) throw new Error('Too many object-space vertices for path tracing indices.');
    }
  }
  // UVs, per-triangle range indices and matrices stay at their existing offsets.
  const triangleIndexBase = count * 7 + ranges.length * 32;
  const vertexBase = triangleIndexBase + (geometryMaterials.size ? count * 3 : 0);
  const data = new Float32Array(vertexBase + vertexCount * PT_OBJECT_VERTEX_FLOATS);
  data.set(scene.triangleUv);
  if (geometryMaterials.size) {
    data[vertexBase + 5] = 1;
    data[vertexBase + 10] = 1;
    for (const { first, geometry } of geometryOffsets.values()) {
      const vertices = geometry.positions.length / 3;
      for (let vertex = 0; vertex < vertices; vertex++) {
        const offset = vertexBase + (first + vertex) * PT_OBJECT_VERTEX_FLOATS;
        data.set(geometry.positions.subarray(vertex * 3, vertex * 3 + 3), offset);
        if (geometry.normals) data.set(geometry.normals.subarray(vertex * 3, vertex * 3 + 3), offset + 3);
        if (geometry.tangents && geometry.tangentComponents) {
          const stride = geometry.tangentComponents;
          data.set(geometry.tangents.subarray(vertex * stride, vertex * stride + 3), offset + 6);
          data[offset + 9] = stride === 4 ? geometry.tangents[vertex * stride + 3]! : 1;
        }
        data[offset + 10] = geometry.normals ? 1 : 0;
      }
    }
  }
  let first = 0;
  for (const [index, range] of ranges.entries()) {
    if (range.firstTriangle !== first || !Number.isSafeInteger(range.triangleCount) || range.triangleCount <= 0
        || first + range.triangleCount > count || range.model.length !== 16
        || range.model.some(value => !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))) {
      throw new Error(`Invalid path tracing instance transform range '${range.instanceId}'.`);
    }
    for (let triangle = first; triangle < first + range.triangleCount; triangle++) {
      if (scene.triangles[triangle * PT_TRIANGLE_FLOATS + 18] !== range.materialIndex) {
        throw new Error(`Material mismatch in instance transform range '${range.instanceId}'.`);
      }
    }
    data.fill(index, count * 6 + first, count * 6 + first + range.triangleCount);
    if (geometryMaterials.has(range.materialIndex)) {
      const { first: vertexOffset, geometry } = geometryOffsets.get(range.prototypeId!)!;
      for (let i = 0; i < geometry.indices.length; i++) {
        data[triangleIndexBase + first * 3 + i] = vertexOffset + geometry.indices[i]!;
      }
    }
    const offset = count * 7 + index * 32;
    data.set(range.model, offset);
    if (inverseMaterials.has(range.materialIndex)) data.set(inverse4(range.model, true), offset + 16);
    first += range.triangleCount;
  }
  if (first !== count) throw new Error('Instance transform ranges do not cover the path tracing triangles.');
  return data;
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
    format: t.textureKind === 'udim-index' || t.textureKind === 'index-array' ? 'r32uint' : t.colorSpace === 'srgb_texture' ? 'rgba8unorm-srgb' : 'rgba8unorm',
    ...(t.textureKind !== undefined ? { textureKind: t.textureKind } : {}),
    ...(registry.textureArrayImages?.[i] ? { arrayImages: [...registry.textureArrayImages[i]!] } : {}),
  }));
  const samplers: PtSamplerBinding[] = registry.samplers.map((s) => ({
    binding: s.binding,
    handle: s.handle,
    descriptor: imageSamplerDescriptor(s.sampler ?? {}),
  }));

  return { group0: group0Slots(scene, dispatch), textures, samplers, images };
}
