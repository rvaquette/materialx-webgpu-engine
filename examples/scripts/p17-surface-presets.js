// Priorité 17 : glace, boue et sable mouillé, sans texture externe.
// npm run script -- examples/scripts/p17-surface-presets.js --out docs/images/p17-surface-presets
const mobile = capabilities()?.mobile === true;
const pad = value => String(value).padStart(3, "0");

const floor = new StandardSurface();
floor.base_color = [0.12, 0.14, 0.16];
new Plane({ width: 12, length: 6, material: floor });

const ice = new Ice();
ice.depth = 1.8;
const iceBall = new Sphere({ material: ice, radius: 1.1 });
iceBall.translate = [-3.2, 1.1, 0];

const mud = new Mud();
mud.wetness = 0.72;
const mudBall = new Sphere({ material: mud, radius: 1.1 });
mudBall.translate = [0, 1.1, 0];

const sand = new WetSand();
sand.wetness = 0.65;
const sandBall = new Sphere({ material: sand, radius: 1.1 });
sandBall.translate = [3.2, 1.1, 0];

render.resolution = mobile ? 128 : 256;
setCamera({ eye: [0, 5, 11], target: [0, 1, 0], fov: 40 });
for (const frame of [0, 12, 24]) {
  await setTime(frame);
  render.backend = "raster";
  await save(`01-raster/frame-${pad(frame)}.png`);
  render.backend = "pathtracing";
  render.depth = 6;
  await render(mobile ? 16 : 48);
  await save(`02-pathtracing/frame-${pad(frame)}.png`);
}
