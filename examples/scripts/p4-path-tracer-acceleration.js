// Priorité 4 : accélération du path tracer (docs/ROADMAP_DONE.md, « Banc de mesure »).
// Scènes limitées par les lumières, les matériaux ou les triangles : chargement à froid puis
// rechargement (caches de géométrie, de BVH et de shaders), débit en échantillons/s, rendu à
// nombre d'échantillons fixe et scène d'occlusion du guidage des lumières (12 lumières derrière
// un mur). Les temps sont mesurés dans le navigateur ; comparer avec npm run bench:engine.
// npm run script -- examples/scripts/p4-path-tracer-acceleration.js --out renders/validation/p4 --timeout 3600000

const seconds = since => ((performance.now() - since) / 1000).toFixed(1);
const scenes = [
  ["hyperion_rect_lights", "./scenes/pathtracer/hyperion_rect_lights.usda"],
  ["light_guide_occlusion", "./scenes/bench/light_guide_occlusion.usda"],
  ["test_veach", "./scenes/pathtracer/test_veach.usda"],
  ["tungsten-material-testball", "./scenes/pathtracer/tungsten-material-testball.usda"],
  ["renderman_teapot_tiles", "./scenes/pathtracer/renderman_teapot_tiles.usda"],
  ["diningroom", "./scenes/pathtracer/diningroom.usda"],
  ["bedroom", "./scenes/pathtracer/bedroom.usda"],
];

render.resolution = 256;
render.denoise = false;
render.adaptive = false;
render.stopOnConvergence = false;
render.timeBudget = 0;
for (const [name, entry] of scenes) {
  render.backend = "raster";
  let started = performance.now();
  await scene(entry);
  const loadTime = seconds(started);
  render.backend = "pathtracing";
  started = performance.now();
  await render(1);
  const firstFrame = seconds(started);
  started = performance.now();
  await render(64);
  const rendering = seconds(started);
  const rate = stats().samplesPerSecond;
  await save(`${name}-64spp.png`);

  // Rechargement : les caches doivent raccourcir le chargement et la compilation.
  render.backend = "raster";
  started = performance.now();
  await scene(entry);
  const reload = seconds(started);
  render.backend = "pathtracing";
  started = performance.now();
  await render(1);
  const reloadFirstFrame = seconds(started);
  log(`${name} : chargement ${loadTime} s, 1re image PT ${firstFrame} s, 64 spp en ${rendering} s ` +
    `(${rate?.toFixed(1)} spp/s), rechargement ${reload} s, 1re image PT ${reloadFirstFrame} s`);
  check(Number(reload) <= Number(loadTime) * 1.1 + 0.5, `${name} : le rechargement profite des caches`);
  check(Number(reloadFirstFrame) <= Number(firstFrame) * 1.1 + 0.5, `${name} : pipelines path tracing réutilisés au rechargement`);
}

// Guidage des lumières : seule la lumière visible doit éclairer, sans bruit des 12 lumières cachées.
await scene("./scenes/bench/light_guide_occlusion.usda");
render.backend = "pathtracing";
render.resolution = 512;
await render(256);
await save("light_guide_occlusion-256spp-512.png");
// Masquer la lumière visible : il ne reste que les fuites autour du mur.
setLight("/World/Lights/Visible", { intensity: 0 });
await render(256);
await save("light_guide_occlusion-lumiere-visible-eteinte.png");
setLight("/World/Lights/Visible");

// Environnement HDR (distribution CDF et MIS) à profondeur élevée.
await scene("./scenes/pathtracer/tungsten-material-testball.usda");
render.depth = 16;
await render(512);
await save("tungsten-hdr-512spp-profondeur16.png");
