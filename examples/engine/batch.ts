// Automated rendering with the public API: one headless engine renders a scene
// with its USD materials, then with each replacement material, and returns PNG
// images. Run from the command line with `npm run render:engine`.
import { MaterialXEngine, type EngineCaptureOptions } from '../../src/engine.ts';

export interface BatchJob {
  /** Scene URL, relative to the page. */
  scene: string;
  /** Replacement material URLs; each is rendered on `object` (the first object by default). */
  materials: readonly string[];
  object?: string;
  width: number;
  height: number;
  capture: EngineCaptureOptions;
}

export interface BatchImage {
  /** `original` or the replacement material URL. */
  label: string;
  /** Base64 PNG, so the result can cross the browser boundary as JSON. */
  png: string;
}

async function encodePng(width: number, height: number, rgba: Uint8Array): Promise<string> {
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function renderBatch(job: BatchJob): Promise<{ object: string; images: BatchImage[] }> {
  const engine = await MaterialXEngine.createHeadless({ width: job.width, height: job.height });
  try {
    await engine.loadUsd(new URL(job.scene, document.baseURI));
    const object = job.object ?? engine.objects[0]?.path;
    if (!object) throw new Error(`${job.scene} has no renderable object.`);
    if (!engine.objects.some(candidate => candidate.path === object)) {
      throw new Error(`Unknown object ${object}. Objects: ${engine.objects.map(candidate => candidate.path).join(', ')}.`);
    }
    const images: BatchImage[] = [];
    for (const label of ['original', ...job.materials]) {
      await engine.setMaterial(object, label === 'original' ? undefined : { url: label });
      const { width, height, rgba } = await engine.capture(job.capture);
      images.push({ label, png: await encodePng(width, height, rgba) });
      console.info(`Rendered ${label}.`);
    }
    return { object, images };
  } finally {
    engine.dispose();
  }
}
