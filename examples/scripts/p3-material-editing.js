// Priorité 3 : éditeur de matériaux MaterialX et priorité 3bis : scripting (docs/SCRIPTING.md).
// Graphe procédural profond (bruits fractals imbriqués, déformation de domaine, expressions,
// conditions par pixel, nœuds booléens), document à nodegraph importé puis modifié, matériau
// courant converti en script et retouché, export .mtlx, rendu raster et path tracing.
// npm run script -- examples/scripts/p3-material-editing.js --out renders/validation/p3

const library = "./scenes/mtlx-library/Examples/StandardSurface";
// GPU mobile (≈ 13 fois plus lent que la T500) : 256² et 4 fois moins d'échantillons.
const mobile = capabilities()?.mobile === true;
const spp = count => mobile ? Math.max(4, count / 4) : count;

await scene("./scenes/standard-shader-ball/standard-shader-ball.usda");
const ball = "/World/Geometry/OpenPBRShaderBall";
const neutral = "/World/Geometry/NeutralObjects";
render.resolution = mobile ? 256 : 512;

// 1. Marbre veiné : domaine déformé par un bruit vectoriel, veines par sinus et seuil.
pos = new Position();
pos.space = "object";
warp = new Fractal3d("vector3");
warp.position = pos.out * 1.5;
warp.octaves = 4;
warp.amplitude = [0.6, 0.6, 0.6];
detail = new Fractal3d("float");
detail.position = pos.out * 4 + warp.out;
detail.octaves = 6;
detail.lacunarity = 2.2;
axis = new Separate3("ND_separate3_vector3");
axis.in = pos.out + warp.out * 0.8;
wave = Math.abs(Math.sin(axis.outx * 9 + detail.out * 5));
veinMask = Math.pow(1 - wave, 12);
// Condition évaluée par pixel : ifgreater + and/not.
crack = detail.out > 0.35 && !(wave > 0.2) ? 1 : 0;
stone = new Mix();
stone.fg = [0.16, 0.13, 0.11];
stone.bg = [0.93, 0.91, 0.87];
stone.mix = Math.min(veinMask + crack * 0.6, 1);
tint = stone.out * (detail.out * 0.08 + 0.95);
marble = new StandardSurface();
marble.base_color = tint;
marble.specular_roughness = veinMask * 0.35 + 0.04;
marble.coat = 0.8;
marble.coat_roughness = 0.03;
marble.subsurface = 0.25;
marble.subsurface_color = tint;
marble.subsurface_radius = [0.9, 0.7, 0.5];
await assign(ball, marble);
await save("marbre-procedural.mtlx", marble);

// 2. Document à nodegraph (briques procédurales) importé, aplati, puis retouché.
bricks = await load(`${library}/standard_surface_brick_procedural.mtlx`);
mortar = node("node_color_11");
mortar.value = [0.05, 0.06, 0.09];
await assign(neutral, bricks);
await save("briques-retouchees.mtlx", bricks);

// 3. Le sol reçoit un matériau OpenPBR piloté par le même bruit (graphes partagés).
floor = new OpenPbrSurface();
floor.base_color = tint * 0.6;
floor.specular_roughness = detail.out * 0.2 + 0.25;
floor.coat_weight = 1;
await assign("/World/Ground", floor);

for (const backend of ["raster", "pathtracing"]) {
  render.backend = backend;
  await render(backend === "raster" ? undefined : spp(128));
  await save(`01-scripts-${backend}.png`);
}

// 4. Matériau → Script : le matériau résolu par le moteur redevient un script modifiable.
current = material(ball);
check(current !== undefined, "matériau courant converti en nœuds de script");
// current est le surfacematerial importé ; son shader est le nœud connecté.
surface = node(String(current.surfaceshader).split(".")[0]);
surface.base_color = [0.05, 0.2, 0.08];
surface.coat_color = [0.8, 1, 0.85];
await assign(ball, surface);
render.backend = "pathtracing";
await render(spp(128));
await save("02-materiau-courant-retouche.png");

// 5. Paramètres en uniformes : modifiés sans recompilation, comme dans l'éditeur.
const parameters = materialParameters(ball);
check(parameters.length > 0, `${parameters.length} paramètres éditables sur la sphère`);
const coat = parameters.find(p => p.id.endsWith("coat_roughness"));
if (coat) {
  for (const value of [0, 0.25, 0.6]) {
    await setMaterialParameters(ball, { [coat.id]: value });
    await render(spp(64));
    await save(`03-coat-roughness-${value}.png`);
  }
}
