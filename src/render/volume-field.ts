import { evaluateVolumeIr, volumeExpressions, type VolumeMedium } from '../compiler/volume-ir.ts';
import type { ShaderIr } from '../compiler/ir.ts';
import { emitWgsl } from '../compiler/wgsl.ts';
import type { Aabb } from '../geometry/bvh.ts';
import type { Vec3 } from '../scene/transforms.ts';
import { packParameterUniforms } from './material-parameters.ts';
import { PT_MATERIAL_RECORD_FLOATS, PT_VOLUME_EMISSION_WEIGHT } from './pathtracing/material-record.ts';

export const VOLUME_GRID_SIZE = 32;
export const VOLUME_VOXEL_FLOATS = 10;
export const VOLUME_GPU_GRID_SIZE = 64;

export interface BakedVolumeGrid {
  data: Float32Array;
  size: number;
  majorant: number;
  emissionMajorant: number;
  emissionWeight: number;
  emissionCdf?: Float32Array;
  bounds: Aabb;
}

interface VolumeGridParameter {
  uniform?: string;
  value: readonly number[];
}

export interface VolumeField {
  majorant: number;
  sample(position: Vec3): VolumeMedium;
}

/** Uniform domain sampling, with power-weighted emitter selection. Null samples are not resampled. */
export function sampleVolumeEmitter(
  materials: Float32Array, data: Float32Array | undefined, origin: Vec3, rng: () => number,
) {
  let total = 0;
  for (let base = 0; base < materials.length; base += PT_MATERIAL_RECORD_FLOATS) total += materials[base + PT_VOLUME_EMISSION_WEIGHT]!;
  if (!(total > 0)) return undefined;
  let remaining = rng() * total;
  let index = 0;
  for (let base = 0; base < materials.length; base += PT_MATERIAL_RECORD_FLOATS) {
    const weight = materials[base + PT_VOLUME_EMISSION_WEIGHT]!;
    if (weight <= 0) continue;
    index = base / PT_MATERIAL_RECORD_FLOATS;
    if (remaining < weight) break;
    remaining -= weight;
  }
  const base = index * PT_MATERIAL_RECORD_FLOATS;
  const extent = [0, 1, 2].map(axis => 1 / materials[base + 46 + axis]!);
  const uv = [rng(), rng(), rng()];
  const domainVolume = extent[0]! * extent[1]! * extent[2]!;
  let spatialPdf = 1 / domainVolume;
  const size = materials[base + 41]!;
  if (size > 0) {
    if (!data) throw new Error('Volume emitter grid is missing.');
    const cells = size - 1, count = cells ** 3;
    const first = materials[base + 42]! + size ** 3 * VOLUME_VOXEL_FLOATS;
    const u = rng();
    let low = 0, high = count;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (data[first + mid]! > u) high = mid;
      else low = mid + 1;
    }
    const cell = Math.min(low, count - 1);
    const mass = data[first + cell]! - (cell === 0 ? 0 : data[first + cell - 1]!);
    uv[0] = (cell % cells + uv[0]!) / cells;
    uv[1] = (Math.floor(cell / cells) % cells + uv[1]!) / cells;
    uv[2] = (Math.floor(cell / (cells * cells)) + uv[2]!) / cells;
    spatialPdf = mass * count / domainVolume;
  }
  const position: Vec3 = [
    materials[base + 43]! + extent[0]! * uv[0]!,
    materials[base + 44]! + extent[1]! * uv[1]!,
    materials[base + 45]! + extent[2]! * uv[2]!,
  ];
  const offset = position.map((value, axis) => value - origin[axis]!);
  const distance = Math.hypot(...offset);
  if (distance <= 1e-4) return undefined;
  const direction: Vec3 = [offset[0]! / distance, offset[1]! / distance, offset[2]! / distance];
  let emission: Vec3;
  if (materials[base + 41]! > 0) {
    if (!data) throw new Error('Volume emitter grid is missing.');
    emission = sampleVolumeGrid(materials, data, index, position).emission!;
  } else {
    emission = [materials[base + 38]!, materials[base + 39]!, materials[base + 40]!];
  }
  const pdf = materials[base + PT_VOLUME_EMISSION_WEIGHT]! / total * distance ** 2 * spatialPdf;
  return { index, position, direction, distance, emission, pdf };
}

