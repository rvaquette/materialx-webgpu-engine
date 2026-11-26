// Priorité 9 : terrain animé par un displacementshader MaterialX.
// npm run script -- examples/scripts/p9-terrain.js --out docs/images/p9 --gpu default
const mobile = capabilities()?.mobile === true;
const spp = count => mobile ? Math.max(4, count / 4) : count;

const position = new Position();
position.space = "object";
const coordinates = new Separate3("ND_separate3_vector3");
coordinates.in = position.out;
const clock = new Time();
const waveA = Math.sin(coordinates.outx * 3.2 + clock.out * 2.1);
const waveB = Math.cos(coordinates.outz * 4.1 - clock.out * 1.4);

const water = new StandardSurface();
water.base_color = [0.025, 0.22, 0.34];
water.specular_roughness = 0.16;
const displacement = new Displacement("ND_displacement_float");
displacement.displacement = waveA * waveB * 0.06;

const material = new Surfacematerial();
material.surfaceshader = water;
material.displacementshader = displacement;
new Plane({ width: 8, length: 8, resolution: 64, maxScreenEdgeLength: 16, vertexBudget: 65536, material });

render.resolution = mobile ? 128 : 256;
setCamera({ eye: [8, 7, 9], target: [0, 0, 0], fov: 40 });
render.backend = "raster";
await save("p9-terrain-t0-raster.png");

await setTime(1);
check(stats().time === 1, "horloge MaterialX animée");
check(performance.getEntriesByName("displacement:compute").length > 0, "passe compute utilisée");
await save("p9-terrain-t1-raster.png");

render.backend = "pathtracing";
render.depth = 6;
await render(spp(128));
await save("p9-terrain-pathtracing.png");
