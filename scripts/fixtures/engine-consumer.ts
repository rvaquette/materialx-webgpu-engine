import { MaterialXEngine, type EngineCapture, type EngineOptions } from 'materialx-webgpu-engine';

function transferImage({ width, height, rgba }: EngineCapture) {
  return { width, height, rgba: Array.from(rgba) };
}

export async function verifyInstalledEngine(pathTracing: boolean) {
  const runtimeAssets: EngineOptions['runtimeAssets'] = {
    materialxCore: './engine-assets/core/',
    materialxLibraries: './engine-assets/libraries/',
  };
  const engine = await MaterialXEngine.createHeadless({ width: 33, height: 31, runtimeAssets });
  try {
    await engine.loadUsd('./triangle.usda');
    const raster = transferImage(await engine.capture());
    const samples = [];
    if (pathTracing) {
      for (const count of [1, 2, 1]) {
        console.info(`Installed engine: capturing path tracing at ${count} spp.`);
        samples.push(transferImage(await engine.capture({ backend: 'pathtracing', samples: count })));
      }
    }
    return {
      raster,
      objects: engine.objects.map(object => object.path),
      canvasCount: document.querySelectorAll('canvas').length,
      samples,
    };
  } finally {
    engine.dispose();
  }
}
