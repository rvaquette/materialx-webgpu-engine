// Render engine backend switching (plan section 9, REQ-010, T032). Holds the
// imported SceneAsset once and lets the caller switch between the raster, path
// tracing and hybrid backends WITHOUT reimporting the scene. The shared asset
// identity is preserved across switches; only the active backend's pipelines
// are (lazily) prepared. Progressive backends (path tracing, hybrid) accumulate
// samples, so switching backends or reloading the scene resets accumulation.
// Backends prepared for a scene generation are reused on switch-back; reloading
// the scene bumps the generation and makes previously prepared backends stale.

import type { SceneAsset } from '../scene/types.ts';

export type BackendKind = 'raster' | 'pathtracing' | 'hybrid';

export interface BackendSwitch {
  backend: BackendKind;
  /** Always true: the scene is shared, never reimported on a switch. */
  reusedScene: boolean;
  /** True when the backend was already prepared for the current scene. */
  reusedPipelines: boolean;
  /** True when the backend still needs preparation before rendering. */
  needsPrepare: boolean;
}

export interface EngineSnapshot {
  hasScene: boolean;
  backend: BackendKind;
  accumulatedFrames: number;
  sceneGeneration: number;
  backendReady: boolean;
}

const BACKENDS: readonly BackendKind[] = ['raster', 'pathtracing', 'hybrid'];

export function isProgressiveBackend(kind: BackendKind): boolean {
  return kind !== 'raster';
}

export class RenderEngine {
  #scene: SceneAsset | undefined;
  #generation = 0;
  #backend: BackendKind = 'raster';
  #accumulated = 0;
  // Scene generation each backend was last prepared for; -1 = never prepared.
  #prepared: Record<BackendKind, number> = { raster: -1, pathtracing: -1, hybrid: -1 };

  get scene(): SceneAsset | undefined {
    return this.#scene;
  }

  get backend(): BackendKind {
    return this.#backend;
  }

  get accumulatedFrames(): number {
    return this.#accumulated;
  }

  get sceneGeneration(): number {
    return this.#generation;
  }

  /** Imports (or replaces) the shared scene; invalidates accumulation. */
  loadScene(asset: SceneAsset): void {
    this.#scene = asset;
    this.#generation += 1;
    this.#accumulated = 0;
  }

  /** True once the given backend is prepared for the current scene generation. */
  isBackendReady(kind: BackendKind = this.#backend): boolean {
    return this.#scene !== undefined && this.#prepared[kind] === this.#generation;
  }

  /**
   * Switches the active backend without reimporting the scene. Resets
   * accumulation when the backend actually changes; a no-op switch to the
   * current backend preserves accumulated samples.
   */
  setBackend(kind: BackendKind): BackendSwitch {
    if (!this.#scene) throw new Error('load a scene before selecting a backend');
    const reused = this.#prepared[kind] === this.#generation;
    if (kind === this.#backend) {
      return { backend: kind, reusedScene: true, reusedPipelines: reused, needsPrepare: !reused };
    }
    this.#backend = kind;
    this.#accumulated = 0;
    return { backend: kind, reusedScene: true, reusedPipelines: reused, needsPrepare: !reused };
  }

  /** Marks the backend's pipelines as built for the current scene generation. */
  prepareBackend(kind: BackendKind = this.#backend): void {
    if (!this.#scene) throw new Error('load a scene before preparing a backend');
    this.#prepared[kind] = this.#generation;
  }

  /** Advances one frame; progressive backends accumulate, raster is single-sample. */
  renderFrame(): number {
    if (!this.#scene) throw new Error('load a scene before rendering');
    if (!this.isBackendReady()) throw new Error('prepare the backend before rendering');
    this.#accumulated = isProgressiveBackend(this.#backend) ? this.#accumulated + 1 : 1;
    return this.#accumulated;
  }

  resetAccumulation(): void {
    this.#accumulated = 0;
  }

  snapshot(): EngineSnapshot {
    return {
      hasScene: this.#scene !== undefined,
      backend: this.#backend,
      accumulatedFrames: this.#accumulated,
      sceneGeneration: this.#generation,
      backendReady: this.isBackendReady(),
    };
  }

  /** Backends currently prepared for the active scene generation. */
  readyBackends(): BackendKind[] {
    return BACKENDS.filter((k) => this.isBackendReady(k));
  }
}
