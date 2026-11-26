// Priorité 17 : croûte de lave fissurée, incandescence et écoulement animé.
// npm run script -- examples/scripts/p17-lava.js --out docs/images/p17-lava
const mobile = capabilities()?.mobile === true;
const frames = Array.from({ length: 9 }, (_, index) => index * 3);
const pad = value => String(value).padStart(3, "0");

const lavaLight = new PointLight();
lavaLight.color = [1, 0.16, 0.025];
lavaLight.radius = 1.2;
lavaLight.translate = [0, 0.3, 0];

const lava = new Lava();
lava.speed = 0.18;
lava.scale = 3.2;
lava.temperature = 1900;
lava.emission = 5;
lava.relief = 0.18;
new Plane({ width: 6, length: 6, resolution: 64, material: lava });

render.resolution = mobile ? 128 : 256;
setCamera({ eye: [6, 5, 7], target: [0, 0, 0], fov: 40 });
render.backend = "raster";
for (const frame of frames) {
  await setTime(frame);
  await setLight(lavaLight.path, { intensity: 18 + 8 * Math.sin(frame * 0.4) });
  await save(`01-raster/frame-${pad(frame)}.png`);
}
render.backend = "pathtracing";
render.depth = 6;
for (const frame of [0, 12, 24]) {
  await setTime(frame);
  await setLight(lavaLight.path, { intensity: 18 + 8 * Math.sin(frame * 0.4) });
  await render(mobile ? 16 : 48);
  await save(`02-pathtracing/frame-${pad(frame)}.png`);
}
