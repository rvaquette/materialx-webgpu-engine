// Forward+ lighting preparation (plan sections 9.1, 9.4, T023). CPU-side planning
// for the raster backend: a clustered (froxel) light grid, environment lighting
// from a dome, shadow cascade splits per light type, and radiometric
// normalization of USD lights (units, exposure, area normalization). OpenPBR
// closure evaluation itself lives in the generated WGSL; this module produces the
// data those shaders consume. No GPU work is recorded here.

import type { SceneLight } from '../../usd/lights.ts';

export interface ClusterGridConfig {
  screenWidth: number;
  screenHeight: number;
  /** Pixels per cluster tile in x and y; defaults to 64. */
  tileSize?: number;
  /** Depth slices; defaults to 24. */
  zSlices?: number;
  near: number;
  far: number;
}

export interface ClusterGrid {
  dimX: number;
  dimY: number;
  dimZ: number;
  clusterCount: number;
  tileSize: number;
  near: number;
  far: number;
  /** View-space depth boundaries, length dimZ + 1 (exponential slicing). */
  zSlices: number[];
}

export function buildClusterGrid(config: ClusterGridConfig): ClusterGrid {
  const tileSize = Math.max(1, config.tileSize ?? 64);
  const dimZ = Math.max(1, config.zSlices ?? 24);
  const dimX = Math.max(1, Math.ceil(config.screenWidth / tileSize));
  const dimY = Math.max(1, Math.ceil(config.screenHeight / tileSize));
  const near = config.near;
  const far = config.far;
  const ratio = far / near;
  const zSlices: number[] = [];
  for (let k = 0; k <= dimZ; k++) zSlices.push(near * ratio ** (k / dimZ));
  return { dimX, dimY, dimZ, clusterCount: dimX * dimY * dimZ, tileSize, near, far, zSlices };
}

/** View-space depth to z-slice index, clamped to the grid. */
export function clusterZSliceForDepth(grid: ClusterGrid, depth: number): number {
  const clamped = Math.min(Math.max(depth, grid.near), grid.far);
  const k = Math.floor(grid.dimZ * (Math.log(clamped / grid.near) / Math.log(grid.far / grid.near)));
  return Math.min(Math.max(k, 0), grid.dimZ - 1);
}

export type ClusterLightType = 'point' | 'spot' | 'directional' | 'environment';

export interface ClusterLight {
  id: string;
  type: ClusterLightType;
  /** Positive view-space depth of the light centre (point/spot). */
  viewDepth?: number;
  /** Radius of influence in view units (point/spot). */
  radius?: number;
  /** Screen-space extent in pixels [minX, minY, maxX, maxY] (point/spot). */
  screenBounds?: readonly [number, number, number, number];
}

export interface ClusterAssignment {
  /** Start of each cluster's run in `indices`, length clusterCount. */
  offsets: Int32Array;
  /** Light count per cluster, length clusterCount. */
  counts: Int32Array;
  /** Flattened light array indices grouped by cluster. */
  indices: Int32Array;
  /** Light array indices affecting every cluster (directional/environment). */
  global: Int32Array;
}

