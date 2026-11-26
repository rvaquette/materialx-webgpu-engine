// Priorité 17 : feu volumétrique et fumée procédurale sans texture externe.
// npm run script -- examples/scripts/p17-fire.js --out docs/images/p17-fire
const mobile = capabilities()?.mobile === true;
const frames = Array.from({ length: 9 }, (_, index) => index * 3);
const pad = value => String(value).padStart(3, "0");
const sky = new EnvironmentShader();
sky.model = "gradient";
sky.zenithColor = [0.015, 0.02, 0.035];
sky.horizonColor = [0.008, 0.012, 0.02];
sky.groundColor = [0.003, 0.003, 0.003];

const ground = new StandardSurface();
ground.base_color = [0.08, 0.07, 0.06];
new Plane({ width: 8, length: 8, material: ground });

const fireLight = new PointLight();
fireLight.color = [1, 0.22, 0.05];
fireLight.radius = 0.45;
fireLight.translate = [0, 1.3, 0];

const flame = new Fire();
flame.density = 2.4;
flame.scale = 3.2;
flame.speed = 0.65;
flame.temperature = 2400;
flame.emission = 5;
flame.centerHeight = 1.7;
const flameBounds = new Volume({ width: 1.6, height: 3.2, length: 1.6, material: flame });
flameBounds.translate = [0, 1.7, 0];

const smoke = new Smoke();
smoke.density = 0.5;
smoke.scale = 2;
smoke.speed = 0.16;
smoke.wind = [0.2, 1, 0.1];
const plume = new Volume({ width: 2.8, height: 2.5, length: 2.8, material: smoke });
plume.translate = [0, 4.6, 0];

await environment(sky.out);
render.resolution = mobile ? 128 : 512;
setCamera({ eye: [4, 3.5, 5], target: [0, 1.7, 0], fov: 35 });
render.backend = "raster";
for (const frame of frames) {
  flameBounds.translate = [0, 1.7 + Math.sin(frame * 0.7) * 0.025, 0];
  plume.translate = [0, 4.6 + Math.sin(frame * 0.3) * 0.04, 0];
  await setTime(frame);
  await setLight(fireLight.path, { intensity: 8 + 2 * Math.sin(frame * 0.55) });
  await save(`01-raster/frame-${pad(frame)}.png`);
}
render.backend = "pathtracing";
render.depth = 8;
for (const frame of [0, 12, 24]) {
  flameBounds.translate = [0, 1.7 + Math.sin(frame * 0.7) * 0.025, 0];
  plume.translate = [0, 4.6 + Math.sin(frame * 0.3) * 0.04, 0];
  await setTime(frame);
  await setLight(fireLight.path, { intensity: 0 });
  await render(mobile ? 32 : 384);
  await save(`02-pathtracing/frame-${pad(frame)}.png`);
}
