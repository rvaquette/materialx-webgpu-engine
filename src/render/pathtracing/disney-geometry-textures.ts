import type { BvhNode } from '../../geometry/bvh.ts';
import { inverse4 } from '../../scene/transforms.ts';
import type { DisneyAcceleration } from './disney-acceleration.ts';

/**
 * RGBA texels for the WebGPU port of the source renderer's geometry layout.
 * A node occupies three texels: minimum, maximum, then left/right/leaf.
 * Positive leaf values identify BLAS triangle ranges; negative values identify instances.
 * The triangle texel's fourth component stores a material slot and a UV flag.
 * A negative TLAS material value indexes the instance's subset material table.
 */
export interface DisneyGeometryTextures {
  nodes: Float32Array;
  triangleIndices: Int32Array;
  subsetMaterials: Int32Array;
  vertices: Float32Array;
  normals: Float32Array;
  transforms: Float32Array;
  inverseTransforms: Float32Array;
  topLevelIndex: number;
  /** Placement of each prototype, for in-place dynamic updates (disney-dynamics.ts). */
  layout?: DisneyGeometryLayout;
}

export interface DisneyGeometryLayout {
  /** First node texel triple of each prototype's BLAS. */
  blasRoots: ReadonlyMap<string, number>;
  /** First vertex of each prototype. */
  vertexOffsets: ReadonlyMap<string, number>;
  /** Value stored in a TLAS leaf's right slot (material index or subset table reference) per instance. */
  instanceMaterialValues: readonly number[];
  /** Node slots reserved for the TLAS (2n - 1 for n instances). */
  tlasCapacity: number;
}

const MAX_EXACT_FLOAT_INDEX = 0xffffff;

/**
 * Subset maps resolve each geometry subset's material path to a Disney material
 * index for the corresponding instance. Unassigned triangles use that
 * instance's materialIndices entry. Missing or overlapping assignments fail.
 */
