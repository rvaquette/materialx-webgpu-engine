// Priorité 17 : couche de nuages volumétriques bruités dérivant avec le vent.
// npm run script -- examples/scripts/p17-clouds.js --out docs/images/p17-clouds
const mobile = capabilities()?.mobile === true;
const frames = Array.from({ length: 9 }, (_, index) => index * 3);
const pad = value => String(value).padStart(3, "0");

const clouds = new Clouds();
clouds.coverage = 0.55;
clouds.density = 0.7;
clouds.scale = 2.6;
clouds.speed = 0.06;
clouds.wind = [1, 0, 0.25];
clouds.color = [0.48, 0.55, 0.68];
clouds.center = [0, 0, 0];
clouds.baseHeight = 3.5;
const cloudLayer = new Volume({ width: 12, height: 4, length: 10, material: clouds });
cloudLayer.translate = [0, 5.5, 0];

const sun = new PointLight();
sun.color = [1, 0.9, 0.72];
sun.intensity = 24;
sun.radius = 3;
sun.translate = [-5, 10, 4];

render.resolution = mobile ? 128 : 256;
setCamera({ eye: [10, 7, 12], target: [0, 4, 0], fov: 42 });
render.backend = "raster";
for (const frame of frames) {
  const drift = frame * 0.02;
  clouds.center = [drift, 0, 0];
  cloudLayer.translate = [drift, 5.5, 0];
  await setTime(frame);
  await save(`01-raster/frame-${pad(frame)}.png`);
}
render.backend = "pathtracing";
render.depth = 8;
for (const frame of [0, 12, 24]) {
  const drift = frame * 0.02;
  clouds.center = [drift, 0, 0];
  cloudLayer.translate = [drift, 5.5, 0];
  await setTime(frame);
  await render(mobile ? 16 : 48);
  await save(`02-pathtracing/frame-${pad(frame)}.png`);
}
