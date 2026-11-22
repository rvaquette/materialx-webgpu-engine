// Browser side of scripts/bench-streaming.mjs: loads a scene on a canvas engine and
// reports the load time, the first displayed image (a streaming preview, or the
// complete scene) and the preview stages.
import { MaterialXEngine } from '../src/engine.ts';

export async function measureLoad(url: string, streaming: boolean, runs: number) {
  const results = [];
  for (let run = 0; run < runs; run++) {
    performance.clearMeasures();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    document.body.appendChild(canvas);
    const stages: string[] = [];
    const engine = await MaterialXEngine.create(canvas, {
      streaming,
      onStatus: status => {
        const stage = status.loading?.stage ?? 'complete';
        if (stages.at(-1) !== stage) stages.push(stage);
      },
    });
    try {
      const started = performance.now();
      await engine.loadUsd(url);
      const load = performance.now() - started;
      // Wait for the first complete frame to be measured.
      for (let i = 0; i < 100 && !performance.getEntriesByName('viewer:first-frame').length; i++) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const first = (name: string) => performance.getEntriesByName(name)[0]?.duration;
      const firstFrame = first('viewer:first-frame');
      results.push({ load, firstImage: first('viewer:first-preview') ?? firstFrame, firstFrame, stages });
    } finally {
      engine.dispose();
      canvas.remove();
    }
  }
  return results;
}
