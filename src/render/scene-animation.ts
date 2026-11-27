// Scene animation: the dynamic state of a loaded scene at a USD time code. It is
// computed from the composed (time-sampled) stage and compared with what is on the
// GPU, so only instances, lights, cameras and meshes that actually change are
// updated. Point deformation keeps the prepared topology: positions come from the
// sampled USD points through each vertex's source point, and normals are
// recomputed as area-weighted point normals. Meshes whose topology attributes are
// time-sampled (or that were subdivided) are prepared again at the time code:
// an unchanged triangulation becomes a deformation, a new one is reported in
// `retopologized` so the caller rebuilds the affected render resources.
import type { DiagnosticSink } from '../core/diagnostics.ts';
import { computeTangents, prepareMesh, type PrepareMeshOptions, type PreparedMesh, type RawMesh } from '../geometry/prepare.ts';
import { evaluateSceneAt } from '../scene/time.ts';
import { computeWorldTransforms, IDENTITY4, multiply4, type Mat4 } from '../scene/transforms.ts';
import { pointInstancerMatrices } from '../scene/instances.ts';
import type { SceneAsset } from '../scene/types.ts';
import { importCameras, type SceneCamera } from '../usd/cameras.ts';
import { importLights, type SceneLight } from '../usd/lights.ts';
import type { GeometryResource, SceneResources } from './scene-resources.ts';

/** Light values that can change without reloading (the light count stays fixed). */
export type LightChanges = Partial<Pick<SceneLight, 'intensity' | 'exposure' | 'color' | 'transform' | 'filter'>>;

export interface DeformedGeometry {
  positions: Float32Array;
  normals: Float32Array;
  tangents?: Float32Array;
}

export interface SceneAnimationState {
  /** World transform of every instance, by instance id. */
  transforms: Map<string, Mat4>;
  /** Instances hidden by USD visibility (prim or ancestor `invisible`). */
  hidden: Set<string>;
  lights: SceneLight[];
  camera?: SceneCamera;
  /** Meshes whose points are time-sampled, by prototype id. */
  deformed: Map<string, DeformedGeometry>;
  /** Meshes prepared again with a different triangulation, by prototype id. */
  retopologized: Map<string, PreparedMesh>;
}

export interface AnimateSceneOptions {
  sink?: DiagnosticSink;
  /** Raw mesh of a prim in the evaluated stage (inline USD geometry). */
  meshFor?: (scene: SceneAsset, primPath: string) => RawMesh | undefined;
  /** Same preparation options as at load (subdivider...). */
  prepare?: PrepareMeshOptions;
}

/** Mesh attributes whose time samples can change the triangulation or vertex layout. */
const TOPOLOGY_ATTRIBUTES = ['faceVertexCounts', 'faceVertexIndices', 'holeIndices', 'normals', 'normals:indices',
  'primvars:st', 'primvars:st:indices', 'orientation', 'subdivisionScheme', 'curveVertexCounts', 'widths'];

function sameArray(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** True when any ancestor-or-self prim is `invisible`. */
export function isInvisible(scene: SceneAsset, path: string): boolean {
  for (let current = path; current && current !== '/'; current = current.slice(0, current.lastIndexOf('/')) || '/') {
    if (scene.prims.get(current)?.attributes.get('visibility')?.value === 'invisible') return true;
  }
  return false;
}

/** Deformed vertex streams, or undefined when the topology cannot be followed. */
export function deformGeometry(geometry: GeometryResource, points: readonly number[]): DeformedGeometry | undefined {
  const source = geometry.sourcePoints;
  if (!source || geometry.subdivision.applied || source.length !== geometry.vertexCount) return undefined;
  const pointCount = Math.floor(points.length / 3);
  if (source.some(point => point >= pointCount)) return undefined;
  const positions = new Float32Array(geometry.vertexCount * 3);
  for (let v = 0; v < geometry.vertexCount; v++) positions.set(points.slice(source[v]! * 3, source[v]! * 3 + 3), v * 3);
  const accumulated = new Float64Array(pointCount * 3);
  const { indices } = geometry;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const [a, b, c] = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
    const e1 = [0, 1, 2].map(k => positions[b * 3 + k]! - positions[a * 3 + k]!);
    const e2 = [0, 1, 2].map(k => positions[c * 3 + k]! - positions[a * 3 + k]!);
    const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    for (const vertex of [a, b, c]) for (let k = 0; k < 3; k++) accumulated[source[vertex]! * 3 + k]! += n[k]!;
  }
  const normals = new Float32Array(geometry.vertexCount * 3);
  for (let v = 0; v < geometry.vertexCount; v++) {
    const p = source[v]! * 3;
    const length = Math.hypot(accumulated[p]!, accumulated[p + 1]!, accumulated[p + 2]!);
    normals.set(length > 0 ? [accumulated[p]! / length, accumulated[p + 1]! / length, accumulated[p + 2]! / length] : [0, 0, 1], v * 3);
  }
  const uv = geometry.streams.find(stream => stream.name === 'uv');
  const tangent = geometry.streams.find(stream => stream.name === 'tangent');
  const tangents = uv && uv.components === 2 && tangent?.components === 4
    ? computeTangents(positions, normals, uv.data, geometry.indices, geometry.vertexCount) : undefined;
  return { positions, normals, ...(tangents ? { tangents } : {}) };
}

