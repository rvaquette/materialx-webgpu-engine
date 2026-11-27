import { NOISE_PRELUDE } from '../compiler/nodes.ts';
import { OBJECT_POSITION_INPUT, vector, type IrRef, type ShaderIr } from '../compiler/ir.ts';
import { emitVaryingsStruct, lowerExprs } from '../compiler/wgsl.ts';
import { assertSceneStorageSize, withGpuValidation } from '../gpu/device.ts';
import { deformerAtTime, validateDeformer, type Deformer } from '../scene/deformers.ts';

const WORKGROUP_SIZE = 64;
const KINDS = ['Bend', 'Twist', 'Taper', 'Shear', 'Wave', 'Wind', 'Spherize', 'Lattice', 'Field'] as const;
const pipelines = new WeakMap<GPUDevice, Map<string, Promise<GPUComputePipeline>>>();

export type GpuFieldProgram = { ir: ShaderIr; ref: IrRef } | { grid: Uint32Array };

const SHADER = `
// FIELD_PRELUDE
@group(0) @binding(0) var<storage, read> source: array<vec4f>;
@group(0) @binding(1) var<storage, read> deformers: array<vec4f>;
@group(0) @binding(2) var<storage, read> offsets: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> result: array<vec4f>;
@group(0) @binding(4) var<storage, read> grids: array<u32>;

fn bernstein(count: u32, t: f32) -> array<f32, 6> {
  var weights = array<f32, 6>(1.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  for (var degree = 1u; degree < count; degree++) {
    for (var j = degree + 1u; j > 0u; j--) {
      let i = j - 1u;
      var left = 0.0;
      if (i > 0u) { left = weights[i - 1u] * t; }
      weights[i] = weights[i] * (1.0 - t) + left;
    }
  }
  return weights;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn deform(@builtin(global_invocation_id) id: vec3u) {
  _ = grids[0u];
  let vertex = id.x;
  if (vertex >= arrayLength(&source)) { return; }
  var point = source[vertex].xyz;
  let count = arrayLength(&deformers) / 6u;
  for (var i = 0u; i < count; i++) {
    let d0 = deformers[i * 6u];
    let d1 = deformers[i * 6u + 1u];
    let d2 = deformers[i * 6u + 2u];
    let d3 = deformers[i * 6u + 3u];
    let d4 = deformers[i * 6u + 4u];
    let d5 = deformers[i * 6u + 5u];
    let axis = u32(d0.x);
    let a = (axis + 1u) % 3u;
    let b = (axis + 2u) % 3u;
    let along = point[axis];
    if (along < d0.y || along > d0.z) { continue; }
    let t = (along - d0.y) / (d0.z - d0.y);
    let edge = min(along - d0.y, d0.z - along);
    var q = 1.0;
    if (d0.w > 0.0) { q = min(1.0, edge / d0.w); }
    let weight = q * q * (3.0 - 2.0 * q);
    var next = point;
    let kind = u32(d1.x);
    if (kind == 0u) {
      let angle = d1.y * 0.017453292519943295;
      if (abs(angle) > 1e-8) {
        let radius = (d0.z - d0.y) / angle;
        let theta = angle * t;
        next[axis] = d0.y + (radius + point[a]) * sin(theta);
        next[a] = (radius + point[a]) * cos(theta) - radius;
      }
    } else if (kind == 1u) {
      let angle = d1.y * 0.017453292519943295 * t;
      next[a] = point[a] * cos(angle) - point[b] * sin(angle);
      next[b] = point[a] * sin(angle) + point[b] * cos(angle);
    } else if (kind == 2u) {
      let scale = 1.0 + d1.z * t;
      next[a] = point[a] * scale;
      next[b] = point[b] * scale;
    } else if (kind == 3u) {
      next[a] = point[a] + d1.z * (along - d0.y);
    } else if (kind == 4u) {
      next[a] = point[a] + d1.w * sin(d2.x * along + d2.y);
    } else if (kind == 5u) {
      let sample = point * d2.x + d2.y * vec3f(1.0, 0.73, 0.31);
      let seed = bitcast<u32>(d5.w);
      next += t * d1.w * vec3f(mx_perlin3(sample, seed), mx_perlin3(sample, seed + 1u), mx_perlin3(sample, seed + 2u));
    } else if (kind == 6u) {
      let length = length(point);
      if (length > 1e-12) {
        next = point * (1.0 + d2.w * (d2.z / length - 1.0));
      }
    } else if (kind == 7u) {
      let coordinate = (point - d4.xyz) / (d5.xyz - d4.xyz);
      if (any(coordinate < vec3f(0.0)) || any(coordinate > vec3f(1.0)) || d3.w < 0.0) { continue; }
      let dims = vec3u(d3.xyz);
      let x = bernstein(dims.x, coordinate.x);
      let y = bernstein(dims.y, coordinate.y);
      let z = bernstein(dims.z, coordinate.z);
      let start = u32(d3.w);
      for (var k = 0u; k < dims.z; k++) {
        for (var j = 0u; j < dims.y; j++) {
          for (var n = 0u; n < dims.x; n++) {
            next += x[n] * y[j] * z[k] * offsets[start + (k * dims.y + j) * dims.x + n].xyz;
          }
        }
      }
    } else {
      for (var step = 0u; step < u32(d3.x); step++) {
        next += mx_sample_field(i, next, d3.z) * d2.w / d3.x;
      }
    }
    point = mix(point, next, weight);
  }
  result[vertex] = vec4f(point, 1.0);
}`;

