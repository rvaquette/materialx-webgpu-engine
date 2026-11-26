// Priorité 10 : explorer des NodeDefs MaterialX dans la référence intégrée.
// npm run script -- examples/scripts/p10-node-reference.js --out docs/images/p10
const noise = new Fractal3d("float");
noise.octaves = 5;
noise.amplitude = 0.8;

const palette = new Mix("color3");
palette.bg = [0.015, 0.035, 0.09];
palette.fg = [0.08, 0.72, 0.48];
palette.mix = noise.out;

const roughness = new Mix("float");
roughness.bg = 0.12;
roughness.fg = 0.52;
roughness.mix = noise.out;

const surface = new StandardSurface();
surface.base_color = palette.out;
surface.specular_roughness = roughness.out;
surface.metalness = 0.18;

const material = new Surfacematerial();
material.surfaceshader = surface;
new Sphere({ radius: 1.25, material });

render.resolution = 256;
render.backend = "raster";
setCamera({ eye: [3.2, 2.2, 4.1], target: [0, 0, 0], fov: 40 });
await save("p10-node-reference-raster.png");

render.backend = "pathtracing";
render.depth = 6;
await render(128);
await save("p10-node-reference-pathtracing.png");
