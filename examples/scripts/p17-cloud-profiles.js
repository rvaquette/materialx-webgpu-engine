// Priorité 17 : profils cumulus, stratus et cirrus en volumes paramétrables.
// profile : 0 = cumulus, 1 = stratus, 2 = cirrus.
// npm run script -- examples/scripts/p17-cloud-profiles.js --out docs/images/p17-cloud-profiles
const mobile = capabilities()?.mobile === true;
const pad = value => String(value).padStart(3, "0");

const floor = new StandardSurface();
floor.base_color = [0.28, 0.34, 0.42];
new Plane({ width: 18, length: 18, material: floor });

const cumulus = new Clouds();
cumulus.profile = 0;
cumulus.baseHeight = 3.5;
cumulus.center = [0, 0, 0];
cumulus.coverage = 0.55;
cumulus.density = 0.55;
cumulus.color = [0.34, 0.4, 0.52];
const cumulusLayer = new Volume({ width: 12, height: 4, length: 10, material: cumulus });
cumulusLayer.translate = [0, 5.5, 0];

const stratus = new Clouds();
stratus.profile = 1;
stratus.baseHeight = 7.2;
stratus.center = [0, 0, 0];
stratus.coverage = 0.55;
stratus.density = 0.55;
stratus.color = [0.34, 0.4, 0.52];
const stratusLayer = new Volume({ width: 12, height: 1.6, length: 10, material: stratus });
stratusLayer.translate = [0, 8, 0];

const cirrus = new Clouds();
cirrus.profile = 2;
cirrus.baseHeight = 9.5;
cirrus.center = [0, 0, 0];
cirrus.coverage = 0.55;
cirrus.density = 0.55;
cirrus.color = [0.34, 0.4, 0.52];
const cirrusLayer = new Volume({ width: 12, height: 3.4, length: 10, material: cirrus });
cirrusLayer.translate = [0, 11.2, 0];

const sun = new PointLight();
sun.color = [1, 0.9, 0.72];
sun.intensity = 10;
sun.radius = 3;
sun.translate = [-5, 12, 4];

render.resolution = mobile ? 128 : 256;
setCamera({ eye: [12, 3, 16], target: [0, 8, 0], fov: 42 });
for (const frame of [0, 12, 24]) {
  cumulusLayer.translate = [frame * 0.015, 5.5, 0];
  stratusLayer.translate = [frame * 0.015, 8, 0];
  cirrusLayer.translate = [frame * 0.015, 11.2, 0];
  await setTime(frame);
  render.backend = "raster";
  await save(`01-raster/frame-${pad(frame)}.png`);
  render.backend = "pathtracing";
  render.depth = 8;
  await render(mobile ? 16 : 96);
  await save(`02-pathtracing/frame-${pad(frame)}.png`);
}