export function assignLightsToClusters(grid: ClusterGrid, lights: readonly ClusterLight[]): ClusterAssignment {
  const { dimX, dimY, clusterCount, tileSize } = grid;
  const counts = new Int32Array(clusterCount);
  const global: number[] = [];

  const clustersForLight = (light: ClusterLight): number[] => {
    if (light.type === 'directional' || light.type === 'environment') return [];
    const depth = light.viewDepth ?? grid.near;
    const radius = light.radius ?? 0;
    const zMin = clusterZSliceForDepth(grid, depth - radius);
    const zMax = clusterZSliceForDepth(grid, depth + radius);
    let txMin = 0;
    let tyMin = 0;
    let txMax = dimX - 1;
    let tyMax = dimY - 1;
    if (light.screenBounds) {
      const [minX, minY, maxX, maxY] = light.screenBounds;
      txMin = Math.min(Math.max(Math.floor(minX / tileSize), 0), dimX - 1);
      tyMin = Math.min(Math.max(Math.floor(minY / tileSize), 0), dimY - 1);
      txMax = Math.min(Math.max(Math.floor(maxX / tileSize), 0), dimX - 1);
      tyMax = Math.min(Math.max(Math.floor(maxY / tileSize), 0), dimY - 1);
    }
    const out: number[] = [];
    for (let z = zMin; z <= zMax; z++) {
      for (let y = tyMin; y <= tyMax; y++) {
        for (let x = txMin; x <= txMax; x++) out.push(x + dimX * (y + dimY * z));
      }
    }
    return out;
  };

  const perLightClusters: number[][] = [];
  lights.forEach((light, i) => {
    if (light.type === 'directional' || light.type === 'environment') {
      global.push(i);
      perLightClusters.push([]);
      return;
    }
    const clusters = clustersForLight(light);
    perLightClusters.push(clusters);
    for (const c of clusters) counts[c]! += 1;
  });

  const offsets = new Int32Array(clusterCount);
  let total = 0;
  for (let c = 0; c < clusterCount; c++) {
    offsets[c] = total;
    total += counts[c]!;
  }
  const indices = new Int32Array(total);
  const cursor = Int32Array.from(offsets);
  perLightClusters.forEach((clusters, i) => {
    for (const c of clusters) {
      indices[cursor[c]!] = i;
      cursor[c]! += 1;
    }
  });

  return { offsets, counts, indices, global: Int32Array.from(global) };
}

export interface DomeInput {
  intensity?: number;
  exposure?: number;
  color?: readonly [number, number, number];
  textureFile?: string;
}

export interface EnvironmentLighting {
  source: 'dome' | 'none';
  intensity: number;
  color: readonly [number, number, number];
  textureFile?: string;
  /** Prefiltered specular roughness mip count (diffuse irradiance implied). */
  specularMips: number;
}

export function prepareEnvironment(dome?: DomeInput, specularMips = 6): EnvironmentLighting {
  if (!dome) {
    return { source: 'none', intensity: 0, color: [0, 0, 0], specularMips };
  }
  const intensity = (dome.intensity ?? 1) * 2 ** (dome.exposure ?? 0);
  return {
    source: 'dome',
    intensity,
    color: dome.color ?? [1, 1, 1],
    ...(dome.textureFile !== undefined ? { textureFile: dome.textureFile } : {}),
    specularMips,
  };
}

/** Practical split scheme boundaries (length count + 1, from near to far). */
export function computeCascadeSplits(near: number, far: number, count: number, lambda = 0.5): number[] {
  const n = Math.max(1, count);
  const splits = [near];
  for (let i = 1; i < n; i++) {
    const uniform = near + (far - near) * (i / n);
    const log = near * (far / near) ** (i / n);
    splits.push(lambda * log + (1 - lambda) * uniform);
  }
  splits.push(far);
  return splits;
}

export interface LightRadiance {
  /** Emitted colour premultiplied by intensity, exposure and normalization. */
  color: readonly [number, number, number];
  normalized: boolean;
}

function lightArea(light: SceneLight): number {
  switch (light.type) {
    case 'rect':
      return (light.width ?? 1) * (light.height ?? 1);
    case 'disk':
      return Math.PI * (light.radius ?? 1) ** 2;
    case 'sphere':
      return light.treatAsPoint ? 0 : 4 * Math.PI * (light.radius ?? 1) ** 2;
    case 'cylinder':
      return 2 * Math.PI * (light.radius ?? 1) * (light.length ?? 1);
    default:
      return 0;
  }
}

/** Radiometric factor from USD intensity, exposure and area normalization. */
export function evaluateLightRadiance(light: SceneLight): LightRadiance {
  let factor = light.intensity * 2 ** light.exposure;
  const area = lightArea(light);
  const normalized = light.normalize && area > 0;
  if (normalized) factor /= area;
  return {
    color: [light.color[0] * factor, light.color[1] * factor, light.color[2] * factor],
    normalized,
  };
}
