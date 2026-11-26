// Priorité 14 : comparaison de matières et éclairage de lookdev.
// npm run script -- examples/scripts/p14-lookdev-project.js --out docs/images/p14

const polished = new StandardSurface();
polished.base_color = [0.72, 0.38, 0.12];
polished.metalness = 0.82;
polished.specular_roughness = 0.18;

const satin = new StandardSurface();
satin.base_color = [0.12, 0.32, 0.68];
satin.metalness = 0.16;
satin.specular_roughness = 0.42;

const ground = new StandardSurface();
ground.base_color = [0.16, 0.17, 0.19];
ground.specular_roughness = 0.72;

const studio = new EnvironmentShader();
studio.model = "studio";
studio.horizonColor = [0.5, 0.56, 0.66];
studio.groundColor = [0.07, 0.075, 0.09];
studio.sunIntensity = 6;

new Sphere({ radius: 0.72, translate: [-0.85, 0.72, 0], material: polished });
new Sphere({ radius: 0.72, translate: [0.85, 0.72, 0], material: satin });
new Plane({ width: 5, length: 5, translate: [0, -0.02, 0], material: ground });

await environment(studio.out);
render.resolution = 256;
render.environment = true;
render.backend = "raster";
setCamera({ eye: [3.6, 2.5, 5], target: [0, 0.65, 0], fov: 40 });
await save("p14-lookdev-project-raster.png");

render.backend = "pathtracing";
render.depth = 6;
await render(128);
await save("p14-lookdev-project-pathtracing.png");