/** The animation state of `scene` (composed, with time samples) at `time`. */
export function animateScene(
  scene: SceneAsset, time: number, resources: SceneResources, options: AnimateSceneOptions = {},
): SceneAnimationState {
  const { sink } = options;
  const at = evaluateSceneAt(scene, time);
  const world = computeWorldTransforms(at, sink);
  const transforms = new Map<string, Mat4>();
  const hidden = new Set<string>();
  const instancerMatrices = new Map<string, Mat4[]>();
  for (const instance of resources.instances) {
    if (instance.instancer) {
      let matrices = instancerMatrices.get(instance.primPath);
      if (!matrices) instancerMatrices.set(instance.primPath, matrices = pointInstancerMatrices(at.prims.get(instance.primPath)!));
      const matrix = matrices[instance.instancer.index];
      transforms.set(instance.id, matrix
        ? multiply4(world.get(instance.primPath) ?? IDENTITY4, multiply4(matrix, instance.instancer.relative))
        : instance.transform);
    } else {
      transforms.set(instance.id, world.get(instance.primPath) ?? instance.transform);
    }
    if (isInvisible(at, instance.primPath)) hidden.add(instance.id);
  }
  const deformed = new Map<string, DeformedGeometry>();
  const retopologized = new Map<string, PreparedMesh>();
  for (const [id, geometry] of resources.geometries) {
    const prim = scene.prims.get(geometry.primPath);
    const pointsSampled = (prim?.attributes.get('points')?.timeSamples?.length ?? 0) > 0;
    const topologySampled = TOPOLOGY_ATTRIBUTES.some(name => (prim?.attributes.get(name)?.timeSamples?.length ?? 0) > 0);
    if (!pointsSampled && !topologySampled) continue;
    // Swept curves and points have no point-to-vertex mapping: always prepared again.
    if (!topologySampled && (prim?.typeName ?? 'Mesh') === 'Mesh') {
      const value = at.prims.get(geometry.primPath)?.attributes.get('points')?.value;
      const streams = Array.isArray(value) && value.every(v => typeof v === 'number') ? deformGeometry(geometry, value as number[]) : undefined;
      if (streams) {
        deformed.set(id, streams);
        continue;
      }
    }
    // Subdivided cages, changed point counts and sampled topology: prepare the mesh again.
    const raw = options.meshFor?.(at, geometry.primPath);
    if (!raw) {
      sink?.({ level: 'warning', message: `Time-sampled mesh ignored: ${geometry.primPath} (no inline geometry)` });
      continue;
    }
    const prepared = prepareMesh(raw, { ...options.prepare, ...(sink ? { sink } : {}) });
    const uv = geometry.streams.find(stream => stream.name === 'uv')?.data;
    if (prepared.positions.length === geometry.vertexCount * 3 && sameArray(prepared.indices, geometry.indices)
        && (uv === undefined) === (prepared.uvs === undefined) && (!uv || sameArray(uv, prepared.uvs!))) {
      deformed.set(id, {
        positions: prepared.positions, normals: prepared.normals,
        ...(prepared.tangents && geometry.streams.some(stream => stream.name === 'tangent' && stream.components === 4)
          ? { tangents: prepared.tangents } : {}),
      });
    } else {
      retopologized.set(id, prepared);
    }
  }
  const importOptions = { ...(sink ? { sink } : {}), transforms: world };
  const camera = importCameras(at, importOptions)[0];
  return { transforms, hidden, lights: importLights(at, importOptions), ...(camera ? { camera } : {}), deformed, retopologized };
}
