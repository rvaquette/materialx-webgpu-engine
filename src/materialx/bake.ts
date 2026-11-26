import { evaluateIrRef, type IrEvalVaryings, type IrValue } from '../compiler/ir-eval.ts';
import { IrModuleBuilder } from '../compiler/ir.ts';
import { lowerValueInputsToIr } from '../compiler/surface-ir.ts';
import { prepareSurface } from '../compiler/surface-eval.ts';
import type { ResolvedGraph } from './graph.ts';
import type { ResolvedSurface } from './surface-graph.ts';
import type { PtImageProvider } from '../render/pathtracing/device-bindings.ts';
import type { MaterialResource } from '../render/scene-resources.ts';
import type { GeometryResource } from '../render/scene-resources.ts';
import { createImageSampler } from '../render/pathtracing/texture-sample.ts';
import {
  OBJECT_BITANGENT_INPUT, OBJECT_NORMAL_INPUT, OBJECT_POSITION_INPUT, OBJECT_TANGENT_INPUT,
  OBJECT_TO_WORLD_INPUT, WORLD_TO_OBJECT_INPUT,
} from '../compiler/ir.ts';
import type { NormalizedSurfaceInput } from './surface-graph.ts';
import { IDENTITY4, inverse4, transformDirection, transformPoint, type Mat4 } from '../scene/transforms.ts';
import type { RgbaCapture } from '../gpu/capture.ts';

export interface BakedMap {
  readonly channels: number;
  readonly data: Float32Array;
}

export interface BakedMaterialMaps {
  readonly width: number;
  readonly height: number;
  readonly baseColor: BakedMap;
  readonly roughness: BakedMap;
  readonly metalness: BakedMap;
  readonly normal: BakedMap;
  readonly heightMap: BakedMap;
  readonly heightRange: readonly [number, number];
}

const DEFAULT_SIZE = 1024;
const MAX_SIZE = 4096;
const MAX_PIXELS = 4_194_304;
type BakeableGraphOutputType = 'float' | 'integer' | 'boolean' | 'color3' | 'vector3';
const GRAPH_OUTPUT_TYPES: ReadonlySet<string> = new Set<BakeableGraphOutputType>([
  'float', 'integer', 'boolean', 'color3', 'vector3',
]);

export function isBakeableGraphOutputType(type: string): type is BakeableGraphOutputType {
  return GRAPH_OUTPUT_TYPES.has(type);
}

function map(channels: number, pixels: number): BakedMap {
  return { channels, data: new Float32Array(channels * pixels) };
}

async function textureSamplers(
  ir: import('../compiler/ir.ts').ShaderIr,
  provider: PtImageProvider,
): Promise<Readonly<Record<string, (u: number, v: number) => IrValue>>> {
  const result: Record<string, (u: number, v: number) => IrValue> = {};
  const decoded = new Map<string, NonNullable<Awaited<ReturnType<PtImageProvider['decode']>>>>();
  for (const expr of ir.exprs.values()) {
    if (expr.kind !== 'texture') continue;
    const texture = ir.textures.find(candidate => candidate.name === expr.texture);
    if (!texture?.fileRef) throw new Error(`Cannot bake texture '${expr.texture}': no file reference.`);
    let image = decoded.get(texture.fileRef);
    if (!image) {
      image = await provider.decode(texture.fileRef);
      if (!image) throw new Error(`Cannot bake texture '${texture.fileRef}': image could not be decoded.`);
      decoded.set(texture.fileRef, image);
    }
    const sampler = ir.samplers.find(candidate => candidate.name === expr.sampler);
    result[`${expr.texture}:${expr.sampler}`] = createImageSampler(image, sampler);
  }
  return result;
}

function inputValue(
  ir: import('../compiler/ir.ts').ShaderIr,
  inputs: ReadonlyMap<string, string>,
  name: string | undefined,
  env: IrEvalVaryings,
  fallback: readonly number[],
  cache: Map<string, IrValue>,
): IrValue {
  const ref = name === undefined ? undefined : inputs.get(name);
  return ref === undefined ? fallback : evaluateIrRef(ir, ref, env, cache);
}

