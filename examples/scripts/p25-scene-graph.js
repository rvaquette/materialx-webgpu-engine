// Graphe MaterialX : surface et déplacement composés dans un matériau partagé.
const surface = new StandardSurface();
surface.base_color = [0.12, 0.42, 0.72];
surface.specular_roughness = 0.26;
const displacement = new Displacement("ND_displacement_float");
displacement.displacement = 0.12;
const material = new Surfacematerial();
material.surfaceshader = surface;
material.displacementshader = displacement;

// Priorité 25 : graphe de scène et workflow de rendu.
const sphereA = new Sphere({ radius: 0.6, resolution: 48 });
sphereA.material = material;
sphereA.translate = [-0.7, 0, 0];
const sphereB = new Sphere({ radius: 0.6, resolution: 48 });
sphereB.material = material;
sphereB.translate = [0.7, 0, 0];
setCamera({ eye: [3.4, 2.4, 4.6], target: [0, 0, 0], fov: 42 });
render.backend = "pathtracing";
render.resolution = 256;
render.depth = 4;
await render(16);
await save("p25-scene-graph.png");
