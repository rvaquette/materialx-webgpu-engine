// Priorité 11 : nœuds intermédiaires et aperçu de matériau dans le workbench.
// npm run script -- examples/scripts/p11-material-previews.js --out docs/images/p11
const pattern = new Fractal3d("float");
pattern.octaves = 5;
pattern.amplitude = 0.8;

const color = new Mix("color3");
color.bg = [0.018, 0.032, 0.07];
color.fg = [0.12, 0.68, 0.42];
color.mix = pattern.out;

const roughness = new Mix("float");
roughness.bg = 0.12;
roughness.fg = 0.48;
roughness.mix = pattern.out;

const surface = new StandardSurface();
surface.base_color = color.out;
surface.specular_roughness = roughness.out;
surface.metalness = 0.12;

const material = new Surfacematerial();
material.surfaceshader = surface;
new Sphere({ radius: 1.25, material });

render.resolution = 256;
render.backend = "raster";
setCamera({ eye: [3.2, 2.2, 4.1], target: [0, 0, 0], fov: 40 });
await save("p11-material-previews-raster.png");

render.backend = "pathtracing";
render.depth = 6;
await render(128);
await save("p11-material-previews-pathtracing.png");
