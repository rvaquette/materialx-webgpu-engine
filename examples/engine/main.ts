import { MaterialXEngine } from '../../src/engine.ts';

const canvas = document.querySelector('canvas')!;
const status = document.querySelector('[role="status"]')!;
let engine: MaterialXEngine | undefined;

try {
  engine = await MaterialXEngine.create(canvas, {
    orbitControls: true,
    onStatus: ({ backend, drawCount }) => {
      if (backend === 'raster') status.textContent = `Raster — ${drawCount} objet(s)`;
    },
    onShaderErrors: errors => { if (errors.length) console.error(...errors); },
  });
  await engine.loadUsd(new URL('./triangle.usda', import.meta.url));
  await engine.render({ backend: 'raster' });
} catch (error) {
  engine?.dispose();
  status.textContent = error instanceof Error ? error.message : String(error);
}

window.addEventListener('pagehide', event => { if (!event.persisted) engine?.dispose(); });