export function packDisneyGeometryTextures(
  acceleration: DisneyAcceleration, materialIndices: readonly number[],
  subsetMaterialIndices?: readonly ReadonlyMap<string, number>[],
): DisneyGeometryTextures {
  if (materialIndices.length !== acceleration.instances.length ||
      materialIndices.some(index => !Number.isInteger(index) || index < 0 || index > MAX_EXACT_FLOAT_INDEX)) {
    throw new Error('Disney material indices must contain one non-negative exact float index per instance.');
  }
  if (subsetMaterialIndices && subsetMaterialIndices.length !== acceleration.instances.length) {
    throw new Error('Disney subset material indices must contain one map per instance.');
  }
  const entries = [...acceleration.geometries.entries()];
  const nodeCount = entries.reduce((sum, [, entry]) => sum + entry.blas.nodes.length, 0) + acceleration.tlas.nodes.length;
  const triangleCount = entries.reduce((sum, [, entry]) => sum + entry.blas.triangleOrder.length, 0);
  const vertexCount = entries.reduce((sum, [, entry]) => sum + entry.geometry.vertexCount, 0);
  if ([nodeCount, triangleCount, vertexCount, acceleration.instances.length].some(value => value > MAX_EXACT_FLOAT_INDEX)) {
    throw new Error('Disney geometry exceeds the exact float index limit.');
  }
  const nodes = new Float32Array(nodeCount * 12);
  const triangleIndices = new Int32Array(triangleCount * 4);
  const vertices = new Float32Array(vertexCount * 4);
  const normals = new Float32Array(vertexCount * 4);
  const transforms = new Float32Array(acceleration.instances.length * 16);
  const inverseTransforms = new Float32Array(acceleration.instances.length * 16);
  const roots = new Map<string, number>();
  const subsetPaths = new Map<string, readonly string[]>();
  const writeNode = (index: number, node: BvhNode, left: number, right: number, leaf: number): void => {
    const offset = index * 12;
    nodes.set(node.min, offset);
    nodes.set(node.max, offset + 4);
    nodes.set([left, right, leaf], offset + 8);
  };
  let nodeOffset = 0;
  let triangleOffset = 0;
  let vertexOffset = 0;
  for (const [key, { geometry, blas }] of entries) {
    const slots = new Int32Array(geometry.triangleCount);
    const paths: string[] = [];
    for (const subset of geometry.subsets) {
      if (subset.material === undefined) continue;
      if (paths.length >= 0x3fffffff) throw new Error(`Too many Disney material subsets: ${key}.`);
      paths.push(subset.material);
      for (const triangle of subset.triangles) {
        if (triangle >= slots.length) throw new Error(`Invalid triangle in Disney subset ${subset.name}: ${key}.`);
        if (slots[triangle] !== 0 && slots[triangle] !== paths.length) {
          throw new Error(`Overlapping Disney material subsets at triangle ${triangle}: ${key}.`);
        }
        slots[triangle] = paths.length;
      }
    }
    subsetPaths.set(key, paths);
    const positions = geometry.streams.find(stream => stream.name === 'position');
    const normal = geometry.streams.find(stream => stream.name === 'normal');
    const uv = geometry.streams.find(stream => stream.name === 'uv');
    if (!positions || positions.components !== 3 || positions.data.length !== geometry.vertexCount * 3 ||
        !normal || normal.components !== 3 || normal.data.length !== geometry.vertexCount * 3 ||
        (uv && (uv.components !== 2 || uv.data.length !== geometry.vertexCount * 2)) ||
        normal.data.some(value => !Number.isFinite(value)) || uv?.data.some(value => !Number.isFinite(value))) {
      throw new Error(`Invalid Disney geometry attributes: ${key}.`);
    }
    roots.set(key, nodeOffset);
    for (let vertex = 0; vertex < geometry.vertexCount; vertex++) {
      vertices.set(positions.data.subarray(vertex * 3, vertex * 3 + 3), (vertexOffset + vertex) * 4);
      vertices[(vertexOffset + vertex) * 4 + 3] = uv?.data[vertex * 2] ?? 0;
      normals.set(normal.data.subarray(vertex * 3, vertex * 3 + 3), (vertexOffset + vertex) * 4);
      normals[(vertexOffset + vertex) * 4 + 3] = uv?.data[vertex * 2 + 1] ?? 0;
    }
    for (let order = 0; order < blas.triangleOrder.length; order++) {
      const triangle = blas.triangleOrder[order]!;
      for (let corner = 0; corner < 3; corner++) {
        triangleIndices[(triangleOffset + order) * 4 + corner] = vertexOffset + geometry.indices[triangle * 3 + corner]!;
      }
      triangleIndices[(triangleOffset + order) * 4 + 3] = slots[triangle]! * 2 + (uv ? 1 : 0);
    }
    blas.nodes.forEach((node, index) => {
      if (node.count) writeNode(nodeOffset + index, node, triangleOffset + node.start, node.count, 1);
      else writeNode(nodeOffset + index, node, nodeOffset + node.left, nodeOffset + node.right, 0);
    });
    nodeOffset += blas.nodes.length;
    triangleOffset += blas.triangleOrder.length;
    vertexOffset += geometry.vertexCount;
  }
  const topLevelIndex = nodeOffset;
  const materialTable: number[] = [];
  const instanceMaterialValues: number[] = [];
  acceleration.instances.forEach((instance, index) => {
    const paths = subsetPaths.get(instance.prototypeId);
    if (!paths) throw new Error(`Missing Disney geometry for instance ${instance.id}.`);
    if (paths.length === 0) {
      instanceMaterialValues.push(materialIndices[index]!);
    } else {
      const base = materialTable.length / 4;
      if (base >= MAX_EXACT_FLOAT_INDEX) throw new Error('Disney subset material table exceeds the exact float index limit.');
      instanceMaterialValues.push(-base - 1);
      materialTable.push(materialIndices[index]!, 0, 0, 0);
      for (const path of paths) {
        const material = subsetMaterialIndices?.[index]?.get(path);
        if (material === undefined || !Number.isInteger(material) || material < 0 || material > MAX_EXACT_FLOAT_INDEX) {
          throw new Error(`Missing or invalid Disney subset material ${path} for instance ${instance.id}.`);
        }
        materialTable.push(material, 0, 0, 0);
      }
    }
    const m = Array.from(instance.transform, Math.fround);
    const determinant = m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) -
      m[4]! * (m[1]! * m[10]! - m[2]! * m[9]!) + m[8]! * (m[1]! * m[6]! - m[2]! * m[5]!);
    if (!Number.isFinite(determinant) || determinant === 0) throw new Error(`Non-invertible transform for instance ${instance.id}.`);
    transforms.set(m, index * 16);
    const inverse = inverse4(m);
    if (inverse.some(value => !Number.isFinite(Math.fround(value)))) {
      throw new Error(`Inverse transform exceeds float32 range for instance ${instance.id}.`);
    }
    inverseTransforms.set(inverse, index * 16);
  });
  acceleration.tlas.nodes.forEach((node, index) => {
    if (node.count) {
      if (node.count !== 1) throw new Error('Disney TLAS leaves must contain exactly one instance.');
      const instanceIndex = acceleration.tlas.instanceOrder[node.start]!;
      const instance = acceleration.instances[instanceIndex];
      const root = instance && roots.get(instance.prototypeId);
      if (!instance || root === undefined) throw new Error('Disney TLAS refers to a missing instance or BLAS.');
      writeNode(topLevelIndex + index, node, root, instanceMaterialValues[instanceIndex]!, -instanceIndex - 1);
    } else {
      writeNode(topLevelIndex + index, node, topLevelIndex + node.left, topLevelIndex + node.right, 0);
    }
  });
  const vertexOffsets = new Map<string, number>();
  let vertexBase = 0;
  for (const [key, { geometry }] of entries) {
    vertexOffsets.set(key, vertexBase);
    vertexBase += geometry.vertexCount;
  }
  return { nodes, triangleIndices, subsetMaterials: new Int32Array(materialTable.length ? materialTable : [0, 0, 0, 0]),
    vertices, normals, transforms, inverseTransforms, topLevelIndex,
    layout: { blasRoots: roots, vertexOffsets, instanceMaterialValues, tlasCapacity: acceleration.tlas.nodes.length } };
}

