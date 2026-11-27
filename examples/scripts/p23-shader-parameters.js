// Priorité 23 : paramètres déclarés de surface et de post-traitement.
// npm run script -- examples/scripts/p23-shader-parameters.js --out docs/images/p23

surface = new StandardSurface();
surface.base_color = [0.12, 0.45, 0.8];
surface.specular_roughness = 0.3;
expose(surface, "base_color", "Couleur de la sphère");
expose(surface, "specular_roughness", "Rugosité");

ball = new Sphere({ radius: 0.8, translate: [0, 0.8, 0], material: surface });
floor = new StandardSurface();
floor.base_color = [0.18, 0.18, 0.18];
ground = new Plane({ width: 8, length: 8, material: floor });

image = new ImageShader();
image.exposure = 0.3;
expose(image, "exposure", "Exposition de l'image");
await postprocess(image.out);

render.resolution = 256;
render.backend = "raster";
setCamera({ eye: [3, 2.4, 4], target: [0, 0.7, 0], fov: 38 });
await render(1);
await save("p23-shader-parameters.png");
