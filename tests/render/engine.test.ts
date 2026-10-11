import { describe, expect, it } from 'vitest';
import type { SceneAsset } from '../../src/scene/types.ts';
import { isProgressiveBackend, RenderEngine } from '../../src/render/engine.ts';

function makeScene(entry = 'root.usda'): SceneAsset {
  return {
    entry,
    stage: { subLayers: [] },
    prims: new Map(),
    roots: [],
    materials: [],
  };
}

describe('isProgressiveBackend', () => {
  it('marks path tracing and hybrid as progressive, raster as not', () => {
    expect(isProgressiveBackend('raster')).toBe(false);
    expect(isProgressiveBackend('pathtracing')).toBe(true);
    expect(isProgressiveBackend('hybrid')).toBe(true);
  });
});

describe('RenderEngine backend switching', () => {
  it('requires a scene before selecting a backend', () => {
    const engine = new RenderEngine();
    expect(() => engine.setBackend('pathtracing')).toThrow();
  });

  it('shares the same scene asset across backend switches (no reimport)', () => {
    const engine = new RenderEngine();
    const scene = makeScene();
    engine.loadScene(scene);
    const gen = engine.sceneGeneration;
    const result = engine.setBackend('pathtracing');
    expect(result.reusedScene).toBe(true);
    expect(engine.scene).toBe(scene);
    expect(engine.sceneGeneration).toBe(gen);
  });

  it('needs preparation on first switch to a backend', () => {
    const engine = new RenderEngine();
    engine.loadScene(makeScene());
    const result = engine.setBackend('pathtracing');
    expect(result.needsPrepare).toBe(true);
    expect(result.reusedPipelines).toBe(false);
    expect(engine.isBackendReady('pathtracing')).toBe(false);
  });

  it('reuses prepared pipelines when switching back without reimport', () => {
    const engine = new RenderEngine();
    engine.loadScene(makeScene());
    engine.setBackend('pathtracing');
    engine.prepareBackend('pathtracing');
    engine.setBackend('raster');
    engine.prepareBackend('raster');
    const back = engine.setBackend('pathtracing');
    expect(back.reusedPipelines).toBe(true);
    expect(back.needsPrepare).toBe(false);
  });

  it('resets accumulation when the backend changes', () => {
    const engine = new RenderEngine();
    engine.loadScene(makeScene());
    engine.setBackend('pathtracing');
    engine.prepareBackend('pathtracing');
    engine.renderFrame();
    engine.renderFrame();
    expect(engine.accumulatedFrames).toBe(2);
    engine.setBackend('hybrid');
    expect(engine.accumulatedFrames).toBe(0);
  });

  it('keeps accumulation on a no-op switch to the current backend', () => {
    const engine = new RenderEngine();
    engine.loadScene(makeScene());
    engine.setBackend('pathtracing');
    engine.prepareBackend('pathtracing');
    engine.renderFrame();
    const same = engine.setBackend('pathtracing');
    expect(same.reusedPipelines).toBe(true);
    expect(engine.accumulatedFrames).toBe(1);
  });
});

describe('RenderEngine rendering and generations', () => {
  it('accumulates for progressive backends and stays single-sample for raster', () => {
    const engine = new RenderEngine();
    engine.loadScene(makeScene());
    engine.prepareBackend('raster');
    expect(engine.renderFrame()).toBe(1);
    expect(engine.renderFrame()).toBe(1);

    engine.setBackend('pathtracing');
    engine.prepareBackend('pathtracing');
    expect(engine.renderFrame()).toBe(1);
    expect(engine.renderFrame()).toBe(2);
  });

  it('requires preparation before rendering', () => {
    const engine = new RenderEngine();
    engine.loadScene(makeScene());
    engine.setBackend('pathtracing');
    expect(() => engine.renderFrame()).toThrow();
  });

  it('invalidates prepared backends and accumulation on scene reload', () => {
    const engine = new RenderEngine();
    engine.loadScene(makeScene('a.usda'));
    engine.prepareBackend('raster');
    engine.setBackend('pathtracing');
    engine.prepareBackend('pathtracing');
    engine.renderFrame();
    expect(engine.readyBackends().sort()).toEqual(['pathtracing', 'raster']);

    engine.loadScene(makeScene('b.usda'));
    expect(engine.accumulatedFrames).toBe(0);
    expect(engine.readyBackends()).toEqual([]);
    expect(engine.isBackendReady('pathtracing')).toBe(false);
  });

  it('reports a coherent snapshot', () => {
    const engine = new RenderEngine();
    engine.loadScene(makeScene());
    engine.setBackend('hybrid');
    engine.prepareBackend('hybrid');
    engine.renderFrame();
    const snap = engine.snapshot();
    expect(snap).toEqual({
      hasScene: true,
      backend: 'hybrid',
      accumulatedFrames: 1,
      sceneGeneration: 1,
      backendReady: true,
    });
  });
});
