import { MaterialXEngine } from '../src/engine.ts';
import type { EngineCapture } from '../src/engine.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function equalPixels(a: EngineCapture, b: EngineCapture): boolean {
  return a.rgba.length === b.rgba.length && a.rgba.every((value, i) => value === b.rgba[i]);
}

export async function verifyHeadlessCaptures(rasterOnly: boolean) {
  // An odd width exercises removal of GPU row padding.
  const width = 33;
  const height = 31;
  const canvasCount = document.querySelectorAll('canvas').length;
  const centerOffset = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
  const verifyTriangle = (image: EngineCapture, label: string): number[] => {
    assert(image.width === width && image.height === height && image.rgba.length === width * height * 4,
      `${label}: invalid dimensions or RGBA length`);
    const center = Array.from(image.rgba.subarray(centerOffset, centerOffset + 4));
    const [red, , blue, alpha] = center;
    assert(blue! >= red! + 25 && alpha === 255, `${label}: expected a blue triangle, got ${center}`);
    const background = image.rgba.subarray(0, 4);
    assert(background[3] === 255 && background[0]! > red! + 25, `${label}: unexpected background ${background}`);
    return center;
  };

  const engine = await MaterialXEngine.createHeadless({ width, height });
  try {
    await engine.loadUsd(new URL('/examples/engine/triangle.usda', location.href));
    console.info('USD loaded; checking raster capture.');
    const raster = await engine.capture();
    const rasterCenter = verifyTriangle(raster, 'Raster');
    assert(equalPixels(raster, await engine.capture()), 'Raster captures must be repeatable');

    let pathTraceCenter: number[] | undefined;
    if (!rasterOnly) {
      console.info('Raster verified; checking path-traced capture.');
      const one = await engine.capture({ backend: 'pathtracing', samples: 1 });
      console.info('First path-traced capture ready; checking sample count and reset.');
      const two = await engine.capture({ backend: 'pathtracing', samples: 2 });
      const oneAgain = await engine.capture({ backend: 'pathtracing', samples: 1 });
      pathTraceCenter = verifyTriangle(one, 'Path tracing (1 spp)');
      verifyTriangle(two, 'Path tracing (2 spp)');
      assert(!equalPixels(one, two), 'One and two samples must differ on this fixture');
      assert(equalPixels(one, oneAgain), 'Path tracing must restart from zero for each capture');
      assert(equalPixels(raster, await engine.capture()), 'Default capture must still use raster');
    }
    assert(document.querySelectorAll('canvas').length === canvasCount, 'Headless capture must not insert a canvas');
    return { width, height, rasterCenter, pathTraceCenter };
  } finally {
    engine.dispose();
  }
}
