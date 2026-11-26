// Priorité 17 : couche de nuages volumétriques bruités dérivant avec le vent.
// npm run script -- examples/scripts/p17-clouds.js --out docs/images/p17-clouds
const mobile = capabilities()?.mobile === true;
const frames = Array.from({ length: 9 }, (_, index) => index * 3);
const pad = value => String(value).padStart(3, "0");
const sky = new EnvironmentShader();
sky.model = "sky";
sky.zenithColor = [0.08, 0.22, 0.5];
sky.horizonColor = [0.38, 0.58, 0.82];
sky.sunIntensity = 0;
sky.sunDirection = [-0.45, 0.7, 0.35];

const clouds = new Clouds();
clouds.coverage = 0.55;
clouds.density = 2;
clouds.scale = 0.65;
clouds.speed = 0.06;
clouds.wind = [1, 0, 0.25];
clouds.color = [0.99, 0.99, 1];
clouds.center = [0, 0, 0];
clouds.baseHeight = 3.5;
const cloudLayer = new Volume({ width: 12, height: 4.5, length: 10, material: clouds });
cloudLayer.translate = [0, 5.75, 0];
const ground = new StandardSurface();
ground.base_color = [0.2, 0.28, 0.12];
new Plane({ width: 20, length: 20, material: ground });

const sun = new DistantLight();
sun.color = [1, 0.98, 0.95];
sun.intensity = 4;
sun.rotate = [-60, -60, 0];

await environment(sky.out);
render.resolution = mobile ? 128 : 512;
setCamera({ eye: [10, 7, 12], target: [0, 4, 0], fov: 42 });
render.backend = "raster";
for (const frame of frames) {
  const drift = frame * 0.02;
  clouds.center = [drift, 0, 0];
  cloudLayer.translate = [drift, 5.75, 0];
  await setTime(frame);
  await save(`01-raster/frame-${pad(frame)}.png`);
}
render.backend = "pathtracing";
render.depth = 24;
for (const frame of [0, 12, 24]) {
  const drift = frame * 0.02;
  clouds.center = [drift, 0, 0];
  cloudLayer.translate = [drift, 5.75, 0];
  await setTime(frame);
  await render(mobile ? 128 : 768);
  await save(`02-pathtracing/frame-${pad(frame)}.png`);
}
