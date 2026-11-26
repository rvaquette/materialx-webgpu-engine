// Priorité 13 : matériau procédural prêt à cuire en cartes PBR.
// Dans le viewer, ouvrir le graphe du matériau puis cliquer « Cuire les cartes »,
// « Exporter scène glTF » ou « Exporter scène USD ».
// npm run script -- examples/scripts/p13-baked-material.js --out docs/images/p13

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
await save("p13-baked-material-raster.png");

render.backend = "pathtracing";
render.depth = 6;
await render(128);
await save("p13-baked-material-pathtracing.png");
