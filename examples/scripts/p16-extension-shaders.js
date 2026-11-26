// Priorité 16 : lentille, AOV et scatter scriptables.
// npm run script -- examples/scripts/p16-extension-shaders.js --out docs/images/p16

const surfaceMaterial = new StandardSurface();
surfaceMaterial.base_color = [0.18, 0.42, 0.62];
surfaceMaterial.specular_roughness = 0.32;

const prototypeMaterial = new StandardSurface();
prototypeMaterial.base_color = [0.86, 0.34, 0.08];
prototypeMaterial.metalness = 0.24;
prototypeMaterial.specular_roughness = 0.22;

const floorMaterial = new StandardSurface();
floorMaterial.base_color = [0.12, 0.14, 0.17];
floorMaterial.specular_roughness = 0.76;

const surface = new Plane({ width: 3.2, length: 3.2, translate: [0, 0.04, 0], material: surfaceMaterial });
const prototype = new Sphere({ radius: 0.12, material: prototypeMaterial });
new Plane({ width: 7, length: 7, translate: [0, -0.02, 0], material: floorMaterial });
new Sphere({ radius: 0.28, translate: [1.8, 0.28, 1.8], material: prototypeMaterial });
new Sphere({ radius: 0.36, translate: [-1.4, 0.36, -1.6], material: surfaceMaterial });

const studio = new EnvironmentShader();
studio.model = "studio";
studio.sunIntensity = 2;
await environment(studio.out);

const scatterSettings = new ScatterShader();
scatterSettings.surfacePath = surface.path;
scatterSettings.prototypePath = prototype.path;
scatterSettings.density = 1.5;
scatterSettings.seed = 21;
scatterSettings.scale = 0.8;
scatterSettings.hidePrototype = true;
await scatter(scatterSettings.out);

const lens = new LensShader();
lens.distortion = 0.04;
lens.chromaticAberration = 0.006;
await postprocess(lens.out);

render.resolution = 256;
render.environment = true;
setCamera({ eye: [4.5, 3.8, 6], target: [0, 0.5, 0], fov: 38 });

render.backend = "raster";
await save("p16-extension-shaders-raster.png");

render.backend = "pathtracing";
render.depth = 5;
await render(1);
lens.apertureRadius = 0.25;
lens.focusDistance = 7.5;
lens.bokehBlades = 6;
lens.bokehRotation = 12;
await postprocess(lens.out);
await render(128);
await save("p16-extension-shaders-beauty.png");

lens.projection = "equirectangular";
lens.apertureRadius = 0;
await postprocess(lens.out);
await render(128);
await save("p16-extension-shaders-panorama.png");

lens.projection = "perspective";
await postprocess(lens.out);
const aovSettings = new AovShader();
aovSettings.view = "albedo";
await aov(aovSettings.out);
await render(128);
await save("p16-extension-shaders-albedo.png");