function fieldShader(fields: ReadonlyMap<number, GpuFieldProgram>): string {
  const preludes = new Set([NOISE_PRELUDE]);
  const inputs = new Map([[OBJECT_POSITION_INPUT, vector(3)]]);
  const functions: string[] = [];
  const cases: string[] = [];
  let hasGrid = false;
  for (const [index, field] of fields) {
    if ('grid' in field) {
      hasGrid = true;
      cases.push(`case ${index}u: { return mx_sample_grid(bitcast<u32>(deformers[${index * 6 + 3}u].y), point); }`);
      continue;
    }
    const expression = field.ir.exprs.get(field.ref);
    if (!expression || expression.type.kind !== 'vector' || expression.type.size !== 3 || expression.type.scalar !== 'float') {
      throw new Error('GPU field output must be a vector3.');
    }
    const ir: ShaderIr = { ...field.ir, outputs: [{ name: 'field', type: expression.type, ref: field.ref }] };
    const lowered = lowerExprs(ir, '', true);
    if (lowered.textures.length || lowered.samplers.length || lowered.primvarFields.size
        || [...lowered.extraInputs.keys()].some(name => name !== OBJECT_POSITION_INPUT)
        || lowered.uniforms.some(uniform => uniform.name !== 'deformer_frame')) {
      throw new Error('GPU field has unsupported inputs.');
    }
    for (const prelude of lowered.preludes) preludes.add(prelude);
    functions.push(`fn mx_field_${index}(point: vec3f, time: f32) -> vec3f {
  var vary: MxVaryings;
  vary.position = point;
  vary.in_mx_objectPosition = point;
  let u = MxFieldTime(time);
${lowered.body.join('\n')}
  return ${field.ref};
}`);
    cases.push(`case ${index}u: { return mx_field_${index}(point, time); }`);
  }
  return `${[...preludes].join('\n')}
${emitVaryingsStruct(new Map(), inputs)}
struct MxFieldTime { deformer_frame: f32 };
${hasGrid ? GRID_SHADER : ''}
${functions.join('\n')}
fn mx_sample_field(index: u32, point: vec3f, time: f32) -> vec3f {
  switch index {
    ${cases.join('\n')}
    default: { return vec3f(0.0); }
  }
}`;
}