export interface DisneyGpuGeometryTextures {
  nodes: GPUTexture;
  triangleIndices: GPUTexture;
  subsetMaterials: GPUTexture;
  vertices: GPUTexture;
  normals: GPUTexture;
  transforms: GPUTexture;
  inverseTransforms: GPUTexture;
  topLevelIndex: number;
  destroy(): void;
}

/** Upload packed RGBA texels without filtering or changing their integer/float representation. */
export function uploadDisneyGeometryTextures(
  device: GPUDevice, packed: DisneyGeometryTextures,
): DisneyGpuGeometryTextures {
  const created: GPUTexture[] = [];
  const upload = (label: string, values: Float32Array | Int32Array, format: GPUTextureFormat): GPUTexture => {
    if (!values.length || values.length % 4 !== 0) throw new Error(`Invalid Disney ${label} texture data.`);
    const texels = values.length / 4;
    const max = device.limits.maxTextureDimension2D;
    const width = Math.min(texels, max);
    const height = Math.ceil(texels / width);
    if (height > max) throw new Error(`Disney ${label} texture exceeds the GPU 2D texture limit.`);
    const size = width * height * 4;
    let data: Float32Array | Int32Array = values;
    if (size !== values.length) {
      data = values instanceof Float32Array ? new Float32Array(size) : new Int32Array(size);
      data.set(values);
    }
    const texture = device.createTexture({
      label: `Disney ${label}`, size: [width, height], format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    created.push(texture);
    device.queue.writeTexture({ texture }, data, { bytesPerRow: width * 16, rowsPerImage: height }, [width, height]);
    return texture;
  };
  try {
    return {
      nodes: upload('BVH', packed.nodes, 'rgba32float'),
      triangleIndices: upload('triangle indices', packed.triangleIndices, 'rgba32sint'),
      subsetMaterials: upload('subset materials', packed.subsetMaterials, 'rgba32sint'),
      vertices: upload('vertices', packed.vertices, 'rgba32float'),
      normals: upload('normals', packed.normals, 'rgba32float'),
      transforms: upload('transforms', packed.transforms, 'rgba32float'),
      inverseTransforms: upload('inverse transforms', packed.inverseTransforms, 'rgba32float'),
      topLevelIndex: packed.topLevelIndex,
      destroy: () => { for (const texture of created) texture.destroy(); },
    };
  } catch (error) {
    for (const texture of created) texture.destroy();
    throw error;
  }
}
