// Prototypes and instances (plan sections 8, 10, T020). The composed SceneAsset
// (T017) is flattened into a shared-prototype / instance list: each renderable
// gprim is a prototype, and native USD instancing (a prim with an internal
// reference to a renderable prim) produces an extra instance that SHARES the
// target prototype's geometry (plan section 10 "partager geometries, prototypes").
// Each instance carries a world transform composed from its xformOpOrder and its
// effective material binding (T018). A UsdGeomPointInstancer places its
// prototypes' renderable prims once per point (positions, orientations, scales,
// protoIndices, invisibleIds); the prototypes themselves are not drawn.

import type { DiagnosticSink } from '../core/diagnostics.ts';
import type { SceneMaterials } from '../usd/materials.ts';
import type { SceneAsset, ScenePrim } from './types.ts';
import { isMeshPrim } from './types.ts';
import { composeXform, computeWorldTransforms, IDENTITY4, inverse4, multiply4, quaternion4, scaling4, translation4, type Mat4 } from './transforms.ts';

export { composeXform, multiply4, IDENTITY4 };
export type { Mat4 };

export interface Prototype {
  id: string;
  /** Prim path of the geometry source. */
  primPath: string;
}

export interface SceneInstance {
  id: string;
  prototypeId: string;
  /** Prim path that places this instance (may differ from the prototype). */
  primPath: string;
  /** World transform (column-major), composed from ancestors + xformOps. */
  transform: Mat4;
  /** Effective bound material prim path, when resolved. */
  materialPath?: string;
  /**
   * Set for prims placed by a PointInstancer (`primPath`): the point index and the
   * prim's transform relative to its prototype's parent.
   */
  instancer?: { index: number; relative: Mat4 };
}

function flatNumbers(prim: ScenePrim, name: string): number[] {
  const value = prim.attributes.get(name)?.value;
  return Array.isArray(value) ? (value as readonly unknown[]).map(Number) : [];
}

/** Per-point matrices of a PointInstancer (translate * orient * scale), by point index. */
export function pointInstancerMatrices(prim: ScenePrim): Mat4[] {
  const positions = flatNumbers(prim, 'positions');
  const orientations = flatNumbers(prim, 'orientations');
  const scales = flatNumbers(prim, 'scales');
  const count = Math.floor(positions.length / 3);
  return Array.from({ length: count }, (_, i) => {
    let m = translation4(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!);
    if (orientations.length >= (i + 1) * 4) {
      m = multiply4(m, quaternion4(orientations[i * 4]!, orientations[i * 4 + 1]!, orientations[i * 4 + 2]!, orientations[i * 4 + 3]!));
    }
    if (scales.length >= (i + 1) * 3) m = multiply4(m, scaling4(scales[i * 3]!, scales[i * 3 + 1]!, scales[i * 3 + 2]!));
    return m;
  });
}

export interface SceneInstances {
  prototypes: readonly Prototype[];
  instances: readonly SceneInstance[];
}

export interface BuildSceneInstancesOptions {
  sink?: DiagnosticSink;
  /** Resolved bindings used to attach a material to each instance. */
  materials?: SceneMaterials;
  /** Decides which prims are geometry prototypes; defaults to meshes. */
  isRenderable?: (prim: ScenePrim) => boolean;
}

function defaultIsRenderable(prim: ScenePrim): boolean {
  return isMeshPrim(prim);
}

function internalPrototypeTarget(prim: ScenePrim, isRenderable: (p: ScenePrim) => boolean, prims: ReadonlyMap<string, ScenePrim>): ScenePrim | undefined {
  for (const ref of prim.references) {
    if (ref.assetPath === undefined && ref.primPath !== undefined) {
      const target = prims.get(ref.primPath);
      if (target && isRenderable(target)) return target;
    }
  }
  return undefined;
}

export function buildSceneInstances(scene: SceneAsset, options: BuildSceneInstancesOptions = {}): SceneInstances {
  const isRenderable = options.isRenderable ?? defaultIsRenderable;
  const bindings = options.materials?.bindings;

  const world = computeWorldTransforms(scene, options.sink);

  const prototypes = new Map<string, Prototype>();
  const ensurePrototype = (primPath: string): Prototype => {
    let proto = prototypes.get(primPath);
    if (!proto) {
      proto = { id: primPath, primPath };
      prototypes.set(primPath, proto);
    }
    return proto;
  };

  // Prims under a PointInstancer's prototypes are only drawn through the instancer.
  const instancers = [...scene.prims.values()].filter(prim => prim.typeName === 'PointInstancer');
  const prototypeRoots = new Set(instancers.flatMap(prim => prim.relationships.get('prototypes')?.targets ?? []));
  const underPrototype = (path: string): boolean =>
    [...prototypeRoots].some(root => path === root || path.startsWith(`${root}/`));

  const instances: SceneInstance[] = [];
  for (const instancer of instancers) {
    const roots = instancer.relationships.get('prototypes')?.targets ?? [];
    const indices = flatNumbers(instancer, 'protoIndices');
    const hidden = new Set(flatNumbers(instancer, 'invisibleIds'));
    const ids = flatNumbers(instancer, 'ids');
    const matrices = pointInstancerMatrices(instancer);
    const base = world.get(instancer.path) ?? IDENTITY4;
    // Renderable prims of each prototype, relative to the prototype's parent.
    const members = roots.map(root => {
      const parent = root.slice(0, root.lastIndexOf('/')) || '/';
      const parentInverse = inverse4(world.get(parent) ?? IDENTITY4);
      return [...scene.prims.values()]
        .filter(prim => (prim.path === root || prim.path.startsWith(`${root}/`)) && isRenderable(prim))
        .map(prim => ({ prim, relative: multiply4(parentInverse, world.get(prim.path) ?? IDENTITY4) }));
    });
    matrices.forEach((matrix, index) => {
      if (hidden.has(ids[index] ?? index)) return;
      const prototype = members[indices[index] ?? 0];
      for (const { prim, relative } of prototype ?? []) {
        const proto = ensurePrototype(prim.path);
        const materialPath = bindings?.get(prim.path)?.materialPath;
        instances.push({
          id: `${instancer.path}[${index}]${prim.path}`, prototypeId: proto.id, primPath: instancer.path,
          transform: multiply4(base, multiply4(matrix, relative)),
          ...(materialPath !== undefined ? { materialPath } : {}),
          instancer: { index, relative },
        });
      }
    });
  }
  for (const [path, prim] of scene.prims) {
    if (underPrototype(path)) continue;
    const target = internalPrototypeTarget(prim, isRenderable, scene.prims);
    const prototypePath = target ? target.path : isRenderable(prim) ? path : undefined;
    if (prototypePath === undefined) continue;
    const proto = ensurePrototype(prototypePath);
    const materialPath = bindings?.get(path)?.materialPath ?? bindings?.get(prototypePath)?.materialPath;
    instances.push({
      id: path,
      prototypeId: proto.id,
      primPath: path,
      transform: world.get(path) ?? IDENTITY4,
      ...(materialPath !== undefined ? { materialPath } : {}),
    });
  }

  return { prototypes: [...prototypes.values()], instances };
}
