// Priorité 17 : caustiques physiques sous l'eau, sans motif émissif de substitution.
// Le fond diffus reçoit la lumière du soleil (disque de 1,5°) focalisée par la houle :
// le path tracer les obtient par l'estimation directe à travers la transmission
// rugueuse de l'interface. Ciel sombre : le soleil domine, comme en plein midi.
// Le rendu raster n'a pas de caustiques ; trois niveaux d'échantillonnage montrent la convergence.
// npm run script -- examples/scripts/p17-caustics.js --out docs/images/p17-caustics
const mobile = capabilities()?.mobile === true;
const sky = new EnvironmentShader();
sky.model = "sky";
sky.zenithColor = [0.01, 0.025, 0.05];
sky.horizonColor = [0.05, 0.06, 0.07];
sky.sunDirection = [0.2, 0.95, -0.25];
sky.sunIntensity = 20;
sky.sunAngularDiameter = 1.5;

const water = new Water();
water.speed = 0.5;
water.scale = 4;
water.waveHeight = 0.04;
water.roughness = 0.01;
water.depth = 3;
water.absorptionColor = [0.75, 0.92, 0.95];
new Plane({ width: 8, length: 8, resolution: 256, material: water });

const sand = new StandardSurface();
sand.base_color = [0.8, 0.75, 0.62];
sand.specular_roughness = 0.9;
const floor = new Plane({ width: 8, length: 8, material: sand });
floor.translate = [0, -0.8, 0];

await environment(sky.out);
render.resolution = mobile ? 128 : 256;
setCamera({ eye: [0, 3.2, 2.4], target: [0, -0.6, 0], fov: 40 });
render.backend = "pathtracing";
render.depth = 8;
await setTime(0);
for (const samples of mobile ? [64] : [256, 1024, 4096]) {
  await render(samples);
  await save(`caustics-${samples}.png`);
}