export function volumeTransmittance(field: VolumeField, origin: Vec3, direction: Vec3, distance: number, rng: () => number): Vec3 {
  if (!Number.isFinite(distance) || distance < 0) throw new Error('Volume transmittance requires a finite nonnegative segment.');
  if (!(field.majorant >= 0) || !Number.isFinite(field.majorant)) throw new Error('Invalid volume extinction majorant.');
  const weight: [number, number, number] = [1, 1, 1];
  if (field.majorant === 0) return weight;
  let t = 0;
  for (let step = 0; step < 4096; step++) {
    t += -Math.log(1 - rng()) / field.majorant;
    if (t >= distance) return weight;
    const point: Vec3 = [origin[0] + direction[0] * t, origin[1] + direction[1] * t, origin[2] + direction[2] * t];
    const medium = field.sample(point);
    for (let axis = 0; axis < 3; axis++) {
      const extinction = medium.absorption[axis]! + medium.scattering[axis]!;
      if (extinction > field.majorant * (1 + 1e-5)) throw new Error('Volume extinction exceeds its majorant.');
      weight[axis] = weight[axis]! * Math.max(0, 1 - extinction / field.majorant);
    }
    const peak = Math.max(...weight);
    if (peak < 0.1) {
      if (rng() >= peak) return [0, 0, 0];
      for (let axis = 0; axis < 3; axis++) weight[axis] = weight[axis]! / peak;
    }
  }
  throw new Error('Volume transmittance exceeded its tracking budget.');
}

/** Weighted delta tracking, including the unbiased collision estimator for EDF. */
export function sampleVolumeTransport(
  field: VolumeField, origin: Vec3, direction: Vec3, tMax: number, rng: () => number,
): { scattered: boolean; t: number; weight: Vec3; emission: Vec3; anisotropy: number } {
  let t = 0;
  const weight: [number, number, number] = [1, 1, 1];
  const emission: [number, number, number] = [0, 0, 0];
  const position = (distance: number): Vec3 => [
    origin[0] + direction[0] * distance, origin[1] + direction[1] * distance, origin[2] + direction[2] * distance,
  ];
  if (!Number.isFinite(tMax)) throw new Error('Explicit volumes require a closed finite boundary.');
  if (!(field.majorant >= 0) || !Number.isFinite(field.majorant)) throw new Error('Invalid volume majorant.');
  if (field.majorant === 0) {
    const j = field.sample(position(rng() * tMax)).emission ?? [0, 0, 0];
    return { scattered: false, t: tMax, weight, emission: [j[0]*tMax,j[1]*tMax,j[2]*tMax], anisotropy: 0 };
  }
  while (true) {
    t += -Math.log(1 - rng()) / field.majorant;
    if (t >= tMax) return { scattered: false, t: tMax, weight, emission, anisotropy: 0 };
    const m = field.sample(position(t));
    const sigmaT = m.absorption.map((v, i) => v + m.scattering[i]!);
    if (sigmaT.some(v => v > field.majorant * (1 + 1e-5))) throw new Error('Volume extinction exceeds its majorant.');
    const p = Math.max(...m.scattering) / field.majorant;
    for (let i = 0; i < 3; i++) emission[i] = emission[i]! + weight[i]! * (m.emission?.[i] ?? 0) / field.majorant;
    if (rng() < p) {
      for (let i = 0; i < 3; i++) weight[i] = weight[i]! * m.scattering[i]! / (field.majorant * p);
      return { scattered: true, t, weight, emission, anisotropy: m.anisotropy };
    }
    for (let i = 0; i < 3; i++) weight[i] = weight[i]! * Math.max(0, 1 - sigmaT[i]! / field.majorant) / (1 - p);
    if (Math.max(...weight) === 0) return { scattered: false, t: tMax, weight: [0, 0, 0], emission, anisotropy: 0 };
  }
}

