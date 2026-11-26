// Priorité 15 : opérations booléennes sur des maillages fermés.
// npm run script -- examples/scripts/p15-boolean-operations.js --out docs/images/p15

const unionMaterial = new StandardSurface();
unionMaterial.base_color = [0.72, 0.38, 0.12];
unionMaterial.metalness = 0.24;
unionMaterial.specular_roughness = 0.24;

const differenceMaterial = new StandardSurface();
differenceMaterial.base_color = [0.16, 0.42, 0.72];
differenceMaterial.metalness = 0.28;
differenceMaterial.specular_roughness = 0.24;

const intersectionMaterial = new StandardSurface();
intersectionMaterial.base_color = [0.2, 0.58, 0.36];
intersectionMaterial.metalness = 0.18;
intersectionMaterial.specular_roughness = 0.28;

const ground = new StandardSurface();
ground.base_color = [0.14, 0.15, 0.17];
ground.specular_roughness = 0.72;

const studio = new EnvironmentShader();
studio.model = "studio";
studio.horizonColor = [0.52, 0.58, 0.68];
studio.groundColor = [0.07, 0.075, 0.09];
studio.sunIntensity = 5;

const unionA = new Sphere({ radius: 0.48, translate: [-0.28, 0, 0], resolution: 48 });
const unionB = new Sphere({ radius: 0.48, translate: [0.28, 0.08, 0], resolution: 48 });
const union = new Union({ base: unionA, tool: unionB, translate: [-2, 0, 0] });
union.material = unionMaterial;

const body = new Cylinder({ radius: 0.68, height: 1.55, resolution: 48 });
const drill = new Sphere({ radius: 0.46, translate: [0.28, 0.22, 0], resolution: 48 });
const cut = new Difference({ base: body, tool: drill, translate: [0, 0, 0], rotate: [0, 18, 0] });
cut.material = differenceMaterial;

const intersectionA = new Cube({ size: 1.15, translate: [-0.28, 0, 0] });
const intersectionB = new Cube({ size: 1.15, translate: [0.28, 0, 0] });
const intersection = new Intersection({ base: intersectionA, tool: intersectionB, translate: [2, 0, 0] });
intersection.material = intersectionMaterial;

new Plane({ width: 7, length: 5, translate: [0, -0.8, 0], material: ground });

await environment(studio.out);
render.resolution = 256;
render.environment = true;
render.backend = "raster";
setCamera({ eye: [4.8, 3.2, 7.5], target: [0, 0, 0], fov: 40 });
await save("p15-boolean-operations-raster.png");

render.backend = "pathtracing";
render.depth = 6;
await render(128);
await save("p15-boolean-operations-pathtracing.png");
