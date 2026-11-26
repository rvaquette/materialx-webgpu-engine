import type { DecodedPixelImage } from '../assets/images.ts';
import { buildTlas } from '../geometry/bvh.ts';
import { prepareMesh } from '../geometry/prepare.ts';
import { assembleIrForwardShader } from './raster/ir-forward.ts';
import { buildGeometry, transformBounds, type GeometryResource, type SceneResources, type MaterialDisplacement } from './scene-resources.ts';
import type { PtImageProvider } from './pathtracing/device-bindings.ts';
import { udimTileAt } from '../assets/udim.ts';
import { evaluateIrRef, type IrEvalVaryings } from '../compiler/ir-eval.ts';
import {
  OBJECT_BITANGENT_INPUT, OBJECT_NORMAL_INPUT, OBJECT_POSITION_INPUT, OBJECT_TANGENT_INPUT,
  type IrType, type ShaderIr,
} from '../compiler/ir.ts';
import { emitWgsl, lowerExprs } from '../compiler/wgsl.ts';
import { createImageSampler, type ImageSampler } from './pathtracing/texture-sample.ts';
import { packParameterUniforms } from './material-parameters.ts';
import { imageSamplerDescriptor } from '../assets/samplers.ts';

const DISPLACEMENT_COMPUTE_MIN_VERTICES = 4096;
const DISPLACEMENT_COMPUTE_WORKGROUP_SIZE = 64;