function finite(value: readonly number[], name: string): number[] {
  if (value.some(component => !Number.isFinite(component))) throw new Error(`Cannot bake non-finite '${name}' value.`);
  return [...value];
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function unit(value: readonly number[], fallback: readonly number[]): number[] {
  const length = Math.hypot(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0);
  return length > 1e-20 ? [value[0]! / length, value[1]! / length, value[2]! / length] : [...fallback];
}

/**
 * Rasterizes one prepared mesh into UV space and returns interpolated object/world
 * geometry varyings for each output texel. Overlaps follow source triangle order.
 */
export function createMeshBakeSampler(
  geometry: GeometryResource,
  model: Mat4,
  width: number,
  height: number,
): (x: number, y: number) => IrEvalVaryings | undefined {
  const positions = geometry.streams.find(stream => stream.name === 'position')?.data;
  const normals = geometry.streams.find(stream => stream.name === 'normal')?.data;
  const uvs = geometry.streams.find(stream => stream.name === 'uv')?.data;
  const tangents = geometry.streams.find(stream => stream.name === 'tangent')?.data;
  if (!positions || !normals || !uvs) {
    throw new Error(`Mesh '${geometry.primPath}' requires position, normal, and UV streams for baking.`);
  }
  if (positions.length !== geometry.vertexCount * 3 || normals.length !== geometry.vertexCount * 3
      || uvs.length !== geometry.vertexCount * 2 || geometry.indices.length % 3 !== 0) {
    throw new Error(`Mesh '${geometry.primPath}' has inconsistent streams and indices.`);
  }
  const inverse = inverse4(model, true);
  const fields = new Float32Array(width * height * 15);
  const covered = new Uint8Array(width * height);
  const component = (data: Float32Array, vertex: number, axis: number) => data[vertex * 3 + axis]!;
  const transformNormal = (normal: readonly number[]) => unit([
    inverse[0]! * normal[0]! + inverse[1]! * normal[1]! + inverse[2]! * normal[2]!,
    inverse[4]! * normal[0]! + inverse[5]! * normal[1]! + inverse[6]! * normal[2]!,
    inverse[8]! * normal[0]! + inverse[9]! * normal[1]! + inverse[10]! * normal[2]!,
  ], [0, 0, 1]);

  for (let triangle = 0; triangle < geometry.indices.length; triangle += 3) {
    const ids = [
      geometry.indices[triangle]!, geometry.indices[triangle + 1]!, geometry.indices[triangle + 2]!,
    ];
    if (ids.some(id => id >= geometry.vertexCount)) throw new Error(`Mesh '${geometry.primPath}' has an out-of-range index.`);
    const uv = ids.map(id => [uvs[id * 2]!, 1 - uvs[id * 2 + 1]!] as const);
    const xy = uv.map(([u, v]) => [u * width, v * height] as const);
    const minX = Math.max(0, Math.floor(Math.min(...xy.map(point => point[0]))));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(...xy.map(point => point[0]))));
    const minY = Math.max(0, Math.floor(Math.min(...xy.map(point => point[1]))));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(...xy.map(point => point[1]))));
    const [a, b, c] = xy;
    const denominator = (b![1] - c![1]) * (a![0] - c![0]) + (c![0] - b![0]) * (a![1] - c![1]);
    if (Math.abs(denominator) < 1e-12) continue;

    const p0 = ids.map(id => [component(positions, id, 0), component(positions, id, 1), component(positions, id, 2)]);
    const n0 = ids.map(id => [component(normals, id, 0), component(normals, id, 1), component(normals, id, 2)]);
    const du1 = uv[1]![0] - uv[0]![0];
    const dv1 = uv[1]![1] - uv[0]![1];
    const du2 = uv[2]![0] - uv[0]![0];
    const dv2 = uv[2]![1] - uv[0]![1];
    const dp1 = p0[1]!.map((value, axis) => value - p0[0]![axis]!);
    const dp2 = p0[2]!.map((value, axis) => value - p0[0]![axis]!);
    const uvDet = du1 * dv2 - du2 * dv1;
    const tangentDerived = Math.abs(uvDet) > 1e-12
      ? unit(dp1.map((value, axis) => (value * dv2 - dp2[axis]! * dv1) / uvDet), [1, 0, 0])
      : [1, 0, 0];
    const bitangentDerived = Math.abs(uvDet) > 1e-12
      ? unit(dp2.map((value, axis) => (value * du1 - dp1[axis]! * du2) / uvDet), [0, 1, 0])
      : [0, 1, 0];

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const wa = ((b![1] - c![1]) * (px - c![0]) + (c![0] - b![0]) * (py - c![1])) / denominator;
        const wb = ((c![1] - a![1]) * (px - c![0]) + (a![0] - c![0]) * (py - c![1])) / denominator;
        const wc = 1 - wa - wb;
        if (wa < -1e-7 || wb < -1e-7 || wc < -1e-7) continue;
        const localPosition = p0[0]!.map((value, axis) => value * wa + p0[1]![axis]! * wb + p0[2]![axis]! * wc);
        const localNormal = unit(n0[0]!.map((value, axis) => value * wa + n0[1]![axis]! * wb + n0[2]![axis]! * wc), [0, 0, 1]);
        const localTangent = tangents
          ? unit(ids.reduce((sum, id, vertex) => sum.map((value, axis) =>
            value + tangents[id * 4 + axis]! * [wa, wb, wc][vertex]!), [0, 0, 0]), tangentDerived)
          : tangentDerived;
        const localBitangent = tangents
          ? unit([
            localNormal[1]! * localTangent[2]! - localNormal[2]! * localTangent[1]!,
            localNormal[2]! * localTangent[0]! - localNormal[0]! * localTangent[2]!,
            localNormal[0]! * localTangent[1]! - localNormal[1]! * localTangent[0]!,
          ].map(value => value * (tangents[ids[0]! * 4 + 3]! < 0 ? -1 : 1)), bitangentDerived)
          : bitangentDerived;
        const worldPosition = transformPoint(model, localPosition as [number, number, number]);
        const offset = (y * width + x) * 15;
        fields.set(localPosition, offset);
        fields.set(worldPosition, offset + 3);
        fields.set(localNormal, offset + 6);
        fields.set(localTangent, offset + 9);
        fields.set(localBitangent, offset + 12);
        covered[y * width + x] = 1;
      }
    }
  }

  return (x, y) => {
    const pixel = y * width + x;
    if (!covered[pixel]) return undefined;
    const offset = pixel * 15;
    const localPosition = [...fields.subarray(offset, offset + 3)];
    const worldPosition = [...fields.subarray(offset + 3, offset + 6)];
    const localNormal = [...fields.subarray(offset + 6, offset + 9)];
    const localTangent = [...fields.subarray(offset + 9, offset + 12)];
    const localBitangent = [...fields.subarray(offset + 12, offset + 15)];
    const normal = transformNormal(localNormal);
    const tangent = unit(transformDirection(model, localTangent as [number, number, number]), [1, 0, 0]);
    const bitangent = unit(transformDirection(model, localBitangent as [number, number, number]), [0, 1, 0]);
    const u = (x + 0.5) / width;
    const v = 1 - (y + 0.5) / height;
    return {
      position: worldPosition,
      normal,
      geometricNormal: normal,
      tangent,
      bitangent,
      texcoord: [u, v],
      inputs: {
        texcoord: [u, v],
        [OBJECT_POSITION_INPUT]: localPosition,
        [OBJECT_NORMAL_INPUT]: localNormal,
        [OBJECT_TANGENT_INPUT]: localTangent,
        [OBJECT_BITANGENT_INPUT]: localBitangent,
        [OBJECT_TO_WORLD_INPUT]: [...model],
        [WORLD_TO_OBJECT_INPUT]: [...inverse],
      },
      primvars: { st: [u, v], uv: [u, v] },
    };
  };
}

