// Priorité 6 : volumes et effets avancés (docs/ROADMAP_DONE.md).
// Volumes NanoVDB (nuage, fumée, flamme corps noir, bouffées instanciées), brouillard et rais
// de lumière, dispersion spectrale d'un prisme, subsurface multi-échelle, cheveux de Chiang,
// fourrure, particules et PointInstancer : raster et path tracing côte à côte, puis variations
// de paramètres physiques (dispersion, échelle du subsurface, mélanine) et animation de la foule.
// npm run script -- examples/scripts/p6-volumes-effects.js --out renders/validation/p6 --timeout 7200000

// GPU mobile (≈ 13 fois plus lent que la T500) : 256² et 4 fois moins d'échantillons.
const mobile = capabilities()?.mobile === true;
const spp = count => mobile ? Math.max(4, count / 4) : count;

const both = async (name, samples) => {
  render.backend = "raster";
  await render();
  await save(`${name}-raster.png`);
  render.backend = "pathtracing";
  await render(samples);
  await save(`${name}-pathtracing-${samples}spp.png`);
};

render.resolution = mobile ? 256 : 512;
render.denoise = false;
render.adaptive = false;
render.stopOnConvergence = false;
render.timeBudget = 0;

// 1. Volumes NanoVDB : diffusion multiple en path tracing, simple en raster.
await scene("./scenes/bench/volumes.usda");
check(objects().includes("/World/Fire") && objects().includes("/World/Puffs"), "volumes et instancier de volumes chargés");
render.depth = 16;
await both("01-volumes", spp(256));
// Soleil rasant puis coupé : la flamme reste visible par son émission corps noir.
setLight("/World/Lights/Sun", { intensity: 0 });
setLight("/World/Lights/Key", { intensity: 0 });
render.environment = false;
await render(spp(256));
await save("01-volumes-emission-seule.png");
setLight("/World/Lights/Sun");
setLight("/World/Lights/Key");
render.environment = true;

// 2. Brouillard englobant la caméra : rais de lumière entre les piliers.
await scene("./scenes/bench/fog.usda");
render.depth = 24;
await both("02-brouillard", spp(512));
setLight("/World/Lights/Lamp", { color: [1, 0.55, 0.2] });
await render(spp(256));
await save("02-brouillard-lampe-orange.png");
setLight("/World/Lights/Lamp");

// 3. Optique : prisme dispersif (spectral), caustique, plaques subsurface à 1 cm, 10 cm, 1 m.
await scene("./scenes/bench/optics.usda");
render.depth = 32;
await both("03-optique", spp(512));
for (const abbe of [60, 4]) {
  await setMaterialParameters("/World/Prism", { "surface:transmission_dispersion": abbe });
  await render(spp(512));
  await save(`03-prisme-abbe-${abbe}.png`);
}
await setMaterialParameters("/World/Prism", { "surface:transmission_dispersion": 12 });
for (const [plate, scale] of [["SubsurfaceFine", 0.5], ["SubsurfaceMedium", 0.002], ["SubsurfaceCoarse", 0.05]]) {
  await setMaterialParameters(`/World/${plate}`, { "surface:subsurface_scale": scale });
}
await render(spp(512));
await save("03-subsurface-echelles-inversees.png");

// 4. Cheveux, fourrure, particules et foule instanciée (animée).
await scene("./scenes/bench/hair_particles.usda");
render.depth = 16;
await both("04-cheveux-particules", spp(256));
for (const [label, melanin] of [["blond", 0.15], ["noir", 0.95]]) {
  await setMaterialParameters("/World/Hair", { "surface:melaninConcentration": melanin });
  await setMaterialParameters("/World/Fur", { "surface:melaninConcentration": melanin });
  await render(spp(256));
  await save(`04-melanine-${label}.png`);
}
const range = timeline() ?? { start: 0, end: 48 };
for (const t of [range.start, (range.start + range.end) / 2, range.end]) {
  await setTime(t);
  await render(spp(128));
  await save(`04-foule-t${t}.png`);
}
await capture("04-foule-flou-de-mouvement.png", { samples: spp(256), shutter: [range.start, range.end], steps: 32 });
