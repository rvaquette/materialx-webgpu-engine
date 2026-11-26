// Priorité 17 : panache volumétrique diffusant, advecté par le vent.
// npm run script -- examples/scripts/p17-smoke.js --out docs/images/p17-smoke
const mobile = capabilities()?.mobile === true;
const frames = Array.from({ length: 9 }, (_, index) => index * 3);
const pad = value => String(value).padStart(3, "0");

const smoke = new Smoke();
smoke.density = 0.35;
smoke.scale = 2.4;
smoke.speed = 0.22;
smoke.wind = [0.45, 1, 0.12];
smoke.color = [0.42, 0.45, 0.49];
smoke.anisotropy = 0.42;
smoke.center = [0, 0, 0];
const plume = new Volume({ width: 3.2, height: 4.5, length: 3.2, material: smoke });
plume.translate = [0, 2.2, 0];

const key = new PointLight();
key.color = [0.82, 0.88, 1];
key.intensity = 60;
key.radius = 2;
key.translate = [-2, 5, 2];

render.resolution = mobile ? 128 : 256;
setCamera({ eye: [6, 5, 8], target: [0, 2, 0], fov: 40 });
render.backend = "raster";
for (const frame of frames) {
  const drift = frame * 0.012;
  smoke.center = [drift, 0, 0];
  plume.translate = [drift, 2.2, 0];
  await setTime(frame);
  await save(`01-raster/frame-${pad(frame)}.png`);
}
render.backend = "pathtracing";
render.depth = 8;
for (const frame of [0, 12, 24]) {
  const drift = frame * 0.012;
  smoke.center = [drift, 0, 0];
  plume.translate = [drift, 2.2, 0];
  await setTime(frame);
  await render(mobile ? 16 : 48);
  await save(`02-pathtracing/frame-${pad(frame)}.png`);
}