/** Grid resolution for volumes reading sampled fields (NanoVDB). */
export const VOLUME_FIELD_GRID_SIZE = 64;

/**
 * World-space, trilinear grid: the majorant bounds the reconstructed field.
 * `fields` gives the named scalar fields read by `geompropvalue` at a world position.
 */
export function bakeVolumeGrid(
  ir: ShaderIr, bounds: Aabb, size = VOLUME_GRID_SIZE,
  fields?: (position: readonly number[]) => Readonly<Record<string, number>>,
) {
  const extent = validateVolumeGridDomain(bounds, size);
  const expressions = [...volumeExpressions(ir).values()];
  if (expressions.some(expr => expr.kind === 'texture')) {
    throw new Error('Volume image inputs require a 3D image sampler; only procedural spatial fields are currently supported.');
  }
  if (expressions.some(expr => (expr.kind === 'primvar' && !fields) || (expr.kind === 'input' && expr.name !== 'position'))) {
    throw new Error('Volume fields require world position or the fields of a USD Volume, not per-instance geometry attributes.');
  }
  const fieldNames = [...new Set([...expressions.values()].flatMap(expr => expr.kind === 'primvar' ? [expr.name] : []))];
  const data = new Float32Array(size ** 3 * VOLUME_VOXEL_FLOATS);
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const position = [x, y, z].map((v, i) => bounds.min[i]! + extent[i]! * v / (size - 1));
    const values = fields?.(position);
    const medium = evaluateVolumeIr(ir, {
      position, ...(values ? { primvars: Object.fromEntries(fieldNames.map(name => [name, [values[name] ?? 0]])) } : {}),
    });
    const offset = ((z * size + y) * size + x) * VOLUME_VOXEL_FLOATS;
    data.set([...medium.absorption, ...medium.scattering, medium.anisotropy, ...medium.emission ?? [0, 0, 0]], offset);
    if (Math.abs(data[offset+6]!) >= 1) throw new Error('Volume anisotropy exceeds the float32 phase-function range.');
  }
  return finishVolumeGrid(data, size, bounds, extent);
}