/** Evaluates a numeric graph output over a flat UV image for undistorted previews. */
export async function bakeGraphOutput(
  graph: ResolvedGraph,
  nodeId: string,
  outputName: string,
  provider: PtImageProvider,
  options: { width?: number; height?: number; check?: () => void } = {},
): Promise<RgbaCapture> {
  const node = graph.nodes.get(nodeId);
  if (!node) throw new Error(`Unknown MaterialX node "${nodeId}".`);
  const typeName = node.nodeDef?.outputs?.find(output => output.name === outputName)?.type ?? node.type;
  if (!isBakeableGraphOutputType(typeName)) {
    throw new Error(`Cannot bake MaterialX preview output type "${typeName}".`);
  }
  const width = options.width ?? 128;
  const height = options.height ?? width;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
      || width > MAX_SIZE || height > MAX_SIZE || width * height > MAX_PIXELS) {
    throw new RangeError(`Bake dimensions must be positive integers no larger than ${MAX_SIZE} (${MAX_PIXELS} pixels total).`);
  }

  const builder = new IrModuleBuilder();
  const input: NormalizedSurfaceInput = {
    name: 'preview',
    type: typeName,
    source: { kind: 'connection', nodeId, output: outputName },
  };
  const ref = lowerValueInputsToIr(graph, new Map([['preview', input]]), builder).get('preview');
  if (ref === undefined) throw new Error(`Cannot lower MaterialX output "${nodeId}.${outputName}" for preview.`);
  const ir = builder.build();
  const textures = await textureSamplers(ir, provider);
  const rgba = new Uint8Array(width * height * 4);
  const identity = IDENTITY4;
  for (let y = 0; y < height; y++) {
    options.check?.();
    if (y > 0 && y % 16 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const v = 1 - (y + 0.5) / height;
      const env: IrEvalVaryings = {
        position: [u, v, 0], normal: [0, 0, 1], geometricNormal: [0, 0, 1],
        tangent: [1, 0, 0], bitangent: [0, 1, 0], texcoord: [u, v],
        inputs: {
          texcoord: [u, v], [OBJECT_POSITION_INPUT]: [u, v, 0], [OBJECT_NORMAL_INPUT]: [0, 0, 1],
          [OBJECT_TANGENT_INPUT]: [1, 0, 0], [OBJECT_BITANGENT_INPUT]: [0, 1, 0],
          [OBJECT_TO_WORLD_INPUT]: identity, [WORLD_TO_OBJECT_INPUT]: identity,
        },
        primvars: { st: [u, v], uv: [u, v] }, textures,
      };
      const value = finite(evaluateIrRef(ir, ref, env, new Map()), `${nodeId}.${outputName}`);
      const isVector = typeName === 'vector3';
      const channels = typeName === 'color3' || isVector ? 3 : 1;
      for (let channel = 0; channel < 3; channel++) {
        const source = value[Math.min(channel, channels - 1)] ?? value[0] ?? 0;
        const visible = isVector ? source * 0.5 + 0.5 : source;
        rgba[(y * width + x) * 4 + channel] = Math.round(clamp(visible) * 255);
      }
      rgba[(y * width + x) * 4 + 3] = 255;
    }
  }
  options.check?.();
  return { width, height, rgba };
}