function ident(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_');
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

function floatAttribute(type: IrType): boolean {
  return type.kind === 'scalar' ? type.scalar === 'float'
    : type.kind === 'vector' && type.scalar === 'float';
}

function displacementTexturePixels(image: DecodedPixelImage): Uint8Array | undefined {
  if (image.udim || image.componentType !== 'uint8' || !(image.data instanceof Uint8Array)
      || image.width < 1 || image.height < 1
      || image.data.length !== image.width * image.height * image.channels) return undefined;
  const rgba = new Uint8Array(image.width * image.height * 4);
  for (let pixel = 0; pixel < image.width * image.height; pixel++) {
    const source = pixel * image.channels;
    const target = pixel * 4;
    for (let channel = 0; channel < image.channels && channel < 4; channel++) {
      rgba[target + channel] = image.data[source + channel]!;
    }
    rgba[target + 3] = image.channels === 4 ? image.data[source + 3]! : 255;
  }
  return rgba;
}

function displacementInputSlots(
  geometry: GeometryResource, lowered: ReturnType<typeof lowerExprs>,
): { stride: number; values: Float32Array; wgsl: string } | undefined {
  const positions = geometry.streams.find(stream => stream.name === 'position')?.data;
  const normals = geometry.streams.find(stream => stream.name === 'normal')?.data;
  const tangents = geometry.streams.find(stream => stream.name === 'tangent')?.data;
  const tangentComponents = geometry.streams.find(stream => stream.name === 'tangent')?.components ?? 3;
  const uv = geometry.streams.find(stream => stream.name === 'uv')?.data;
  if (!positions || !normals) return undefined;

  const expressions = [...lowered.extraInputs.keys()];
  const sourceFor = (name: string): ((vertex: number) => ArrayLike<number>) | undefined => {
    if (name === 'position' || name === OBJECT_POSITION_INPUT) {
      return vertex => positions.subarray(vertex * 3, vertex * 3 + 3);
    }
    if (name === 'normal' || name === OBJECT_NORMAL_INPUT) {
      return vertex => normals.subarray(vertex * 3, vertex * 3 + 3);
    }
    if (name === 'tangent' || name === OBJECT_TANGENT_INPUT) {
      return vertex => tangents
        ? tangents.subarray(vertex * tangentComponents, vertex * tangentComponents + 3)
        : [1, 0, 0];
    }
    if (name === OBJECT_BITANGENT_INPUT) {
      return vertex => {
        const n = normals.subarray(vertex * 3, vertex * 3 + 3);
        const tangent = tangents
          ? tangents.subarray(vertex * tangentComponents, (vertex + 1) * tangentComponents)
          : [1, 0, 0, 1];
        const hand = tangent[3] ?? 1;
        return [
          (n[1]! * tangent[2]! - n[2]! * tangent[1]!) * hand,
          (n[2]! * tangent[0]! - n[0]! * tangent[2]!) * hand,
          (n[0]! * tangent[1]! - n[1]! * tangent[0]!) * hand,
        ];
      };
    }
    if (name === 'texcoord') return vertex => uv?.subarray(vertex * 2, vertex * 2 + 2) ?? [0, 0];
    if (['view', 'viewdir', 'viewdirection'].includes(name.toLowerCase())) return undefined;
    return undefined;
  };
  const primvarSource = (name: string): ((vertex: number) => ArrayLike<number>) => {
    const streamName = name === 'st' ? 'uv' : name;
    const stream = geometry.streams.find(candidate => candidate.name === streamName);
    return stream
      ? vertex => stream.data.subarray(vertex * stream.components, (vertex + 1) * stream.components)
      : () => [];
  };

  const inputTypes = new Map<string, IrType>();
  for (const [name, type] of lowered.extraInputs) inputTypes.set(name, type);
  for (const [name, type] of lowered.primvarFields) inputTypes.set(`v_${name}`, type);
  if ([...inputTypes.values()].some(type => !floatAttribute(type))) return undefined;

  const slotFor = new Map<string, number>();
  const readers: ((vertex: number) => ArrayLike<number>)[] = [];
  const add = (key: string, reader: (vertex: number) => ArrayLike<number>): number => {
    const index = readers.length;
    slotFor.set(key, index);
    readers.push(reader);
    return index;
  };
  add('position', sourceFor('position')!);
  add('normal', sourceFor('normal')!);
  add('tangent', sourceFor('tangent')!);
  add('bitangent', sourceFor(OBJECT_BITANGENT_INPUT)!);
  add('texcoord', sourceFor('texcoord')!);
  for (const name of expressions) {
    if (!sourceFor(name)) return undefined;
    add(`in_${name}`, sourceFor(name)!);
  }
  for (const name of lowered.primvarFields.keys()) add(`v_${name}`, primvarSource(name));

  const stride = readers.length;
  const values = new Float32Array(geometry.vertexCount * stride * 4);
  for (let vertex = 0; vertex < geometry.vertexCount; vertex++) {
    for (let slot = 0; slot < stride; slot++) {
      const value = readers[slot]!(vertex);
      const offset = (vertex * stride + slot) * 4;
      for (let component = 0; component < Math.min(value.length, 4); component++) {
        values[offset + component] = value[component]!;
      }
    }
  }
  const fieldValue = (type: IrType, slot: number): string => {
    const value = `mx_displacement_inputs[vertex * ${stride}u + ${slot}u]`;
    return type.kind === 'scalar' ? `${value}.x`
      : type.kind === 'vector' ? `${value}.${'xyzw'.slice(0, type.size)}`
      : '0.0';
  };
  const assignments = [
    `vary.position = mx_displacement_inputs[vertex * ${stride}u + ${slotFor.get('position')}u].xyz;`,
    `vary.normal = mx_displacement_inputs[vertex * ${stride}u + ${slotFor.get('normal')}u].xyz;`,
    `vary.tangent = mx_displacement_inputs[vertex * ${stride}u + ${slotFor.get('tangent')}u].xyz;`,
    `vary.bitangent = mx_displacement_inputs[vertex * ${stride}u + ${slotFor.get('bitangent')}u].xyz;`,
    `vary.texcoord = mx_displacement_inputs[vertex * ${stride}u + ${slotFor.get('texcoord')}u].xy;`,
    'vary.viewDir = vec3f(0.0, 0.0, 1.0);',
    'vary.frontFacing = 1.0;',
  ];
  for (const [name, type] of lowered.extraInputs) {
    const slot = slotFor.get(`in_${name}`)!;
    assignments.push(`vary.in_${ident(name)} = ${fieldValue(type, slot)};`);
  }
  for (const [name, type] of lowered.primvarFields) {
    const slot = slotFor.get(`v_${name}`)!;
    assignments.push(`vary.v_${ident(name)} = ${fieldValue(type, slot)};`);
  }
  return { stride, values, wgsl: assignments.join('\n') };
}

async function computeDisplacementOffsets(
  device: GPUDevice, geometry: GeometryResource,
  displacement: NonNullable<MaterialDisplacement['program']>,
  parameters: readonly { uniform?: string; value: readonly number[] }[] = [],
  images: ReadonlyMap<string, DecodedPixelImage> = new Map(),
): Promise<Float32Array | undefined> {
  if (geometry.vertexCount < DISPLACEMENT_COMPUTE_MIN_VERTICES) return undefined;
  const displacementExpr = displacement.ir.exprs.get(displacement.displacementRef);
  const scaleExpr = displacement.ir.exprs.get(displacement.scaleRef);
  if (!displacementExpr || !scaleExpr || !floatAttribute(displacementExpr.type)
      || scaleExpr.type.kind !== 'scalar' || scaleExpr.type.scalar !== 'float') return undefined;
  if ((displacement.mode === 'scalar' && displacementExpr.type.kind !== 'scalar')
      || (displacement.mode === 'vector' && (displacementExpr.type.kind !== 'vector' || displacementExpr.type.size !== 3))) {
    return undefined;
  }

  const ir: ShaderIr = {
    ...displacement.ir,
    outputs: [
      { name: 'displacement', type: displacementExpr.type, ref: displacement.displacementRef },
      { name: 'scale', type: scaleExpr.type, ref: displacement.scaleRef },
    ],
  };
  if (ir.requirements.needsDerivatives || ir.requirements.needsTextureFootprint
      || [...ir.exprs.values()].some(expression =>
        expression.kind === 'texture' && (expression.bias !== undefined || expression.gradient !== undefined))) {
    return undefined;
  }
  const lowered = lowerExprs(ir, '', true);
  const inputs = displacementInputSlots(geometry, lowered);
  if (!inputs) return undefined;
  const unsupportedInput = [...ir.exprs.values()].some(expression =>
    expression.kind === 'input' && ['view', 'viewdir', 'viewdirection'].includes(expression.name.toLowerCase()));
  if (unsupportedInput) return undefined;

  const module = emitWgsl(ir, true);
  if (module.uniforms.some(field => !/^(f32|i32|u32|vec[234]f|vec[234]<f32>)$/.test(field.wgslType))) {
    return undefined;
  }
  const textureUploads = module.textures.map(binding => {
    if (binding.textureKind !== undefined || !binding.fileRef) return undefined;
    const image = images.get(binding.fileRef);
    if (!image || image.width > device.limits.maxTextureDimension2D || image.height > device.limits.maxTextureDimension2D) {
      return undefined;
    }
    const pixels = displacementTexturePixels(image);
    if (!pixels) return undefined;
    const sampler = module.samplers.find(candidate => candidate.name === binding.name)?.sampler;
    if (sampler?.addressU === 'constant' || sampler?.addressV === 'constant') return undefined;
    return {
      binding, image, pixels,
      format: (binding.colorSpace ?? image.colorSpace) === 'srgb_texture'
        ? 'rgba8unorm-srgb' as const : 'rgba8unorm' as const,
    };
  });
  if (textureUploads.some(upload => upload === undefined)) return undefined;
  const parameterMap = new Map(parameters.flatMap(parameter =>
    parameter.uniform ? [[parameter.uniform, parameter.value] as const] : []));
  const uniformData = module.uniforms.length > 0
    ? packParameterUniforms(module.uniforms, field => {
      const value = parameterMap.get(field.name);
      if (!value) throw new Error(`Missing displacement parameter: ${field.name}`);
      return value;
    })
    : undefined;
  const tangents = geometry.streams.find(stream => stream.name === 'tangent');
  const vectorMode = displacement.mode === 'vector';
  if (vectorMode && !tangents) return undefined;
  const code = `${module.code}
@group(3) @binding(0) var<storage, read> mx_displacement_inputs: array<vec4f>;
@group(3) @binding(1) var<storage, read_write> mx_displacement_offsets: array<vec4f>;
@compute @workgroup_size(${DISPLACEMENT_COMPUTE_WORKGROUP_SIZE})
fn mx_displacement_main(@builtin(global_invocation_id) global_id: vec3u) {
  let vertex = global_id.x;
  if (vertex >= ${geometry.vertexCount}u) { return; }
  var vary: MxVaryings;
${inputs.wgsl.split('\n').map(line => `  ${line}`).join('\n')}
  let result = mx_shade(vary);
  var offset: vec3f;
${vectorMode
    ? `  offset = (vary.tangent * result.displacement.x + vary.bitangent * result.displacement.y
    + vary.normal * result.displacement.z) * result.scale;`
    : '  offset = vary.normal * result.displacement * result.scale;'}
  mx_displacement_offsets[vertex] = vec4f(offset, 0.0);
}`;

  const inputBytes = inputs.values.byteLength;
  const outputBytes = geometry.vertexCount * 16;
  const workgroups = Math.ceil(geometry.vertexCount / DISPLACEMENT_COMPUTE_WORKGROUP_SIZE);
  if (inputBytes > device.limits.maxStorageBufferBindingSize
      || outputBytes > device.limits.maxStorageBufferBindingSize
      || inputBytes > device.limits.maxBufferSize || outputBytes > device.limits.maxBufferSize
      || workgroups > device.limits.maxComputeWorkgroupsPerDimension
      || (uniformData?.byteLength ?? 0) > device.limits.maxUniformBufferBindingSize) {
    return undefined;
  }

  const computeStarted = performance.now();
  let inputBuffer: GPUBuffer | undefined;
  let outputBuffer: GPUBuffer | undefined;
  let readback: GPUBuffer | undefined;
  let uniformBuffer: GPUBuffer | undefined;
  const gpuTextures: GPUTexture[] = [];
  try {
    inputBuffer = device.createBuffer({
      size: inputBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    outputBuffer = device.createBuffer({
      size: outputBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    readback = device.createBuffer({
      size: outputBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    uniformBuffer = uniformData
      ? device.createBuffer({ size: uniformData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      : undefined;
    device.queue.writeBuffer(inputBuffer, 0, inputs.values);
    if (uniformBuffer && uniformData) device.queue.writeBuffer(uniformBuffer, 0, uniformData);
    const textureEntries: GPUBindGroupEntry[] = [];
    for (const upload of textureUploads) {
      if (!upload) continue;
      const texture = device.createTexture({
        size: [upload.image.width, upload.image.height, 1],
        format: upload.format,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      gpuTextures.push(texture);
      device.queue.writeTexture(
        { texture }, upload.pixels, { bytesPerRow: upload.image.width * 4, rowsPerImage: upload.image.height },
        [upload.image.width, upload.image.height, 1],
      );
      textureEntries.push({ binding: upload.binding.binding, resource: texture.createView() });
    }
    const samplerEntries: GPUBindGroupEntry[] = module.samplers.map(binding => ({
      binding: binding.binding,
      resource: device.createSampler(imageSamplerDescriptor(binding.sampler ?? {})),
    }));
    const shader = device.createShaderModule({ code, label: 'MaterialX displacement compute' });
    const compilation = await shader.getCompilationInfo();
    const shaderErrors = compilation.messages.filter(message => message.type === 'error');
    if (shaderErrors.length > 0) {
      throw new Error(`Displacement compute WGSL failed to compile: ${shaderErrors.map(message => message.message).join('\n')}`);
    }
    device.pushErrorScope('validation');
    const pipeline = device.createComputePipeline({
      layout: 'auto', compute: { module: shader, entryPoint: 'mx_displacement_main' },
    });
    const pipelineError = await device.popErrorScope();
    if (pipelineError) throw new Error(`Displacement compute pipeline is invalid: ${pipelineError.message}`);
    const bindGroup = (index: number, entries: GPUBindGroupEntry[]): GPUBindGroup =>
      device.createBindGroup({ layout: pipeline.getBindGroupLayout(index), entries });
    const groups = [
      bindGroup(0, uniformBuffer ? [{ binding: 0, resource: { buffer: uniformBuffer } }] : []),
      bindGroup(1, textureEntries),
      bindGroup(2, samplerEntries),
      bindGroup(3, [
        { binding: 0, resource: { buffer: inputBuffer } },
        { binding: 1, resource: { buffer: outputBuffer } },
      ]),
    ];
    const encoder = device.createCommandEncoder({ label: 'MaterialX displacement compute' });
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    groups.forEach((group, index) => pass.setBindGroup(index, group));
    pass.dispatchWorkgroups(workgroups);
    pass.end();
    encoder.copyBufferToBuffer(outputBuffer, 0, readback, 0, outputBytes);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(readback.getMappedRange().slice(0));
    readback.unmap();
    const offsets = new Float32Array(geometry.vertexCount * 3);
    for (let vertex = 0; vertex < geometry.vertexCount; vertex++) {
      for (let axis = 0; axis < 3; axis++) {
        const value = result[vertex * 4 + axis]!;
        if (!Number.isFinite(value)) throw new Error(`Non-finite displacement at ${geometry.primPath} vertex ${vertex}.`);
        offsets[vertex * 3 + axis] = value;
      }
    }
    performance.measure('displacement:compute', {
      start: computeStarted, end: performance.now(),
      detail: { vertices: geometry.vertexCount, mode: displacement.mode },
    });
    return offsets;
  } finally {
    inputBuffer?.destroy();
    outputBuffer?.destroy();
    readback?.destroy();
    uniformBuffer?.destroy();
    for (const texture of gpuTextures) texture.destroy();
  }
}

function heightAt(image: DecodedPixelImage, u: number, v: number, clamp = false): number {
  if (image.udim) {
    const tile = udimTileAt(u, v);
    const pixels = image.udim.find(layer => layer.tile === tile)?.image;
    if (!pixels) throw new Error(`Missing displacement UDIM tile at UV (${u}, ${v}).`);
    return heightAt(pixels, u - Math.floor(u), 1 - (v - Math.floor(v)), true);
  }
  const x = (u - Math.floor(u)) * image.width - 0.5;
  const y = (v - Math.floor(v)) * image.height - 0.5;
  const ix = Math.floor(x), iy = Math.floor(y);
  const texel = (px: number, py: number): number => {
    px = clamp ? Math.min(Math.max(px, 0), image.width - 1) : (px % image.width + image.width) % image.width;
    py = clamp ? Math.min(Math.max(py, 0), image.height - 1) : (py % image.height + image.height) % image.height;
    return image.data[(py * image.width + px) * 4]! / 255;
  };
  const fx = x - ix, fy = y - iy;
  return (texel(ix, iy) * (1 - fx) + texel(ix + 1, iy) * fx) * (1 - fy)
    + (texel(ix, iy + 1) * (1 - fx) + texel(ix + 1, iy + 1) * fx) * fy;
}

/** Sew positional duplicates, not UVs or shading normals: hard edges stay hard. */
export function displaceGeometry(
  geometry: GeometryResource, image: DecodedPixelImage, scale: number, id: string,
  mapping: Pick<MaterialDisplacement, 'uvScale' | 'uvOffset'> = {},
): GeometryResource {
  if (image.componentType !== 'uint8' || image.channels !== 4 || image.width < 1 || image.height < 1
      || image.data.length !== image.width * image.height * 4) {
    throw new Error('Displacement requires a nonempty RGBA8 height map.');
  }
  if (!Number.isFinite(scale)) throw new Error('Displacement scale must be finite.');
  if (scale === 0) return { ...geometry, prototypeId: id };
  const positions = geometry.streams.find(s => s.name === 'position')?.data;
  const normals = geometry.streams.find(s => s.name === 'normal')?.data;
  const uv = geometry.streams.find(s => s.name === 'uv')?.data;
  if (!positions || !normals || !uv) throw new Error(`Displacement requires positions, normals and UVs: ${geometry.primPath}`);
  const groups = new Map<string, number[]>();
  const positionKeys: string[] = [];
  for (let i = 0; i < geometry.vertexCount; i++) {
    const key = Array.from(positions.subarray(i * 3, i * 3 + 3), x => Math.round(x * 1e5)).join(',');
    positionKeys.push(key);
    const group = groups.get(key);
    if (group) group.push(i);
    else groups.set(key, [i]);
  }
  const displaced = positions.slice();
  for (const vertices of groups.values()) {
    const offset = [0, 0, 0];
    for (const i of vertices) {
      const u = uv[i * 2]! * (mapping.uvScale?.[0] ?? 1) + (mapping.uvOffset?.[0] ?? 0);
      const v = uv[i * 2 + 1]! * (mapping.uvScale?.[1] ?? 1) + (mapping.uvOffset?.[1] ?? 0);
      const height = (heightAt(image, u, v) - 0.5) * scale;
      for (let axis = 0; axis < 3; axis++) offset[axis]! += normals[i * 3 + axis]! * height / vertices.length;
    }
    const first = vertices[0]!;
    for (const i of vertices) {
      for (let axis = 0; axis < 3; axis++) displaced[i * 3 + axis] = positions[first * 3 + axis]! + offset[axis]!;
    }
  }

  return rebuildDisplacedGeometry(geometry, normals, displaced, positionKeys, id);
}

function rebuildDisplacedGeometry(
  geometry: GeometryResource, normals: Float32Array,
  displaced: Float32Array, positionKeys: readonly string[], id: string,
): GeometryResource {
  const normalKeys = positionKeys.map((key, i) =>
    `${key}|${Array.from(normals.subarray(i * 3, i * 3 + 3), x => Math.round(x * 1e5)).join(',')}`);
  const sums = new Map<string, number[]>();
  for (let t = 0; t < geometry.indices.length; t += 3) {
    const a = geometry.indices[t]!, b = geometry.indices[t + 1]!, c = geometry.indices[t + 2]!;
    const ab = [0, 1, 2].map(k => displaced[b * 3 + k]! - displaced[a * 3 + k]!);
    const ac = [0, 1, 2].map(k => displaced[c * 3 + k]! - displaced[a * 3 + k]!);
    const face = [ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!, ab[0]! * ac[1]! - ab[1]! * ac[0]!];
    for (const i of [a, b, c]) {
      const key = normalKeys[i]!;
      const sum = sums.get(key) ?? [0, 0, 0];
      for (let k = 0; k < 3; k++) sum[k]! += face[k]!;
      sums.set(key, sum);
    }
  }
  const displacedNormals = normals.slice();
  normalKeys.forEach((key, i) => {
    const sum = sums.get(key);
    if (!sum) return;
    const length = Math.hypot(...sum);
    if (length > 1e-20) displacedNormals.set(sum.map(x => x / length), i * 3);
  });
  const prepared = prepareMesh({
    points: Array.from(displaced),
    faceVertexCounts: Array(geometry.triangleCount).fill(3),
    faceVertexIndices: Array.from(geometry.indices),
    normals: { name: 'normals', interpolation: 'vertex', elementSize: 3, values: Array.from(displacedNormals) },
    primvars: geometry.streams.filter(s => !['position', 'normal', 'tangent'].includes(s.name)).map(s => ({
      name: s.name === 'uv' ? 'st' : s.name, interpolation: 'vertex', elementSize: s.components, values: Array.from(s.data),
    })),
  });
  return buildGeometry(id, geometry.primPath, { ...prepared, subsets: geometry.subsets, subdivision: geometry.subdivision });
}

function applyDisplacementOffsets(
  geometry: GeometryResource, offsets: Float32Array, id: string,
): GeometryResource {
  const positions = geometry.streams.find(stream => stream.name === 'position')?.data;
  const normals = geometry.streams.find(stream => stream.name === 'normal')?.data;
  if (!positions || !normals || offsets.length !== geometry.vertexCount * 3) {
    throw new Error(`Invalid displacement offsets for ${geometry.primPath}.`);
  }
  const positionKeys = Array.from({ length: geometry.vertexCount }, (_, i) =>
    Array.from(positions.subarray(i * 3, i * 3 + 3), x => Math.round(x * 1e5)).join(','));
  const groups = new Map<string, number[]>();
  positionKeys.forEach((key, index) => {
    const group = groups.get(key);
    if (group) group.push(index);
    else groups.set(key, [index]);
  });
  const displaced = positions.slice();
  for (const vertices of groups.values()) {
    const first = vertices[0]!;
    for (let axis = 0; axis < 3; axis++) {
      const offset = vertices.reduce((sum, index) => sum + offsets[index * 3 + axis]!, 0) / vertices.length;
      for (const index of vertices) displaced[index * 3 + axis] = positions[first * 3 + axis]! + offset;
    }
  }
  return rebuildDisplacedGeometry(geometry, normals, displaced, positionKeys, id);
}

/** Evaluate a lowered MaterialX displacement graph at every vertex on the CPU. */
export function displaceGeometryFromProgram(
  geometry: GeometryResource,
  displacement: NonNullable<MaterialDisplacement['program']>,
  samplers: Readonly<Record<string, ImageSampler>>,
  parameters: readonly { uniform?: string; value: readonly number[] }[] = [],
  id = `${geometry.prototypeId}::displacement`,
): GeometryResource {
  const positions = geometry.streams.find(stream => stream.name === 'position')?.data;
  const normals = geometry.streams.find(stream => stream.name === 'normal')?.data;
  if (!positions || !normals) throw new Error(`Displacement requires positions and normals: ${geometry.primPath}`);
  const uv = geometry.streams.find(stream => stream.name === 'uv')?.data;
  const tangentStream = geometry.streams.find(stream => stream.name === 'tangent');
  if (displacement.mode === 'vector' && !tangentStream) {
    throw new Error(`Vector displacement requires a tangent stream: ${geometry.primPath}`);
  }
  const streams = new Map(geometry.streams.map(stream => [stream.name, stream]));
  const params = Object.fromEntries(parameters.flatMap(parameter =>
    parameter.uniform ? [[parameter.uniform, parameter.value] as const] : []));
  const offsets = new Float32Array(geometry.vertexCount * 3);

  for (let i = 0; i < geometry.vertexCount; i++) {
    const point = Array.from(positions.subarray(i * 3, i * 3 + 3));
    const normal = Array.from(normals.subarray(i * 3, i * 3 + 3));
    const tangentData = tangentStream
      ? Array.from(tangentStream.data.subarray(i * tangentStream.components, (i + 1) * tangentStream.components))
      : [1, 0, 0, 1];
    const tangentValue = tangentData.slice(0, 3);
    const handedness = tangentData[3] ?? 1;
    const bitangent = [
      (normal[1]! * tangentValue[2]! - normal[2]! * tangentValue[1]!) * handedness,
      (normal[2]! * tangentValue[0]! - normal[0]! * tangentValue[2]!) * handedness,
      (normal[0]! * tangentValue[1]! - normal[1]! * tangentValue[0]!) * handedness,
    ];
    const primvars: Record<string, readonly number[]> = {};
    for (const [name, stream] of streams) {
      if (['position', 'normal', 'tangent'].includes(name)) continue;
      const value = Array.from(stream.data.subarray(i * stream.components, (i + 1) * stream.components));
      primvars[name === 'uv' ? 'st' : name] = value;
    }
    const inputs: Record<string, readonly number[]> = {
      [OBJECT_POSITION_INPUT]: point,
      [OBJECT_NORMAL_INPUT]: normal,
      [OBJECT_TANGENT_INPUT]: tangentValue,
      [OBJECT_BITANGENT_INPUT]: bitangent,
    };
    const varyings: IrEvalVaryings = {
      position: point, normal, geometricNormal: normal, tangent: tangentValue, bitangent,
      ...(uv ? { texcoord: Array.from(uv.subarray(i * 2, i * 2 + 2)) } : {}),
      inputs, primvars, params, textures: samplers,
    };
    const cache = new Map<string, readonly number[]>();
    const value = evaluateIrRef(displacement.ir, displacement.displacementRef, varyings, cache);
    const scale = evaluateIrRef(displacement.ir, displacement.scaleRef, varyings, cache)[0]!;
    if (!Number.isFinite(scale) || value.some(component => !Number.isFinite(component))) {
      throw new Error(`Non-finite displacement at ${geometry.primPath} vertex ${i}.`);
    }
    for (let axis = 0; axis < 3; axis++) {
      offsets[i * 3 + axis] = displacement.mode === 'scalar'
        ? normal[axis]! * value[0]! * scale
        : (tangentValue[axis]! * value[0]! + bitangent[axis]! * value[1]! + normal[axis]! * value[2]!) * scale;
    }
  }

  return applyDisplacementOffsets(geometry, offsets, id);
}

/** Bake once before either backend builds its buffers/BVH, isolating material instances. */
export async function applySceneDisplacement(
  resources: SceneResources, provider: PtImageProvider, device?: GPUDevice,
): Promise<SceneResources> {
  if (![...resources.materials.values()].some(material => material.displacement)) return resources;
  const geometries = new Map(resources.geometries);
  const materials = new Map(resources.materials);
  const images = new Map<string, DecodedPixelImage>();
  const programSamplers = new Map<string, Readonly<Record<string, ImageSampler>>>();
  const decode = async (file: string, kind: 'image' | 'map' = 'image'): Promise<DecodedPixelImage> => {
    let image = images.get(file);
    if (!image) {
      image = await provider.decode(file);
      if (!image) throw new Error(`Invalid displacement ${kind}: ${file}`);
      images.set(file, image);
    }
    return image;
  };
  for (const [key, material] of materials) {
    if (!material.displacement) continue;
    if (material.displacement.program) {
      const samplers: Record<string, ImageSampler> = {};
      for (const texture of material.displacement.program.ir.textures) {
        if (!texture.fileRef) throw new Error(`Displacement texture '${texture.name}' has no file.`);
        const sampler = material.displacement.program.ir.samplers.find(candidate => candidate.name === texture.name);
        samplers[texture.name] = createImageSampler(await decode(texture.fileRef), sampler);
      }
      programSamplers.set(key, samplers);
    } else {
      if (!material.displacement.file) throw new Error('Displacement has neither a graph program nor a height map.');
      await decode(material.displacement.file, 'map');
    }
    const { displacement: _displacement, ...baked } = material;
    materials.set(key, {
      ...baked,
      ...(material.surfaceModule ? { sceneShader: assembleIrForwardShader(material.surfaceModule) } : {}),
    });
  }
  const replaced = new Set<string>();
  const instances: SceneResources['instances'][number][] = [];
  for (const instance of resources.instances) {
    const displacement = instance.materialKey ? resources.materials.get(instance.materialKey)?.displacement : undefined;
    const geometry = geometries.get(instance.prototypeId);
    if (!displacement || !geometry) {
      instances.push(instance);
      continue;
    }
    replaced.add(instance.prototypeId);
    const id = `${instance.prototypeId}::displacement::${instance.materialKey}`;
    if (!geometries.has(id)) {
      if (displacement.program) {
        const parameters = resources.materials.get(instance.materialKey!)?.parameters;
        const offsets = device
          ? await computeDisplacementOffsets(device, geometry, displacement.program, parameters, images)
          : undefined;
        geometries.set(id, offsets
          ? applyDisplacementOffsets(geometry, offsets, id)
          : displaceGeometryFromProgram(geometry, displacement.program, programSamplers.get(instance.materialKey!) ?? {},
            parameters, id));
      } else {
        geometries.set(id, displaceGeometry(geometry, images.get(displacement.file!)!, displacement.scale, id, displacement));
      }
    }
    instances.push({ ...instance, prototypeId: id });
  }
  const used = new Set(instances.map(instance => instance.prototypeId));
  for (const id of replaced) if (!used.has(id)) geometries.delete(id);
  const tlas = buildTlas(instances.map(instance => {
    const geometry = geometries.get(instance.prototypeId);
    return transformBounds(geometry?.bounds ?? { min: [0, 0, 0], max: [0, 0, 0] }, instance.transform);
  }));
  return { ...resources, geometries, materials, instances, tlas };
}
