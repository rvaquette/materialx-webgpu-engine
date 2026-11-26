// Priorité 17 : eau animée, houle déplacée, écume de crête et transmission.
// npm run script -- examples/scripts/p17-water.js --out docs/images/p17-water
const mobile = capabilities()?.mobile === true;
const frames = Array.from({ length: 9 }, (_, index) => index * 3);
const pad = value => String(value).padStart(3, "0");
const sky = new EnvironmentShader();
sky.model = "sky";
sky.zenithColor = [0.08, 0.25, 0.55];
sky.horizonColor = [0.6, 0.72, 0.85];
sky.sunIntensity = 24;
sky.sunAngularDiameter = 3;

const water = new Water();
water.speed = 0.5;
water.scale = 1.6;
water.waveHeight = 0.14;
water.roughness = 0.08;
water.depth = 1.8;
water.absorptionColor = [0.015, 0.08, 0.12];
const pond = new Plane({ width: 8, length: 8, resolution: 64, material: water });

const caustics = new WaterCaustics();
caustics.scale = 4;
caustics.intensity = 1.8;
const poolFloor = new Plane({ width: 8, length: 8, material: caustics });
poolFloor.translate = [0, -1.2, 0];
const bed = new StandardSurface();
bed.base_color = [0.65, 0.5, 0.3];
bed.specular_roughness = 0.9;

await environment(sky.out);
render.resolution = mobile ? 128 : 256;
setCamera({ eye: [8, 6, 9], target: [0, 0, 0], fov: 40 });
render.backend = "raster";
for (const frame of frames) {
  await setTime(frame);
  await save(`01-raster/frame-${pad(frame)}.png`);
}
render.backend = "pathtracing";
// Refractive path transport replaces the decorative raster projection.
poolFloor.material = bed;
render.depth = 6;
for (const frame of [0, 12, 24]) {
  await setTime(frame);
  await render(mobile ? 32 : 256);
  await save(`02-pathtracing/frame-${pad(frame)}.png`);
}
