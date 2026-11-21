import { defineMaterialXViewer } from '../../src/engine-element.ts';

defineMaterialXViewer();
const viewer = document.querySelector('materialx-viewer')!;
const backend = document.querySelector('select')!;
const button = document.querySelector('button')!;
const status = document.querySelector('[role="status"]')!;
let overridden = false;

viewer.addEventListener('materialx-load', event => {
  status.textContent = `Scène chargée : ${event.detail.objects.map(object => object.path).join(', ')}`;
  button.disabled = false;
});
viewer.addEventListener('materialx-status', ({ detail }) => {
  if (detail.backend !== 'raster') status.textContent = `${detail.backend} — ${detail.samples} échantillon(s)`;
});
viewer.addEventListener('materialx-error', event => {
  status.textContent = event.detail.error instanceof Error ? event.detail.error.message : String(event.detail.error);
});
backend.addEventListener('change', () => viewer.setAttribute('backend', backend.value));
button.addEventListener('click', async () => {
  const path = viewer.objects[0]?.path;
  if (!path) return;
  button.disabled = true;
  try {
    await viewer.setMaterial(path, overridden ? undefined : { url: new URL('./orange.mtlx', import.meta.url) });
    overridden = !overridden;
    button.textContent = overridden ? 'Restaurer le matériau USD' : 'Appliquer le matériau orange';
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    button.disabled = false;
  }
});
