// Priorité 7 : robustesse, portabilité et exploitation (docs/ROADMAP_DONE.md, docs/INTEGRATION.md).
// Capacités de l'adaptateur, échecs prévisibles diagnostiqués sans casser le viewer (scène
// absente, objet ou lumière inconnus, scène précompilée figée), politique de budget mémoire GPU
// (réduction des textures puis repli raster du path tracer, puis retour à la normale), journal
// de diagnostics exporté.
// npm run script -- examples/scripts/p7-robustness.js --out renders/validation/p7 --timeout 3600000

// GPU mobile (≈ 13 fois plus lent que la T500) : 256², 4 fois moins d'échantillons, scène texturée plus légère.
const mobile = capabilities()?.mobile === true;
const spp = count => mobile ? Math.max(4, count / 4) : count;
const mib = bytes => `${(bytes / 2 ** 20).toFixed(1)} Mio`;
const fails = async (label, run) => {
  try {
    await run();
  } catch (error) {
    log(`    ${label} : ${error.message}`);
    return true;
  }
  return false;
};
const codes = () => diagnostics().map(record => record.code).filter(code => code);

// 1. Capacités : support et raison par backend avant tout chargement.
const caps = capabilities();
log(`Adaptateur : ${caps?.adapter.vendor} ${caps?.adapter.architecture} ${caps?.adapter.description}`);
for (const backend of ["raster", "pathtracing", "disney"]) {
  log(`  ${backend} : ${caps?.backends[backend].supported ? "pris en charge" : caps?.backends[backend].reason}`);
}
log(`  textures ≤ ${caps?.maxTextureSize} px, temps GPU ${caps?.gpuTimings ? "disponibles" : "indisponibles"}`);
check(caps?.backends.raster.supported, "le raster est pris en charge");

// 2. Échecs prévisibles : le viewer reste utilisable.
render.resolution = mobile ? 256 : 512;
check(await fails("scène absente", () => scene("./scenes/bench/absente.usda")), "une scène absente est refusée");
await scene("./scenes/bench/animated.usda");
check(await fails("objet inconnu", () => setTransform("/World/Inconnu", transform({ translate: [0, 1, 0] }))), "un objet inconnu est refusé");
check(await fails("lumière inconnue", () => setLight("/World/Lights/Inconnue", { intensity: 1 })), "une lumière inconnue est refusée");
check(await fails("variante inconnue", () => setVariant("/World/Rig/Cube", "finish", "or")), "une variante inconnue est refusée");
render.backend = "pathtracing";
await render(spp(32));
await save("01-viewer-intact-apres-erreurs.png");

// Scène précompilée : rendue sans source, mais figée (pas de géométrie dynamique).
await scene("./scenes/compiled/pathtracer/test_veach.usda");
await render(spp(64));
await save("02-scene-precompilee.png");
const frozen = objects()[0];
check(await fails("déplacement refusé", () => setTransform(frozen, transform({ translate: [0, 0.5, 0] }))) || frozen === undefined,
  "une scène précompilée refuse les changements dynamiques");

// 3. Budget mémoire GPU sur une scène texturée lourde (tuiles UDIM sur mobile, plus légère).
await scene(mobile ? "./scenes/pathtracer/renderman_teapot_tiles.usda" : "./scenes/pathtracer/diningroom.usda");
render.backend = "pathtracing";
await render(spp(16));
const full = stats().gpuMemory;
log(`Sans budget : ${mib(full.total)} (textures ${mib(full.textures)}), textures ≤ ${full.textureLimit} px`);
await save("03-sans-budget.png");

// 60 % de la mémoire mesurée : il faut réduire les textures pour tenir.
const partial = Math.max(16, Math.floor(full.total / 2 ** 20 * 0.6));
render.memoryBudget = partial;
const reduced = stats();
log(`Budget ${partial} Mio : ${mib(reduced.gpuMemory.total)} (textures ${mib(reduced.gpuMemory.textures)}), ` +
  `textures ≤ ${reduced.gpuMemory.textureLimit} px, repli : ${reduced.fallback ?? "aucun"}`);
check(reduced.gpuMemory.textureLimit < full.textureLimit, "le budget réduit la taille des textures");
check(reduced.gpuMemory.textures < full.textures, "la mémoire des textures diminue");
check(codes().includes("memory-budget-reduced"), "diagnostic memory-budget-reduced journalisé");
if (reduced.fallback) await render();
else await render(spp(16));
await save("04-budget-partiel.png");

// Budget intenable : le path tracer est remplacé par le raster, avec la raison.
render.memoryBudget = 8;
const starved = stats();
log(`Budget 8 Mio : ${mib(starved.gpuMemory.total)}, dessiné par ${starved.drawnBy}, repli : ${starved.fallback ?? "aucun"}`);
check(starved.drawnBy === "raster" && starved.fallback !== undefined, "repli raster du path tracer signalé");
check(codes().includes("backend-fallback") && codes().includes("memory-budget-exceeded"), "repli et dépassement journalisés");
await render();
await save("05-budget-8-repli-raster.png");

// Retrait du budget : textures complètes et path tracer rétablis.
render.memoryBudget = 0;
const restored = stats();
check(restored.fallback === undefined && restored.drawnBy === "pathtracing", "path tracer rétabli après retrait du budget");
check(restored.gpuMemory.textureLimit === full.textureLimit, "taille maximale des textures rétablie");
await render(spp(16));
await save("06-budget-retire.png");

// 4. Journal exportable : codes stables, horodatés, avec le contexte du viewer.
const counts = {};
for (const code of codes()) counts[code] = (counts[code] ?? 0) + 1;
log(`Diagnostics : ${JSON.stringify(counts)}`);
await save("diagnostics.json");