/** Bake procedural volume expressions with the same IR used by raster and CPU reference paths. */
export async function bakeVolumeGridGpu(
  device: GPUDevice,
  ir: ShaderIr,
  bounds: Aabb,
  parameters: readonly VolumeGridParameter[] = [],
  size = VOLUME_GPU_GRID_SIZE,
): Promise<BakedVolumeGrid | undefined> {
  const extent = validateVolumeGridDomain(bounds, size);
  const expressions = [...volumeExpressions(ir).values()];
  if (expressions.some(expr => expr.kind === 'texture' || expr.kind === 'primvar'
    || (expr.kind === 'input' && expr.name !== 'position'))) return undefined;
  const output = ir.outputs.find(candidate => candidate.name === 'volumeshader');
  const closure = output ? ir.exprs.get(output.ref) : undefined;
  if (closure?.kind !== 'closure' || closure.closure !== 'vdf') {
    throw new Error('Missing volume closure in compiled IR.');
  }
  const refs = ['absorption', 'scattering', 'anisotropy', 'emission']
    .flatMap(name => closure.params[name] ? [{ name, ref: closure.params[name]! }] : []);
  if (!closure.params.absorption || !closure.params.scattering || !closure.params.anisotropy) {
    throw new Error('Compiled volume is missing a required coefficient.');
  }
  const valueIr: ShaderIr = {
    ...ir,
    outputs: refs.map(({ name, ref }) => {
      const expression = ir.exprs.get(ref);
      if (!expression) throw new Error(`Missing compiled volume input '${name}'.`);
      return { name, type: expression.type, ref };
    }),
  };
  const module = emitWgsl(valueIr, true);
  if (module.textures.length || module.samplers.length || ir.requirements.needsDerivatives
      || ir.requirements.needsTextureFootprint) return undefined;
  const expectedTypes: Record<string, string> = {
    absorption: 'vec3f', scattering: 'vec3f', anisotropy: 'f32', emission: 'vec3f',
  };
  if (module.outputs.some(outputField => expectedTypes[outputField.name] !== outputField.wgslType)) {
    throw new Error('Compiled volume has an invalid coefficient type.');
  }

  const parameterValues = new Map(parameters.flatMap(parameter =>
    parameter.uniform ? [[parameter.uniform, parameter.value] as const] : []));
  const irParameters = new Map(ir.params.map(parameter => [parameter.name, parameter.defaultValue]));
  const uniformData = module.uniforms.length
    ? packParameterUniforms(module.uniforms, field => {
      const value = parameterValues.get(field.name) ?? irParameters.get(field.name);
      if (typeof value === 'number') return [value];
      if (typeof value === 'boolean') return [value ? 1 : 0];
      if (Array.isArray(value)) return value;
      throw new Error(`Missing volume parameter value: ${field.name}`);
    })
    : undefined;
  const voxelCount = size ** 3;
  const byteLength = voxelCount * VOLUME_VOXEL_FLOATS * Float32Array.BYTES_PER_ELEMENT;
  if (byteLength > device.limits.maxStorageBufferBindingSize || byteLength > device.limits.maxBufferSize) {
    return undefined;
  }

  const outputBinding = module.uniforms.length ? 1 : 0;
  const coefficient = (name: string, fallback: string): string => {
    const field = module.outputs.find(candidate => candidate.name === name)?.field;
    return field ? `result.${field}` : fallback;
  };
  const literal = (value: number): string => Number.isInteger(value) ? `${value}.0` : `${value}`;
  const pos = (axis: number): string =>
    `${literal(bounds.min[axis]!)} + ${literal(extent[axis]!)} * f32(coord.${'xyz'[axis]}) / ${size - 1}.0`;
  const shader = `${module.code}
@group(0) @binding(${outputBinding}) var<storage, read_write> mx_volume_data: array<f32>;
@compute @workgroup_size(64)
fn mx_bake(@builtin(global_invocation_id) global_id: vec3u) {
  let index = global_id.x;
  if (index >= ${voxelCount}u) { return; }
  let coord = vec3u(index % ${size}u, (index / ${size}u) % ${size}u, index / ${size * size}u);
  let position = vec3f(${pos(0)}, ${pos(1)}, ${pos(2)});
  var vary: MxVaryings;
  vary.position = position;
  vary.normal = vec3f(0.0);
  vary.tangent = vec3f(0.0);
  vary.bitangent = vec3f(0.0);
  vary.texcoord = vec2f(0.0);
  vary.viewDir = vec3f(0.0, 0.0, 1.0);
  vary.frontFacing = 1.0;
  let result = mx_shade(vary);
  let base = index * ${VOLUME_VOXEL_FLOATS}u;
  let absorption = ${coefficient('absorption', 'vec3f(0.0)')};
  let scattering = ${coefficient('scattering', 'vec3f(0.0)')};
  let anisotropy = ${coefficient('anisotropy', '0.0')};
  let emission = ${coefficient('emission', 'vec3f(0.0)')};
  mx_volume_data[base] = absorption.x;
  mx_volume_data[base + 1u] = absorption.y;
  mx_volume_data[base + 2u] = absorption.z;
  mx_volume_data[base + 3u] = scattering.x;
  mx_volume_data[base + 4u] = scattering.y;
  mx_volume_data[base + 5u] = scattering.z;
  mx_volume_data[base + 6u] = anisotropy;
  mx_volume_data[base + 7u] = emission.x;
  mx_volume_data[base + 8u] = emission.y;
  mx_volume_data[base + 9u] = emission.z;
}`;

  let storage: GPUBuffer | undefined;
  let readback: GPUBuffer | undefined;
  let uniform: GPUBuffer | undefined;
  let mapped = false;
  try {
    storage = device.createBuffer({
      size: byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    readback = device.createBuffer({
      size: byteLength,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    if (uniformData) uniform = device.createBuffer({
      size: uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    if (uniform && uniformData) device.queue.writeBuffer(uniform, 0, uniformData);
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: shader }), entryPoint: 'mx_bake' },
    });
    const entries: GPUBindGroupEntry[] = [{ binding: outputBinding, resource: { buffer: storage } }];
    if (uniform) entries.push({ binding: 0, resource: { buffer: uniform } });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries,
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(voxelCount / 64));
    pass.end();
    encoder.copyBufferToBuffer(storage, 0, readback, 0, byteLength);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    mapped = true;
    const data = new Float32Array(readback.getMappedRange().slice(0));
    readback.unmap();
    mapped = false;
    return finishVolumeGrid(data, size, bounds, extent);
  } finally {
    if (mapped) readback?.unmap();
    storage?.destroy();
    readback?.destroy();
    uniform?.destroy();
  }
}

