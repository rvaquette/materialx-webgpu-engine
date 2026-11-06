import { evaluateVolumeIr, volumeExpressions, type VolumeMedium } from '../compiler/volume-ir.ts';
import type { ShaderIr } from '../compiler/ir.ts';
import type { Aabb } from '../geometry/bvh.ts';
import type { Vec3 } from '../scene/transforms.ts';
import { PT_MATERIAL_RECORD_FLOATS } from './pathtracing/material-record.ts';

export const VOLUME_GRID_SIZE = 32;
export const VOLUME_VOXEL_FLOATS = 10;

export interface VolumeField {
  majorant: number;
  sample(position: Vec3): VolumeMedium;
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

/** World-space, trilinear grid: the majorant bounds the reconstructed field. */
export function bakeVolumeGrid(ir: ShaderIr, bounds: Aabb, size = VOLUME_GRID_SIZE) {
  if (!Number.isInteger(size) || size < 2) throw new Error('Volume grid resolution must be at least two.');
  const extent = bounds.max.map((v, i) => v - bounds.min[i]!);
  if (extent.some(v => !(v > 0) || !Number.isFinite(v))) throw new Error('Volume bounds must have positive finite extent.');
  const expressions = [...volumeExpressions(ir).values()];
  if (expressions.some(expr => expr.kind === 'texture')) {
    throw new Error('Volume image inputs require a 3D image sampler; only procedural spatial fields are currently supported.');
  }
  if (expressions.some(expr => expr.kind === 'primvar' || (expr.kind === 'input' && expr.name !== 'position'))) {
    throw new Error('Volume fields require world position, not per-instance geometry attributes.');
  }
  const data = new Float32Array(size ** 3 * VOLUME_VOXEL_FLOATS);
  let majorant = 0;
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const position = [x, y, z].map((v, i) => bounds.min[i]! + extent[i]! * v / (size - 1));
    const medium = evaluateVolumeIr(ir, { position });
    const offset = ((z * size + y) * size + x) * VOLUME_VOXEL_FLOATS;
    data.set([...medium.absorption, ...medium.scattering, medium.anisotropy, ...medium.emission ?? [0, 0, 0]], offset);
    if (Math.abs(data[offset+6]!) >= 1) throw new Error('Volume anisotropy exceeds the float32 phase-function range.');
    for (let i = 0; i < 3; i++) majorant = Math.max(majorant, data[offset + i]! + data[offset + 3 + i]!);
  }
  if (!data.every(Number.isFinite)) throw new Error('Volume field exceeds float32 range.');
  return { data, size, majorant: majorant * (1 + 1e-6), bounds };
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