/** Evaluates a resolved MaterialX surface at UV pixel centers and produces linear map data. */
export async function bakeMaterialMaps(
  graph: ResolvedGraph,
  surface: ResolvedSurface,
  provider: PtImageProvider,
  options: {
    width?: number;
    height?: number;
    material?: MaterialResource;
    sampleAt?: (x: number, y: number) => IrEvalVaryings | undefined;
  } = {},
): Promise<BakedMaterialMaps> {
  const width = options.width ?? DEFAULT_SIZE;
  const height = options.height ?? width;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
      || width > MAX_SIZE || height > MAX_SIZE || width * height > MAX_PIXELS) {
    throw new RangeError(`Bake dimensions must be positive integers no larger than ${MAX_SIZE} (${MAX_PIXELS} pixels total).`);
  }

  const prepared = prepareSurface(graph, surface);
  const textures = await textureSamplers(prepared.ir, provider);
  const params = Object.fromEntries((options.material?.parameters ?? []).map(parameter => [parameter.id, parameter.value]));
  const displacement = options.material?.displacement;
  const displacementTextures = displacement?.program
    ? await textureSamplers(displacement.program.ir, provider) : {};
  const pixelCount = width * height;
  const baseColor = map(4, pixelCount);
  const roughness = map(1, pixelCount);
  const metalness = map(1, pixelCount);
  const normal = map(3, pixelCount);
  const heightMap = map(1, pixelCount);
  let heightMin = Number.POSITIVE_INFINITY;
  let heightMax = Number.NEGATIVE_INFINITY;
  const baseColorName = prepared.inputs.has('base_color') ? 'base_color' : undefined;
  const baseWeightName = ['base', 'base_weight'].find(name => prepared.inputs.has(name));
  const roughnessName = ['specular_roughness', 'roughness'].find(name => prepared.inputs.has(name));
  const metalnessName = ['metalness', 'metallic'].find(name => prepared.inputs.has(name));
  const normalName = prepared.inputs.has('normal') ? 'normal' : undefined;

  for (let y = 0; y < height; y++) {
    if (y > 0 && y % 16 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    const v = 1 - (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const env: IrEvalVaryings = options.sampleAt?.(x, y) ?? {
        position: [u, v, 0],
        normal: [0, 0, 1],
        geometricNormal: [0, 0, 1],
        tangent: [1, 0, 0],
        bitangent: [0, 1, 0],
        texcoord: [u, v],
        inputs: { texcoord: [u, v] },
        primvars: { st: [u, v], uv: [u, v] },
        params,
        textures,
      };
      const cache = new Map<string, IrValue>();
      const color = finite(inputValue(prepared.ir, prepared.inputs, baseColorName, env, [0.8, 0.8, 0.8], cache), 'base_color');
      const base = inputValue(prepared.ir, prepared.inputs, baseWeightName, env, [1], cache)[0] ?? 1;
      const rough = inputValue(prepared.ir, prepared.inputs, roughnessName, env, [0.5], cache)[0] ?? 0.5;
      const metal = inputValue(prepared.ir, prepared.inputs, metalnessName, env, [0], cache)[0] ?? 0;
      const n = finite(inputValue(prepared.ir, prepared.inputs, normalName, env, [0, 0, 1], cache), 'normal');
      const colorOffset = (y * width + x) * 4;
      const dataOffset = y * width + x;
      for (let component = 0; component < 3; component++) {
        baseColor.data[colorOffset + component] = clamp((color[component] ?? color[0] ?? 0) * base);
      }
      baseColor.data[colorOffset + 3] = 1;
      roughness.data[dataOffset] = clamp(rough);
      metalness.data[dataOffset] = clamp(metal);
      const evaluatedNormal = unit(n, [0, 0, 1]);
      const tangent = env.tangent ?? [1, 0, 0];
      const bitangent = env.bitangent ?? [0, 1, 0];
      const geometricNormal = env.normal ?? [0, 0, 1];
      const tangentNormal = [
        evaluatedNormal[0]! * tangent[0]! + evaluatedNormal[1]! * tangent[1]! + evaluatedNormal[2]! * tangent[2]!,
        evaluatedNormal[0]! * bitangent[0]! + evaluatedNormal[1]! * bitangent[1]! + evaluatedNormal[2]! * bitangent[2]!,
        evaluatedNormal[0]! * geometricNormal[0]! + evaluatedNormal[1]! * geometricNormal[1]! + evaluatedNormal[2]! * geometricNormal[2]!,
      ];
      const normalLength = Math.hypot(...tangentNormal) || 1;
      normal.data[dataOffset * 3] = clamp(tangentNormal[0]! / normalLength * 0.5 + 0.5);
      normal.data[dataOffset * 3 + 1] = clamp(tangentNormal[1]! / normalLength * 0.5 + 0.5);
      normal.data[dataOffset * 3 + 2] = clamp(tangentNormal[2]! / normalLength * 0.5 + 0.5);

      let displacementValue = 0;
      if (displacement?.program) {
        const program = displacement.program;
        const displacementEnv = { ...env, textures: displacementTextures };
        const displacementCache = new Map<string, IrValue>();
        const value = evaluateIrRef(program.ir, program.displacementRef, displacementEnv, displacementCache);
        const scale = evaluateIrRef(program.ir, program.scaleRef, displacementEnv, displacementCache)[0]!;
        displacementValue = (program.mode === 'scalar' ? value[0]! : value[2]!) * scale;
        if (!Number.isFinite(displacementValue)) throw new Error(`Cannot bake non-finite height at UV ${u}, ${v}.`);
      }
      heightMap.data[dataOffset] = displacementValue;
      heightMin = Math.min(heightMin, displacementValue);
      heightMax = Math.max(heightMax, displacementValue);
    }
  }
  return {
    width, height, baseColor, roughness, metalness, normal, heightMap,
    heightRange: [heightMin, heightMax],
  };
}
