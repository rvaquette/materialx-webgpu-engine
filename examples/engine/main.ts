import { MaterialXEngine } from '../../src/engine.ts';

const canvas = document.querySelector('canvas')!;
const status = document.querySelector('[role="status"]')!;
const button = document.querySelector('button')!;
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
  const scene = engine;
  const path = scene.objects[0]!.path;
  const orange = { url: new URL('./orange.mtlx', import.meta.url) };
  let overridden = false;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await scene.setMaterial(path, overridden ? undefined : orange);
      overridden = !overridden;
      button.textContent = overridden ? 'Restaurer le matériau USD' : 'Appliquer le matériau orange';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      button.disabled = false;
    }
  });
  button.disabled = false;
} catch (error) {
  engine?.dispose();
  status.textContent = error instanceof Error ? error.message : String(error);
}

window.addEventListener('pagehide', event => { if (!event.persisted) engine?.dispose(); });