function validateVolumeGridDomain(bounds: Aabb, size: number): Vec3 {
  if (!Number.isInteger(size) || size < 2) throw new Error('Volume grid resolution must be at least two.');
  const extent: Vec3 = [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ];
  if (extent.some(v => !(v > 0) || !Number.isFinite(v))) throw new Error('Volume bounds must have positive finite extent.');
  return extent;
}

function finishVolumeGrid(data: Float32Array, size: number, bounds: Aabb, extent: Vec3): BakedVolumeGrid {
  let majorant = 0;
  let emissionMajorant = 0;
  for (let offset = 0; offset < data.length; offset += VOLUME_VOXEL_FLOATS) {
    for (let i = 0; i < VOLUME_VOXEL_FLOATS; i++) {
      if (!Number.isFinite(data[offset + i]!)) throw new Error('Volume field exceeds float32 range.');
    }
    if (data[offset + 6]! <= -1 || data[offset + 6]! >= 1) {
      throw new Error('Volume anisotropy exceeds the float32 phase-function range.');
    }
    for (let i = 0; i < 3; i++) {
      if (data[offset + i]! < 0 || data[offset + 3 + i]! < 0 || data[offset + 7 + i]! < 0) {
        throw new Error('Invalid compiled volume input.');
      }
      majorant = Math.max(majorant, data[offset + i]! + data[offset + 3 + i]!);
      emissionMajorant = Math.max(emissionMajorant, data[offset + 7 + i]!);
    }
  }
  let emissionWeight = 0;
  let emissionCdf: Float32Array | undefined;
  if (emissionMajorant > 0) {
    const cells = size - 1, count = cells ** 3;
    const weights = new Float64Array(count);
    const cellVolume = extent[0]! * extent[1]! * extent[2]! / count;
    for (let z = 0; z < cells; z++) for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
      let luminance = 0;
      for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const offset = (((z + dz) * size + y + dy) * size + x + dx) * VOLUME_VOXEL_FLOATS + 7;
        luminance += data[offset]! * 0.2126 + data[offset + 1]! * 0.7152 + data[offset + 2]! * 0.0722;
      }
      const weight = luminance / 8 * cellVolume;
      weights[(z * cells + y) * cells + x] = weight;
      emissionWeight += weight;
    }
    emissionCdf = new Float32Array(count);
    let cumulative = 0;
    for (let cell = 0; cell < count; cell++) {
      // Uniform support prevents quantized CDF plateaus from dropping dim emissive cells.
      cumulative += 0.95 * weights[cell]! / emissionWeight + 0.05 / count;
      emissionCdf[cell] = cell === count - 1 ? 1 : cumulative;
      if (!(emissionCdf[cell]! > (cell === 0 ? 0 : emissionCdf[cell - 1]!))) {
        throw new Error('Volume emission CDF exceeds float32 probability precision.');
      }
    }
  }
  return {
    data, size, majorant: majorant * (1 + 1e-6), emissionMajorant, emissionWeight,
    ...(emissionCdf ? { emissionCdf } : {}),
    bounds,
  };
}

