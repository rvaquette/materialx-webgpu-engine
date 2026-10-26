// Prototypes and instances (plan sections 8, 10, T020). The composed SceneAsset
// (T017) is flattened into a shared-prototype / instance list: each renderable
// gprim is a prototype, and native USD instancing (a prim with an internal
// reference to a renderable prim) produces an extra instance that SHARES the
// target prototype's geometry (plan section 10 "partager geometries, prototypes").
// Each instance carries a world transform composed from its xformOpOrder and its
// effective material binding (T018). Transforms are static (no animation).

import type { DiagnosticSink } from '../core/diagnostics.ts';
import type { SceneMaterials } from '../usd/materials.ts';
import type { SceneAsset, ScenePrim } from './types.ts';
import { isMeshPrim } from './types.ts';
import { composeXform, computeWorldTransforms, IDENTITY4, multiply4, type Mat4 } from './transforms.ts';

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

  const instances: SceneInstance[] = [];
  for (const [path, prim] of scene.prims) {
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
