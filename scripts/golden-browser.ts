// Browser side of scripts/golden.mjs: renders one golden case through the public engine API.
import { MaterialXEngine } from '../src/engine.ts';

export interface GoldenCase {
  name: string;
  scene: string;
  width: number;
  height: number;
  backend?: 'raster' | 'pathtracing';
  samples?: number;
  time?: number;
}

export async function renderGolden(url: string, golden: GoldenCase) {
  const engine = await MaterialXEngine.createHeadless({ width: golden.width, height: golden.height });
  try {
    await engine.loadUsd(url);
    if (golden.time !== undefined) await engine.setTime(golden.time);
    const image = golden.backend === 'pathtracing'
      ? await engine.capture({ backend: 'pathtracing', samples: golden.samples ?? 64 })
      : await engine.capture();
    let binary = '';
    for (let i = 0; i < image.rgba.length; i += 0x8000) binary += String.fromCharCode(...image.rgba.subarray(i, i + 0x8000));
    return {
      rgba: btoa(binary), width: image.width, height: image.height, adapter: engine.capabilities.adapter,
      warnings: engine.diagnostics.filter(record => record.level !== 'info').map(record => record.message),
    };
  } finally {
    engine.dispose();
  }
}
