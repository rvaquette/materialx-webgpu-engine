// Priorité 17 : eau animée, houle déplacée, écume de crête et transmission.
// npm run script -- examples/scripts/p17-water.js --out docs/images/p17-water
const mobile = capabilities()?.mobile === true;
const frames = Array.from({ length: 9 }, (_, index) => index * 3);
const pad = value => String(value).padStart(3, "0");

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

render.resolution = mobile ? 128 : 256;
setCamera({ eye: [8, 6, 9], target: [0, 0, 0], fov: 40 });
render.backend = "raster";
for (const frame of frames) {
  await setTime(frame);
  await save(`01-raster/frame-${pad(frame)}.png`);
}
render.backend = "pathtracing";
render.depth = 6;
for (const frame of [0, 12, 24]) {
  await setTime(frame);
  await render(mobile ? 16 : 48);
  await save(`02-pathtracing/frame-${pad(frame)}.png`);
}
