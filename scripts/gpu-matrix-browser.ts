// Browser side of scripts/test-gpu-matrix.mjs.
import { MaterialXEngine } from '../src/engine.ts';
import { verifyHeadlessCaptures } from './capture-engine-browser.ts';

export async function probe(rasterOnly: boolean) {
  const engine = await MaterialXEngine.createHeadless({ width: 8, height: 8 });
  const capabilities = engine.capabilities;
  engine.dispose();
  const started = performance.now();
  const captures = await verifyHeadlessCaptures(rasterOnly);
  return { capabilities, captures, milliseconds: performance.now() - started };
}
