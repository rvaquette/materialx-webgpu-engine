// Environment irradiance utilities. Projects an equirectangular radiance map onto
// order-2 real spherical harmonics (9 RGB coefficients, Ramamoorthi & Hanrahan
// 2001) and evaluates diffuse irradiance per normal, plus a solid-angle weighted
// average radiance used as a flat ambient term. The equirect mapping matches the
// GPU env_dir_to_uv in the path tracer: u = atan2(z,x)/2pi + 0.5, v = acos(y)/pi.

import type { HdrImage } from '../../assets/hdr.ts';
import type { Vec3 } from '../../scene/transforms.ts';

/** 9 RGB spherical-harmonic radiance coefficients, flat [c0.rgb, c1.rgb, ...]. */
export type IrradianceSH = Float32Array;

// Cosine-lobe convolution factors A_l that turn radiance SH into irradiance.
const A0 = Math.PI;
const A1 = (2 * Math.PI) / 3;
const A2 = Math.PI / 4;

// Real SH basis y_lm evaluated for a unit direction (x, y, z), l = 0..2.
function shBasis(x: number, y: number, z: number): number[] {
  return [
    0.282095, // Y00
    0.488603 * y, // Y1-1
    0.488603 * z, // Y10
    0.488603 * x, // Y11
    1.092548 * x * y, // Y2-2
    1.092548 * y * z, // Y2-1
    0.315392 * (3 * z * z - 1), // Y20
    1.092548 * x * z, // Y21
    0.546274 * (x * x - y * y), // Y22
  ];
}

interface SampleGrid {
  cols: number;
  rows: number;
  stepX: number;
  stepY: number;
}

/** Cap the projection cost on large 4k maps by striding to ~256x128 samples. */
function sampleGrid(image: HdrImage): SampleGrid {
  const cols = Math.min(image.width, 256);
  const rows = Math.min(image.height, 128);
  return { cols, rows, stepX: image.width / cols, stepY: image.height / rows };
}

function texel(image: HdrImage, px: number, py: number): Vec3 {
  const x = Math.min(image.width - 1, Math.max(0, Math.floor(px)));
  const y = Math.min(image.height - 1, Math.max(0, Math.floor(py)));
  const o = (y * image.width + x) * 3;
  return [image.data[o]!, image.data[o + 1]!, image.data[o + 2]!];
}

/** Project an equirectangular radiance map onto 9 RGB SH coefficients. */
export function projectIrradianceSH(image: HdrImage): IrradianceSH {
  const sh = new Float32Array(27);
  const { cols, rows, stepX, stepY } = sampleGrid(image);
  let wsum = 0;
  for (let j = 0; j < rows; j++) {
    const v = (j + 0.5) / rows;
    const theta = v * Math.PI;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    const weight = sinT; // dOmega ~ sinTheta (constant dTheta/dPhi folds into norm)
    for (let i = 0; i < cols; i++) {
      const u = (i + 0.5) / cols;
      const phi = (u - 0.5) * 2 * Math.PI;
      const dx = sinT * Math.cos(phi);
      const dz = sinT * Math.sin(phi);
      const dy = cosT;
      const basis = shBasis(dx, dy, dz);
      const c = texel(image, i * stepX, j * stepY);
      for (let k = 0; k < 9; k++) {
        const b = basis[k]! * weight;
        sh[k * 3] = sh[k * 3]! + c[0] * b;
        sh[k * 3 + 1] = sh[k * 3 + 1]! + c[1] * b;
        sh[k * 3 + 2] = sh[k * 3 + 2]! + c[2] * b;
      }
      wsum += weight;
    }
  }
  // Normalize to the sphere's 4pi solid angle.
  const norm = (4 * Math.PI) / wsum;
  for (let k = 0; k < 27; k++) sh[k]! *= norm;
  return sh;
}

/** Diffuse irradiance E(n) from SH radiance coefficients (cosine convolution). */
export function evalIrradianceSH(sh: IrradianceSH, n: Vec3): Vec3 {
  const [x, y, z] = n;
  const b = shBasis(x, y, z);
  const a = [A0, A1, A1, A1, A2, A2, A2, A2, A2];
  const out: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 9; k++) {
    const w = a[k]! * b[k]!;
    out[0] += sh[k * 3]! * w;
    out[1] += sh[k * 3 + 1]! * w;
    out[2] += sh[k * 3 + 2]! * w;
  }
  return [Math.max(0, out[0]), Math.max(0, out[1]), Math.max(0, out[2])];
}

/** Solid-angle weighted mean radiance of the map (flat ambient / fallback DC). */
export function averageRadiance(image: HdrImage): Vec3 {
  const { cols, rows, stepX, stepY } = sampleGrid(image);
  const acc: [number, number, number] = [0, 0, 0];
  let wsum = 0;
  for (let j = 0; j < rows; j++) {
    const theta = ((j + 0.5) / rows) * Math.PI;
    const weight = Math.sin(theta);
    for (let i = 0; i < cols; i++) {
      const c = texel(image, i * stepX, j * stepY);
      acc[0] += c[0] * weight;
      acc[1] += c[1] * weight;
      acc[2] += c[2] * weight;
      wsum += weight;
    }
  }
  return wsum > 0 ? [acc[0] / wsum, acc[1] / wsum, acc[2] / wsum] : [0, 0, 0];
}
