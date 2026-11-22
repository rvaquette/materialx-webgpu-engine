// Diagnosis only (deleted before commit): dynamic-scene reliquats in headless Chrome.
import { MaterialXEngine, type EngineCapture } from '../src/engine.ts';

async function png({ width, height, rgba }: EngineCapture): Promise<string> {
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]!;

export async function checkMaterials(scene: string, size = 256): Promise<Record<string, unknown>> {
  const diagnostics: string[] = [];
  const engine = await MaterialXEngine.createHeadless({
    width: size, height: size, onDiagnostic: d => { if (d.level !== 'info') diagnostics.push(`${d.level}: ${d.message}`); },
  });
  const images: Record<string, string> = {};
  try {
    await engine.loadUsd(new URL(scene, document.baseURI));
    for (const time of [0, 12, 48]) {
      await engine.setTime(time);
      images[`raster-${time}`] = await png(await engine.capture());
      images[`pt-${time}`] = await png(await engine.capture({ backend: 'pathtracing', samples: 32 }));
    }
    const frames: number[] = [];
    for (let frame = 0; frame < 12; frame++) {
      const start = performance.now();
      await engine.setTime(frame * 4 + 1);
      await engine.capture({ backend: 'pathtracing', samples: 1 });
      frames.push(performance.now() - start);
    }
    return { pathTraceFrameMs: median(frames), images, diagnostics: [...new Set(diagnostics)] };
  } finally {
    engine.dispose();
  }
}

/** Moves one object far away step by step: refit cost, rebuild and frame time. */
export async function checkRebuild(scene: string, size = 128): Promise<Record<string, unknown>> {
  const engine = await MaterialXEngine.createHeadless({ width: size, height: size });
  try {
    await engine.loadUsd(new URL(scene, document.baseURI));
    await engine.capture({ backend: 'pathtracing', samples: 1 });
    const object = engine.objects[Math.floor(engine.objects.length / 2)]!.path;
    const capture4 = async () => {
      const t: number[] = [];
      for (let i = 0; i < 5; i++) { const start = performance.now(); await engine.capture({ backend: 'pathtracing', samples: 4 }); t.push(performance.now() - start); }
      return median(t);
    };
    const before = await capture4();
    const frames: number[] = [];
    for (let step = 0; step < 30; step++) {
      const start = performance.now();
      engine.setTransform(object, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, step * 1.5, step * 0.5, 0, 1]);
      await engine.capture({ backend: 'pathtracing', samples: 1 });
      frames.push(performance.now() - start);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const degraded = await capture4();
    await new Promise(resolve => setTimeout(resolve, 9000));
    const after = await capture4();
    const rebuilds = performance.getEntriesByName('pathtracing:bvh-rebuild') as PerformanceMeasure[];
    const updates = performance.getEntriesByName('pathtracing:dynamic-update') as PerformanceMeasure[];
    return {
      object, before, frameMs: median(frames), maxFrameMs: Math.max(...frames), capture4sppMs: { before, degradedOrRebuilt: degraded, after },
      rebuilds: rebuilds.map(entry => ({ ms: Math.round(entry.duration), ...(entry.detail as object) })),
      lastCostRatio: (updates.at(-1)?.detail as { costRatio?: number })?.costRatio,
    };
  } finally {
    engine.dispose();
  }
}

