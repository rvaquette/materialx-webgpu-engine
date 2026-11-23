// Priorité 2 : API de bibliothèque réutilisable (docs/ROADMAP_DONE.md, docs/ENGINE_API.md).
// Le script emprunte les mêmes opérations que l'API publique MaterialXEngine (loadUsd,
// setMaterial, render, capture, materialParameters...) : chargement USD, matériaux de la
// bibliothèque affectés par fichier, parité des trois backends à plusieurs résolutions,
// capture path tracing à nombre d'échantillons fixe et restauration des liaisons USD.
// npm run script -- examples/scripts/p2-library-api.js --out renders/validation/p2

const library = "./scenes/mtlx-library/Examples";
// GPU mobile (≈ 13 fois plus lent que la T500) : une seule résolution et 4 fois moins d'échantillons.
const mobile = capabilities()?.mobile === true;
const spp = count => mobile ? Math.max(4, count / 4) : count;

await scene("./scenes/standard-shader-ball/standard-shader-ball.usda");
const ball = "/World/Geometry/OpenPBRShaderBall";
const neutral = "/World/Geometry/NeutralObjects";
check(objects().includes(ball) && objects().includes("/World/Ground"), "objets USD exposés par chemin de prim");
check(capabilities()?.backends.raster.supported, "backend raster pris en charge par l'adaptateur");

// Matériaux de la bibliothèque, comme engine.setMaterial(path, { url }).
const materials = [
  ["or", `${library}/StandardSurface/standard_surface_gold.mtlx`],
  ["carpaint-openpbr", `${library}/OpenPbr/open_pbr_carpaint.mtlx`],
  ["marbre", `${library}/StandardSurface/standard_surface_marble_solid.mtlx`],
  ["onyx-hextiled", `${library}/StandardSurface/standard_surface_onyx_hextiled.mtlx`],
  ["velours-openpbr", `${library}/OpenPbr/open_pbr_velvet.mtlx`],
  ["disney-or", `${library}/DisneyPrincipled/disney_principled_gold.mtlx`],
];
await assign(neutral, `${library}/StandardSurface/standard_surface_brass_tiled.mtlx`);

for (const resolution of mobile ? [256] : [256, "1024x768"]) {
  render.resolution = resolution;
  for (const [name, file] of materials) {
    await assign(ball, file);
    check(materialParameters(ball).length > 0, `${name} : paramètres exposés comme engine.materialParameters`);
    for (const backend of ["raster", "pathtracing", "disney"]) {
      const support = capabilities()?.backends[backend];
      if (support && !support.supported) {
        log(`--  ${backend} non pris en charge : ${support.reason}`);
        continue;
      }
      render.backend = backend;
      try {
        await render(backend === "raster" ? undefined : spp(48));
      } catch (error) {
        // Known limit: the Disney pipeline can exceed the driver's memory on some discrete GPUs.
        if (backend !== "disney") throw error;
        log(`--  ${name} : backend Disney indisponible (${error.message})`);
        continue;
      }
      check(stats().drawnBy === backend, `${name} rendu par ${backend} sans repli (${resolution})`);
      await save(`${resolution}/${name}-${backend}.png`);
    }
  }
}

// Capture : même chemin que engine.capture({ backend: "pathtracing", samples }).
render.resolution = mobile ? 256 : 512;
render.backend = "pathtracing";
await assign(ball, `${library}/StandardSurface/standard_surface_carpaint.mtlx`);
await capture("capture-carpaint.png", { samples: spp(128) });
await capture("capture-carpaint-bis.png", { samples: spp(128) });
log("Les deux captures doivent être identiques au pixel près (suite de Sobol déterministe).");

// Recharger la scène rétablit les liaisons USD d'origine.
await scene("./scenes/standard-shader-ball/standard-shader-ball.usda");
render.backend = "raster";
await render();
await save("liaisons-usd-restaurees.png");
