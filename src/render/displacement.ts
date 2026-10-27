import type { DecodedPixelImage } from '../assets/images.ts';
import { buildTlas } from '../geometry/bvh.ts';
import { prepareMesh } from '../geometry/prepare.ts';
import { assembleIrForwardShader } from './raster/ir-forward.ts';
import { buildGeometry, transformBounds, type GeometryResource, type SceneResources, type MaterialDisplacement } from './scene-resources.ts';
import type { PtImageProvider } from './pathtracing/device-bindings.ts';

function heightAt(image: DecodedPixelImage, u: number, v: number): number {
  const x = (u - Math.floor(u)) * image.width - 0.5;
  const y = (v - Math.floor(v)) * image.height - 0.5;
  const ix = Math.floor(x), iy = Math.floor(y);
  const texel = (px: number, py: number): number => {
    px = (px % image.width + image.width) % image.width;
    py = (py % image.height + image.height) % image.height;
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

/** Bake once before either backend builds its buffers/BVH, isolating material instances. */
export async function applySceneDisplacement(resources: SceneResources, provider: PtImageProvider): Promise<SceneResources> {
  if (![...resources.materials.values()].some(material => material.displacement)) return resources;
  const geometries = new Map(resources.geometries);
  const materials = new Map(resources.materials);
  const images = new Map<string, DecodedPixelImage>();
  for (const [key, material] of materials) {
    if (!material.displacement) continue;
    const file = material.displacement.file;
    if (!images.has(file)) {
      const image = await provider.decode(file);
      if (!image) throw new Error(`Invalid displacement map: ${file}`);
      images.set(file, image);
    }
    const { displacement: _displacement, ...baked } = material;
    materials.set(key, {
      ...baked,
      ...(material.surfaceModule ? { sceneShader: assembleIrForwardShader(material.surfaceModule) } : {}),
    });
  }
  const replaced = new Set<string>();
  const instances = resources.instances.map(instance => {
    const displacement = instance.materialKey ? resources.materials.get(instance.materialKey)?.displacement : undefined;
    const geometry = geometries.get(instance.prototypeId);
    if (!displacement || !geometry) return instance;
    replaced.add(instance.prototypeId);
    const id = `${instance.prototypeId}::displacement::${instance.materialKey}`;
    if (!geometries.has(id)) geometries.set(id, displaceGeometry(geometry, images.get(displacement.file)!, displacement.scale, id, displacement));
    return { ...instance, prototypeId: id };
  });
  const used = new Set(instances.map(instance => instance.prototypeId));
  for (const id of replaced) if (!used.has(id)) geometries.delete(id);
  const tlas = buildTlas(instances.map(instance => {
    const geometry = geometries.get(instance.prototypeId);
    return transformBounds(geometry?.bounds ?? { min: [0, 0, 0], max: [0, 0, 0] }, instance.transform);
  }));
  return { ...resources, geometries, materials, instances, tlas };
}
