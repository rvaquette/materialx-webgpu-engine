import type { DecodedPixelImage } from '../assets/images.ts';
import { buildTlas } from '../geometry/bvh.ts';
import { prepareMesh } from '../geometry/prepare.ts';
import { assembleIrForwardShader } from './raster/ir-forward.ts';
import { buildGeometry, transformBounds, type GeometryResource, type SceneResources, type MaterialDisplacement } from './scene-resources.ts';
import type { PtImageProvider } from './pathtracing/device-bindings.ts';
import { udimTileAt } from '../assets/udim.ts';
import { evaluateIrRef, type IrEvalVaryings } from '../compiler/ir-eval.ts';
import { OBJECT_BITANGENT_INPUT, OBJECT_NORMAL_INPUT, OBJECT_POSITION_INPUT, OBJECT_TANGENT_INPUT } from '../compiler/ir.ts';
import { createImageSampler, type ImageSampler } from './pathtracing/texture-sample.ts';

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
  const positionKeys = Array.from({ length: geometry.vertexCount }, (_, i) =>
    Array.from(positions.subarray(i * 3, i * 3 + 3), x => Math.round(x * 1e5)).join(','));
  const offsets = Array.from({ length: geometry.vertexCount }, () => [0, 0, 0]);

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
      offsets[i]![axis] = displacement.mode === 'scalar'
        ? normal[axis]! * value[0]! * scale
        : (tangentValue[axis]! * value[0]! + bitangent[axis]! * value[1]! + normal[axis]! * value[2]!) * scale;
    }
  }

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
      const offset = vertices.reduce((sum, index) => sum + offsets[index]![axis]!, 0) / vertices.length;
      for (const index of vertices) displaced[index * 3 + axis] = positions[first * 3 + axis]! + offset;
    }
  }
  return rebuildDisplacedGeometry(geometry, normals, displaced, positionKeys, id);
}

/** Bake once before either backend builds its buffers/BVH, isolating material instances. */
export async function applySceneDisplacement(resources: SceneResources, provider: PtImageProvider): Promise<SceneResources> {
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
  const instances = resources.instances.map(instance => {
    const displacement = instance.materialKey ? resources.materials.get(instance.materialKey)?.displacement : undefined;
    const geometry = geometries.get(instance.prototypeId);
    if (!displacement || !geometry) return instance;
    replaced.add(instance.prototypeId);
    const id = `${instance.prototypeId}::displacement::${instance.materialKey}`;
    if (!geometries.has(id)) {
      geometries.set(id, displacement.program
        ? displaceGeometryFromProgram(geometry, displacement.program, programSamplers.get(instance.materialKey!) ?? {},
          resources.materials.get(instance.materialKey!)?.parameters, id)
        : displaceGeometry(geometry, images.get(displacement.file!)!, displacement.scale, id, displacement));
    }
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
