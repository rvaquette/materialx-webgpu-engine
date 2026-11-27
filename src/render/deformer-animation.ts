import type { DiagnosticSink } from '../core/diagnostics.ts';
import { loadNanoVdbVector, nanoVdbVectorGpuData } from '../assets/nanovdb.ts';
import type { RawMesh } from '../geometry/prepare.ts';
import { compileSerializedDeformerField } from '../materialx/deformer-field.ts';
import { DEFORMER_DEFAULTS, deformerKeyframes, validateDeformer, type Deformer, type DeformerKind } from '../scene/deformers.ts';
import { meshWithDeformedPoints } from '../scene/primitives.ts';
import type { SceneAsset } from '../scene/types.ts';
import { computeDeformerPositions, type GpuFieldProgram } from './deformer-compute.ts';
import { deformGeometry, type DeformedGeometry } from './scene-animation.ts';
import type { SceneResources } from './scene-resources.ts';
import { meshSourceFromScene } from './usd-scene-assets.ts';

interface GpuDeformation {
  path: string;
  mesh: RawMesh;
  stack: Deformer[];
  fields: Map<number, GpuFieldProgram>;
  preserveNormalSeams: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStack(text: string): {
  stack: Deformer[]; fields: Map<number, GpuFieldProgram>;
  grids: Array<{ index: number; url: string; name: string; type: string }>; unsupported: boolean;
} {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('Expected a nonempty deformer stack.');
  const fields = new Map<number, GpuFieldProgram>();
  const grids: Array<{ index: number; url: string; name: string; type: string }> = [];
  let unsupported = false;
  const stack = parsed.map((value, index) => {
    if (!isRecord(value) || typeof value.kind !== 'string' || !Object.hasOwn(DEFORMER_DEFAULTS, value.kind)) {
      throw new Error('Invalid deformer kind.');
    }
    const kind = value.kind as DeformerKind;
    const defaults = DEFORMER_DEFAULTS[kind];
    const deformer = { ...defaults, kind, ...value } as Deformer;
    validateDeformer(deformer);
    if (value.keyframes !== undefined) {
      if (!Array.isArray(value.keyframes)) throw new Error('Invalid deformer keyframes.');
      const frames = value.keyframes.map(frame => {
        if (!isRecord(frame) || !isRecord(frame.values) || typeof frame.time !== 'number') {
          throw new Error('Invalid deformer keyframe.');
        }
        return { ...frame.values, time: frame.time };
      });
      deformer.keyframes = deformerKeyframes(deformer, frames);
    }
    if (kind === 'Field') {
      const graph = value.fieldGraph;
      const grid = value.fieldGrid;
      if (grid !== undefined) {
        if (!isRecord(grid) || typeof grid.url !== 'string' || !grid.url || typeof grid.name !== 'string'
            || !grid.name || (grid.type !== 'vec3f' && grid.type !== 'vec3d')) {
          throw new Error('Invalid NanoVDB field metadata.');
        }
        grids.push({ index, url: grid.url, name: grid.name, type: grid.type });
      } else if (!isRecord(graph) || !Array.isArray(graph.nodes) || graph.nodes.some(node => !isRecord(node) || !isRecord(node.definition))) {
        unsupported = true;
      } else {
        const program = compileSerializedDeformerField(graph);
        fields.set(index, { ir: program.ir, ref: program.ref });
      }
    }
    return deformer;
  });
  return { stack, fields, grids, unsupported };
}

/** Reconstructs supported GPU stacks from the engine metadata of an exported stage. */
export async function gpuDeformations(
  scene: SceneAsset, device: GPUDevice, baseUrl: string, sink?: DiagnosticSink,
): Promise<GpuDeformation[]> {
  const result: GpuDeformation[] = [];
  const meshes = meshSourceFromScene(scene);
  const gridCache = new Map<string, Promise<Uint32Array>>();
  for (const prim of scene.prims.values()) {
    const base = prim.attributes.get('engine:deformerBasePoints')?.value;
    if (base === undefined) continue;
    const text = prim.attributes.get('engine:deformers')?.value;
    if (typeof text !== 'string' || !Array.isArray(base) || base.length === 0 || base.length % 3
        || !base.every(value => typeof value === 'number' && Number.isFinite(value))) {
      throw new Error(`${prim.path}: invalid GPU deformer metadata.`);
    }
    let parsed: ReturnType<typeof parseStack>;
    try { parsed = parseStack(text); }
    catch (error) { throw new Error(`${prim.path}: invalid deformer stack: ${error instanceof Error ? error.message : String(error)}`); }
    if (parsed.unsupported) {
      sink?.({ level: 'warning', message: `${prim.path}: this Field deformation uses baked USD samples; its GPU field data is unavailable.` });
      continue;
    }
    try {
      let gridBytes = 0;
      const limit = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize);
      for (const grid of parsed.grids) {
        const url = new URL(grid.url, baseUrl).href;
        const key = JSON.stringify([url, grid.name, grid.type]);
        let data = gridCache.get(key);
        if (!data) {
          data = (async () => {
            const loaded = await loadNanoVdbVector(url, grid.name);
            if (loaded.valueType !== grid.type) throw new Error(`Grid '${grid.name}' has type ${loaded.valueType}, expected ${grid.type}.`);
            return nanoVdbVectorGpuData(loaded, limit);
          })();
          gridCache.set(key, data);
        }
        const packed = await data;
        gridBytes += packed.byteLength;
        if (gridBytes > limit) throw new Error(`Combined NanoVDB grids require ${gridBytes} bytes, exceeding the GPU limit of ${limit} bytes.`);
        parsed.fields.set(grid.index, { grid: packed });
      }
    } catch (error) {
      sink?.({ level: 'warning', message: `${prim.path}: NanoVDB GPU field unavailable; using baked USD samples.`,
        detail: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const raw = meshes.meshFor(prim.path);
    if (!raw || raw.faceVertexCounts.some(count => count !== 3)) {
      throw new Error(`${prim.path}: GPU deformer metadata requires a triangulated mesh.`);
    }
    const normals = prim.attributes.get('engine:deformerBaseNormals')?.value;
    if (normals !== undefined && (!Array.isArray(normals) || normals.length !== base.length
        || !normals.every(value => typeof value === 'number' && Number.isFinite(value)))) {
      throw new Error(`${prim.path}: invalid GPU deformer base normals.`);
    }
    result.push({
      path: prim.path,
      mesh: {
        ...raw, points: base,
        ...(Array.isArray(normals) ? { normals: { name: 'normals', interpolation: 'vertex', elementSize: 3, values: normals } } : {}),
      },
      stack: parsed.stack,
      fields: parsed.fields,
      preserveNormalSeams: prim.attributes.get('engine:primitive')?.value === 'importedMesh',
    });
  }
  return result;
}

/** Evaluate GPU positions and reconstruct the normal/tangent streams used by both renderers. */
export async function evaluateGpuDeformations(
  device: GPUDevice, sources: readonly GpuDeformation[], resources: SceneResources, time: number,
): Promise<Map<string, DeformedGeometry>> {
  const result = new Map<string, DeformedGeometry>();
  for (const source of sources) {
    const positions = await computeDeformerPositions(device, source.mesh.points, source.stack, time, source.fields);
    const mesh = meshWithDeformedPoints(source.mesh, positions, source.preserveNormalSeams);
    for (const [id, geometry] of resources.geometries) {
      if (geometry.primPath !== source.path) continue;
      const streams = deformGeometry(geometry, mesh.points, mesh.normals);
      if (!streams) throw new Error(`${source.path}: cannot map GPU deformer results to the prepared mesh.`);
      result.set(id, streams);
    }
  }
  return result;
}