const GRID_SHADER = `
fn mx_grid_float(index: u32) -> f32 { return bitcast<f32>(grids[index]); }
fn mx_grid_vector(index: u32) -> vec3f {
  return vec3f(mx_grid_float(index), mx_grid_float(index + 1u), mx_grid_float(index + 2u));
}
fn mx_grid_find(base: u32, level: u32, origin: vec3i) -> u32 {
  let capacity = grids[base + level];
  let table = base + grids[base + 4u + level];
  var slot = mx_hash_cell(origin, 0u) & (capacity - 1u);
  for (var probe = 0u; probe < capacity; probe++) {
    let entry = table + slot * 4u;
    let address = grids[entry + 3u];
    if (address == 0u) { return 0u; }
    if (all(vec3u(grids[entry], grids[entry + 1u], grids[entry + 2u]) == bitcast<vec3u>(origin))) {
      return base + address;
    }
    slot = (slot + 1u) & (capacity - 1u);
  }
  return 0u;
}
fn mx_grid_value(base: u32, coord: vec3i) -> vec3f {
  for (var level = 0u; level < 4u; level++) {
    var mask = -4096;
    if (level == 0u) { mask = -8; }
    if (level == 1u) { mask = -128; }
    let node = mx_grid_find(base, level, coord & vec3i(mask));
    if (node == 0u) { continue; }
    let bits = bitcast<vec3u>(coord);
    var index = 0u;
    if (level == 0u) { index = ((bits.x & 7u) << 6u) | ((bits.y & 7u) << 3u) | (bits.z & 7u); }
    if (level == 1u) { index = (((bits.x >> 3u) & 15u) << 8u) | (((bits.y >> 3u) & 15u) << 4u) | ((bits.z >> 3u) & 15u); }
    if (level == 2u) { index = (((bits.x >> 7u) & 31u) << 10u) | (((bits.y >> 7u) & 31u) << 5u) | ((bits.z >> 7u) & 31u); }
    let value = node + index * 4u;
    if (grids[value + 3u] != 0u) { return vec3f(bitcast<f32>(grids[value + 3u] | 0x7fc00000u)); }
    return mx_grid_vector(value);
  }
  return mx_grid_vector(base + 21u);
}
fn mx_grid_trilinear(base: u32, coord: vec3f) -> vec3f {
  if (any(coord < vec3f(-2147483648.0)) || any(coord >= vec3f(2147483648.0))) {
    return mx_grid_vector(base + 21u);
  }
  let lower = floor(coord);
  let fraction = coord - lower;
  var value = vec3f(0.0);
  for (var corner = 0u; corner < 8u; corner++) {
    let offset = vec3u(corner & 1u, (corner >> 1u) & 1u, (corner >> 2u) & 1u);
    let weights = select(vec3f(1.0) - fraction, fraction, vec3<bool>(offset != vec3u(0u)));
    value += weights.x * weights.y * weights.z * mx_grid_value(base, vec3i(lower) + vec3i(offset));
  }
  return value;
}
fn mx_sample_grid(base: u32, point: vec3f) -> vec3f {
  let d = point - mx_grid_vector(base + 18u);
  let coord = vec3f(dot(mx_grid_vector(base + 9u), d), dot(mx_grid_vector(base + 12u), d), dot(mx_grid_vector(base + 15u), d));
  if (grids[base + 8u] != 3u) { return mx_grid_trilinear(base, coord); }
  return vec3f(mx_grid_trilinear(base, coord + vec3f(0.5, 0.0, 0.0)).x,
    mx_grid_trilinear(base, coord + vec3f(0.0, 0.5, 0.0)).y,
    mx_grid_trilinear(base, coord + vec3f(0.0, 0.0, 0.5)).z);
}`;

function pipelineFor(device: GPUDevice, code: string): Promise<GPUComputePipeline> {
  let cache = pipelines.get(device);
  if (!cache) { cache = new Map(); pipelines.set(device, cache); }
  let pipeline = cache.get(code);
  if (!pipeline) {
    pipeline = (async () => {
      const module = device.createShaderModule({ label: 'deformer stack', code });
      const info = await module.getCompilationInfo();
      const errors = info.messages.filter(message => message.type === 'error');
      if (errors.length) throw new Error(`Deformer compute WGSL: ${errors.map(error => error.message).join('\n')}`);
      return device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'deform' } });
    })();
    cache.set(code, pipeline);
    const saved = cache;
    void pipeline.catch(() => { saved.delete(code); });
  }
  return pipeline;
}