export function sampleVolumeGrid(materials: Float32Array, data: Float32Array, index: number, position: Vec3): VolumeMedium {
  const base = index * PT_MATERIAL_RECORD_FLOATS;
  const size = materials[base + 41]!;
  const first = materials[base + 42]!;
  const coord = position.map((v, i) => {
    const t = (v - materials[base + 43 + i]!) * materials[base + 46 + i]!;
    return Math.min(1, Math.max(0, t)) * (size - 1);
  });
  const lower = coord.map(Math.floor), fraction = coord.map((v, i) => v - lower[i]!);
  const value = new Array<number>(10).fill(0);
  for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const cell = [x, y, z].map((v, i) => Math.min(size - 1, lower[i]! + v));
    const weight = [x, y, z].reduce((w, v, i) => w * (v ? fraction[i]! : 1 - fraction[i]!), 1);
    const offset = first + ((cell[2]! * size + cell[1]!) * size + cell[0]!) * 10;
    for (let c = 0; c < 10; c++) value[c] = value[c]! + data[offset + c]! * weight;
  }
  return { absorption: [value[0]!, value[1]!, value[2]!], scattering: [value[3]!, value[4]!, value[5]!],
    anisotropy: value[6]!, emission: [value[7]!, value[8]!, value[9]!] };
}

/** Shared by stochastic path transport and deterministic raster marching. */
export function volumeFieldWgsl(grid: boolean): string {
  return `
struct VolumeField { absorption: vec3f, scattering: vec3f, anisotropy: f32, emission: vec3f };
${grid ? '@group(0) @binding(10) var<storage, read> volumeData: array<f32>;' : ''}
fn volume_majorant(index: u32) -> f32 {
  let b = index * ${PT_MATERIAL_RECORD_FLOATS}u;
  if (materials[b + 41u] > 0.0) { return materials[b + 49u]; }
  let t = vec3f(materials[b+30u]+materials[b+33u], materials[b+31u]+materials[b+34u], materials[b+32u]+materials[b+35u]);
  return max(t.x, max(t.y, t.z)) * 1.000001;
}
fn volume_segment_distance(index: u32, ro: vec3f, rd: vec3f, tMax: f32) -> f32 {
  let b = index * ${PT_MATERIAL_RECORD_FLOATS}u;
  var distance = tMax;
  for (var i=0u;i<3u;i++) {
    let invExtent = materials[b+46u+i];
    if (invExtent > 0.0 && abs(rd[i]) > 1e-20) {
      let lo = materials[b+43u+i];
      let hi = lo+1.0/invExtent;
      distance = min(distance,max((lo-ro[i])/rd[i],(hi-ro[i])/rd[i]));
    }
  }
  return max(0.0,distance);
}
fn volume_field(index: u32, p: vec3f) -> VolumeField {
  let b = index * ${PT_MATERIAL_RECORD_FLOATS}u;
  var m = VolumeField(vec3f(materials[b+30u],materials[b+31u],materials[b+32u]),
    vec3f(materials[b+33u],materials[b+34u],materials[b+35u]), materials[b+36u],
    vec3f(materials[b+38u],materials[b+39u],materials[b+40u]));
${grid ? `
  let size = u32(materials[b+41u]);
  if (size > 0u) {
    let lo = vec3f(materials[b+43u],materials[b+44u],materials[b+45u]);
    let inv = vec3f(materials[b+46u],materials[b+47u],materials[b+48u]);
    let coord = clamp((p-lo)*inv, vec3f(0.0), vec3f(1.0)) * f32(size-1u);
    let cell = vec3u(floor(coord)); let f = fract(coord);
    var v: array<f32,10>;
    for (var z=0u; z<2u; z++) { for(var y=0u; y<2u; y++) { for(var x=0u; x<2u; x++) {
      let c = min(cell+vec3u(x,y,z),vec3u(size-1u));
      let w = select(1.0-f.x,f.x,x==1u)*select(1.0-f.y,f.y,y==1u)*select(1.0-f.z,f.z,z==1u);
      let offset = u32(materials[b+42u])+((c.z*size+c.y)*size+c.x)*10u;
      for(var i=0u;i<10u;i++) { v[i] += volumeData[offset+i]*w; }
    } } }
    m = VolumeField(vec3f(v[0],v[1],v[2]),vec3f(v[3],v[4],v[5]),v[6],vec3f(v[7],v[8],v[9]));
  }` : ''}
  return m;
}
fn volume_phase(cosine: f32, g: f32) -> f32 {
  return (1.0-g*g)/(12.566370614359 * pow(max(1.0+g*g+2.0*g*cosine,1e-6),1.5));
}
`;
}

