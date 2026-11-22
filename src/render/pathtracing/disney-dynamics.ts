// In-place dynamic updates for the Disney backend: the two-level layout keeps
// local-space BLASes and a TLAS over instance bounds, so moving or hiding
// instances rewrites the transforms and rebuilds the small TLAS into its reserved
// slots, and a deformed prototype refits its BLAS and rewrites its vertices. The
// shaders, textures and material records are left untouched.
import { buildTlas, refitBvh, transformAabb, type BvhNode } from '../../geometry/bvh.ts';
import { inverse4 } from '../../scene/transforms.ts';
import type { InstanceResource } from '../scene-resources.ts';
import type { DisneySceneData } from './disney-scene.ts';

export type DisneyTexelTarget = 'nodes' | 'transforms' | 'inverseTransforms' | 'vertices' | 'normals';

/** RGBA32 texels to write at a linear texel index of a packed geometry texture. */
export interface DisneyTexelWrite {
  target: DisneyTexelTarget;
  firstTexel: number;
  data: Float32Array;
}

function layoutOf(scene: DisneySceneData) {
  const layout = scene.geometry.layout;
  const acceleration = scene.acceleration;
  if (!layout || !acceleration) throw new Error('This Disney scene was prepared without a dynamic layout.');
  return { layout, acceleration };
}

function packNode(out: Float32Array, slot: number, node: BvhNode, left: number, right: number, leaf: number): void {
  const offset = slot * 12;
  out.set(node.min, offset);
  out[offset + 3] = 0;
  out.set(node.max, offset + 4);
  out[offset + 7] = 0;
  out[offset + 8] = left; out[offset + 9] = right; out[offset + 10] = leaf; out[offset + 11] = 0;
}

/**
 * Instance transforms and the TLAS over the visible instances. `instances` are
 * the current instances in the prepared order (same ids); hidden ones are left
 * out of the TLAS, so rays never visit them.
 */
export function disneyInstanceWrites(
  scene: DisneySceneData, instances: readonly InstanceResource[], hidden: ReadonlySet<string>,
): DisneyTexelWrite[] {
  const { layout, acceleration } = layoutOf(scene);
  if (instances.length !== acceleration.instances.length
      || instances.some((instance, i) => instance.id !== acceleration.instances[i]!.id)) {
    throw new Error('Disney instances changed; the scene must be prepared again.');
  }
  const transforms = new Float32Array(instances.length * 16);
  const inverses = new Float32Array(instances.length * 16);
  const visible: number[] = [];
  const bounds = [];
  for (const [index, instance] of instances.entries()) {
    const m = Array.from(instance.transform, Math.fround);
    const inverse = inverse4(m);
    if (inverse.some(value => !Number.isFinite(Math.fround(value)))) throw new Error(`Non-invertible transform for instance ${instance.id}.`);
    transforms.set(m, index * 16);
    inverses.set(inverse, index * 16);
    if (hidden.has(instance.id)) continue;
    visible.push(index);
    bounds.push(transformAabb(acceleration.geometries.get(instance.prototypeId)!.blas.bounds, instance.transform));
  }
  const nodes = new Float32Array(layout.tlasCapacity * 12);
  const base = scene.geometry.topLevelIndex;
  if (visible.length === 0) {
    // An inverted root box is never entered.
    packNode(nodes, 0, { min: [1, 1, 1], max: [-1, -1, -1], left: -1, right: -1, start: 0, count: 0 }, base, base, 0);
  } else {
    const tlas = buildTlas(bounds, { maxLeafTriangles: 1 });
    if (tlas.nodes.length > layout.tlasCapacity) throw new Error('The Disney TLAS outgrew its reserved slots.');
    tlas.nodes.forEach((node, slot) => {
      if (node.count) {
        const index = visible[tlas.instanceOrder[node.start]!]!;
        const root = layout.blasRoots.get(instances[index]!.prototypeId)!;
        packNode(nodes, slot, node, root, layout.instanceMaterialValues[index]!, -index - 1);
      } else {
        packNode(nodes, slot, node, base + node.left, base + node.right, 0);
      }
    });
  }
  return [
    { target: 'transforms', firstTexel: 0, data: transforms },
    { target: 'inverseTransforms', firstTexel: 0, data: inverses },
    // Three texels per node; a shrunken TLAS leaves unreachable slots behind.
    { target: 'nodes', firstTexel: base * 3, data: nodes },
  ];
}

/** Refit the BLAS of deformed prototypes (their geometry streams already hold the new points). */
export function disneyGeometryWrites(scene: DisneySceneData, prototypes: Iterable<string>): DisneyTexelWrite[] {
  const { layout, acceleration } = layoutOf(scene);
  const writes: DisneyTexelWrite[] = [];
  for (const key of prototypes) {
    const entry = acceleration.geometries.get(key);
    const root = layout.blasRoots.get(key);
    const vertexBase = layout.vertexOffsets.get(key);
    if (!entry || root === undefined || vertexBase === undefined) continue;
    const { geometry, blas } = entry;
    const position = geometry.streams.find(stream => stream.name === 'position')!.data;
    const normal = geometry.streams.find(stream => stream.name === 'normal')!.data;
    const uv = geometry.streams.find(stream => stream.name === 'uv')?.data;
    // Also refreshes blas.bounds, which disneyInstanceWrites reads for the TLAS.
    refitBvh(blas, position, geometry.indices);
    const vertices = new Float32Array(geometry.vertexCount * 4);
    const normals = new Float32Array(geometry.vertexCount * 4);
    for (let vertex = 0; vertex < geometry.vertexCount; vertex++) {
      vertices.set(position.subarray(vertex * 3, vertex * 3 + 3), vertex * 4);
      vertices[vertex * 4 + 3] = uv?.[vertex * 2] ?? 0;
      normals.set(normal.subarray(vertex * 3, vertex * 3 + 3), vertex * 4);
      normals[vertex * 4 + 3] = uv?.[vertex * 2 + 1] ?? 0;
    }
    // Same leaf/inner encoding as packDisneyGeometryTextures; leaf ranges are unchanged by a refit.
    const nodes = new Float32Array(blas.nodes.length * 12);
    let triangleBase = 0;
    for (const [other, value] of acceleration.geometries) {
      if (other === key) break;
      triangleBase += value.blas.triangleOrder.length;
    }
    blas.nodes.forEach((node, index) => {
      if (node.count) packNode(nodes, index, node, triangleBase + node.start, node.count, 1);
      else packNode(nodes, index, node, root + node.left, root + node.right, 0);
    });
    writes.push(
      { target: 'vertices', firstTexel: vertexBase, data: vertices },
      { target: 'normals', firstTexel: vertexBase, data: normals },
      { target: 'nodes', firstTexel: root * 3, data: nodes },
    );
  }
  return writes;
}