/** Evaluates supported stacks and supplied field programs in object space. */
export async function computeDeformerPositions(
  device: GPUDevice, points: readonly number[], stack: readonly Deformer[], time: number,
  fields: ReadonlyMap<number, GpuFieldProgram> = new Map(),
): Promise<number[]> {
  const started = performance.now();
  if (!points.length || points.length % 3 || !points.every(Number.isFinite) || !Number.isFinite(time) || !stack.length) {
    throw new RangeError('Deformer compute requires finite points, a nonempty stack and finite time.');
  }
  const evaluated = stack.map(deformer => deformerAtTime(deformer, time));
  const parameters = new Float32Array(evaluated.length * 24);
  const bits = new Uint32Array(parameters.buffer);
  const controlPoints: number[] = [];
  const gridOffsets = new Map<number, number>();
  const grids = [...fields].filter((entry): entry is [number, { grid: Uint32Array }] => 'grid' in entry[1]);
  const gridLength = grids.reduce((sum, [, field]) => sum + field.grid.length, 0);
  assertSceneStorageSize(device, Math.max(1, gridLength) * 4, 'deformer grids');
  const gridData = grids.length === 1 ? grids[0]![1].grid : new Uint32Array(Math.max(1, gridLength));
  let gridOffset = 0;
  for (const [index, field] of grids) {
    gridOffsets.set(index, gridOffset);
    if (grids.length !== 1) gridData.set(field.grid, gridOffset);
    gridOffset += field.grid.length;
  }
  for (const [i, deformer] of evaluated.entries()) {
    validateDeformer(deformer);
    const kind = KINDS.findIndex(value => value === deformer.kind);
    if (kind < 0) throw new RangeError(`Deformer compute does not support ${deformer.kind}.`);
    if (deformer.kind === 'Field' && !fields.has(i)) throw new Error(`Missing GPU field program for deformer ${i}.`);
    const offset = i * 24;
    const axis = deformer.axis === 'X' ? 0 : deformer.axis === 'Y' ? 1 : 2;
    parameters.set([axis, deformer.min, deformer.max, deformer.falloff,
      kind, deformer.angle ?? 0, deformer.factor ?? 0, deformer.amplitude ?? 0,
      deformer.frequency ?? 0, deformer.phase ?? 0, deformer.radius ?? 0, deformer.strength ?? 0], offset);
    if (deformer.kind === 'Wind') bits[offset + 23] = deformer.seed!;
    if (deformer.kind === 'Field') {
      parameters.set([deformer.steps!, 0, time, 0], offset + 12);
      bits[offset + 13] = gridOffsets.get(i) ?? 0;
    }
    if (deformer.kind === 'Lattice') {
      const values = deformer.offsets!;
      parameters.set([...deformer.dimensions!, values.length ? controlPoints.length / 4 : -1,
        ...deformer.boundsMin!, 0, ...deformer.boundsMax!, 0], offset + 12);
      for (let j = 0; j < values.length; j += 3) controlPoints.push(values[j]!, values[j + 1]!, values[j + 2]!, 0);
    }
  }
  const source = new Float32Array(points.length / 3 * 4);
  for (let i = 0; i < points.length / 3; i++) source.set(points.slice(i * 3, i * 3 + 3), i * 4);
  const controls = new Float32Array(controlPoints.length ? controlPoints : [0, 0, 0, 0]);
  for (const [bytes, role] of [[source.byteLength, 'deformer positions'], [parameters.byteLength, 'deformer stack'],
    [controls.byteLength, 'deformer control points'], [gridData.byteLength, 'deformer grids']] as const) assertSceneStorageSize(device, bytes, role);
  const workgroups = Math.ceil(source.length / 4 / WORKGROUP_SIZE);
  if (workgroups > device.limits.maxComputeWorkgroupsPerDimension) {
    throw new RangeError('Deformer compute exceeds maxComputeWorkgroupsPerDimension.');
  }
  const pipeline = await pipelineFor(device, SHADER.replace('// FIELD_PRELUDE', fieldShader(fields)));
  const buffers: GPUBuffer[] = [];
  try {
    let readback!: GPUBuffer;
    await withGpuValidation(device, () => {
      const make = (size: number, usage: GPUBufferUsageFlags): GPUBuffer => {
        const buffer = device.createBuffer({ size, usage });
        buffers.push(buffer);
        return buffer;
      };
      const input = make(source.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      const settings = make(parameters.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      const lattice = make(controls.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      const output = make(source.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
      const gridBuffer = make(gridData.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      readback = make(source.byteLength, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
      device.queue.writeBuffer(input, 0, source);
      device.queue.writeBuffer(settings, 0, parameters);
      device.queue.writeBuffer(lattice, 0, controls);
      device.queue.writeBuffer(gridBuffer, 0, gridData);
      const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: input } }, { binding: 1, resource: { buffer: settings } },
        { binding: 2, resource: { buffer: lattice } }, { binding: 3, resource: { buffer: output } },
        { binding: 4, resource: { buffer: gridBuffer } },
      ] });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(workgroups);
      pass.end();
      encoder.copyBufferToBuffer(output, 0, readback, 0, source.byteLength);
      device.queue.submit([encoder.finish()]);
    });
    await readback.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(readback.getMappedRange());
    const positions = Array.from({ length: points.length }, (_, i) => result[Math.floor(i / 3) * 4 + i % 3]!);
    readback.unmap();
    if (!positions.every(Number.isFinite)) throw new Error('Deformer compute produced non-finite positions.');
    performance.measure('deformer:compute', {
      start: started, end: performance.now(), detail: { vertices: points.length / 3, deformers: stack.length },
    });
    return positions;
  } finally {
    for (const buffer of buffers) buffer.destroy();
  }
}