export const VOLUME_TRANSPORT_WGSL = `
// Transmittance along a segment inside a volume: exact for homogeneous media,
// ratio tracking against the majorant (with Russian roulette) for grids.
fn volume_transmittance(index: u32, ro: vec3f, rd: vec3f, tMax: f32, state: ptr<function,u32>) -> vec3f {
  let majorant = volume_majorant(index);
  let segment = volume_segment_distance(index,ro,rd,tMax);
  if (majorant == 0.0 || segment <= 0.0) { return vec3f(1.0); }
  if (materials[index * ${PT_MATERIAL_RECORD_FLOATS}u + 41u] <= 0.0) {
    let m = volume_field(index,ro);
    return exp(-(m.absorption+m.scattering)*segment);
  }
  var transmittance = vec3f(1.0);
  var t = 0.0;
  for (var step = 0u; step < 4096u; step++) {
    t += -log(1.0-rng_next(state))/majorant;
    if (t >= segment) { return transmittance; }
    let m = volume_field(index,ro+rd*t);
    transmittance *= max(vec3f(0.0),vec3f(1.0)-(m.absorption+m.scattering)/majorant);
    let peak = max(transmittance.x,max(transmittance.y,transmittance.z));
    if (peak < 0.1) {
      if (rng_next(state) >= peak) { return vec3f(0.0); }
      transmittance /= peak;
    }
  }
  return transmittance;
}
struct VolumePathSample { scattered: bool, t: f32, weight: vec3f, emission: vec3f, g: f32 };
fn volume_sample(index: u32, ro: vec3f, rd: vec3f, tMax: f32, state: ptr<function,u32>) -> VolumePathSample {
  let majorant = volume_majorant(index);
  let segment = volume_segment_distance(index,ro,rd,tMax);
  var result = VolumePathSample(false,segment,vec3f(1.0),vec3f(0.0),0.0);
  if (majorant == 0.0) {
    result.emission = volume_field(index,ro+rd*(rng_next(state)*segment)).emission * segment;
    return result;
  }
  var t = 0.0;
  loop {
    t += -log(1.0-rng_next(state))/majorant;
    if (t >= segment) { return result; }
    let m = volume_field(index,ro+rd*t);
    let sigmaT = m.absorption+m.scattering;
    let p = max(m.scattering.x,max(m.scattering.y,m.scattering.z))/majorant;
    result.emission += result.weight*m.emission/majorant;
    if (rng_next(state) < p) {
      result.scattered = true; result.t = t; result.g = m.anisotropy;
      result.weight *= m.scattering/(majorant*p);
      return result;
    }
    result.weight *= max(vec3f(0.0),vec3f(1.0)-sigmaT/majorant)/(1.0-p);
    if (max(result.weight.x,max(result.weight.y,result.weight.z)) == 0.0) { return result; }
  }
}
`;
