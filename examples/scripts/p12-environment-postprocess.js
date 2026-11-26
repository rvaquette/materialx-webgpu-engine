// Priorité 12 : environnement procédural animé et étalonnage écran.
// npm run script -- examples/scripts/p12-environment-postprocess.js --out docs/images/p12

const sky = new EnvironmentShader();
sky.model = "sky";
sky.zenithColor = [0.12, 0.28, 0.62];
sky.horizonColor = [0.88, 0.68, 0.42];
sky.groundColor = [0.06, 0.045, 0.035];
sky.sunDirection = [0.3, 0.82, 0.48];
sky.sunIntensity = 12;
sky.animationSpeed = 18;

const grade = new ImageShader();
grade.exposure = 0.05;
grade.contrast = 1.08;
grade.saturation = 0.92;
grade.vignette = 0.28;

const surface = new StandardSurface();
surface.base_color = [0.22, 0.34, 0.52];

const floorMaterial = new StandardSurface();
floorMaterial.base_color = [0.22, 0.19, 0.15];

new Sphere({ radius: 0.85, translate: [0, 0.85, 0], material: surface });
new Plane({ width: 5, length: 5, translate: [0, -0.02, 0], material: floorMaterial });

await environment(sky.out);
await postprocess(grade.out);
render.resolution = 256;
render.environment = true;
render.backend = "raster";
setCamera({ eye: [3.4, 2.4, 4.2], target: [0, 0.6, 0], fov: 38 });
await save("p12-environment-postprocess-raster.png");

await setTime(1);
render.backend = "pathtracing";
render.depth = 6;
await render(128);
await save("p12-environment-postprocess-pathtracing.png");
