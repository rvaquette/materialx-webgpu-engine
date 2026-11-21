import { MaterialXEngine, type EngineCapture, type EngineOptions } from 'materialx-webgpu-engine';
import { defineMaterialXViewer } from 'materialx-webgpu-engine/element';

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

/** Render the triangle through `<materialx-viewer>` and report its objects and events. */
export async function verifyInstalledElement() {
  const Viewer = defineMaterialXViewer({ engineOptions: {
    runtimeAssets: { materialxCore: './engine-assets/core/', materialxLibraries: './engine-assets/libraries/' },
  } });
  const element = new Viewer();
  const events: string[] = [];
  const errors: string[] = [];
  element.addEventListener('materialx-load', () => events.push('load'));
  element.addEventListener('materialx-error', event => errors.push(String(event.detail.error)));
  element.setAttribute('width', '64');
  element.setAttribute('height', '48');
  element.setAttribute('src', './triangle.usda');
  document.body.append(element);
  try {
    await element.updateComplete;
    const canvas = element.shadowRoot?.querySelector('canvas');
    return {
      objects: element.objects.map(object => object.path), events, errors,
      canvas: canvas ? [canvas.width, canvas.height] : undefined,
    };
  } finally {
    element.remove();
  }
}
