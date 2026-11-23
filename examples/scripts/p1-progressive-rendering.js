// Priorité 1 : rendu progressif intelligent (docs/ROADMAP_DONE.md).
// Scène à 17 lumières rectangulaires, bruitée : convergence uniforme puis adaptative à une
// cible de bruit, arrêt sur budget de temps, AOV (PNG et PFM), comparaison brut/débruité,
// exposition et tonemapping sans perte d'échantillons.
// npm run script -- examples/scripts/p1-progressive-rendering.js --out renders/validation/p1

const pct = value => value === undefined ? "-" : `${(value * 100).toFixed(2)} %`;
const summary = label => {
  const s = stats();
  log(`${label} : ${s.samples} ${s.adaptive ? "balayages" : "spp"}, ${s.elapsed?.toFixed(1)} s actives, ` +
    `${s.samplesPerSecond?.toFixed(1)}/s, bruit RMS ${pct(s.noise)}, max ${pct(s.maxNoise)}, ` +
    `variance ${s.variance?.toFixed(3) ?? "-"}, arrêt ${s.stopReason ?? "-"}`);
  return s;
};

await scene("./scenes/pathtracer/hyperion_rect_lights.usda");
render.backend = "pathtracing";
render.resolution = 256;
render.depth = 8;
render.denoise = false;
render.view = "beauty";
render.tonemap = "acesFilmic";
render.exposure = 0;

// 1. Convergence uniforme vers 8 % de bruit relatif (intervalle de confiance à 95 %).
render.adaptive = false;
render.noiseTarget = 0.08;
render.stopOnConvergence = true;
render.timeBudget = 0;
await render();
await converge(1200);
const uniform = summary("Uniforme");
check(uniform.stopReason === "convergence", "arrêt automatique sur la cible de bruit (uniforme)");
check(uniform.samples >= 64, "au moins 64 spp avant l'arrêt");
check(uniform.maxNoise <= 0.08, "bruit maximal des zones sous la cible");
check(uniform.variance > 0, "variance normalisée reconstruite en mode uniforme");
await save("01-uniforme-convergee.png");

// 2. Même cible en adaptatif : les pixels convergés ne sont recalculés qu'un balayage sur 8.
render.adaptive = true;
await render();
await converge(1200);
const adaptive = summary("Adaptatif");
check(adaptive.stopReason === "convergence", "arrêt automatique sur la cible de bruit (adaptatif)");
check(adaptive.variance === undefined, "variance indisponible en adaptatif (comptes par pixel)");
log(`Temps actif adaptatif / uniforme : ${(adaptive.elapsed / uniform.elapsed).toFixed(2)}`);
await save("02-adaptatif-converge.png");

// 3. Budget de temps : l'arrêt survient à la fin du lot qui dépasse 4 s.
render.adaptive = false;
render.stopOnConvergence = false;
render.timeBudget = 4;
await render();
await converge(120);
const budget = summary("Budget 4 s");
check(budget.stopReason === "time-budget", "arrêt sur budget de temps");
check(budget.elapsed >= 4 && budget.elapsed < 8, "temps actif borné par le budget (à un lot près)");
await save("03-budget-4s.png");
render.timeBudget = 0;

// 4. AOV : chaque vue est accumulée séparément, puis exportée en PNG (affichée) et PFM (32 bits).
for (const view of ["albedo", "normal", "depth", "variance", "emission", "transmission"]) {
  render.view = view;
  await render(32);
  await save(`04-aov-${view}.png`);
  await save(`04-aov-${view}.pfm`);
}
render.view = "beauty";

// 5. Débruitage et comparaison brut (gauche) / débruité (droite) sur la même accumulation.
render.denoise = true;
await render(64);
render.paused = true;
render.compare = true;
await save("05-comparaison-brut-debruite.png");
render.compare = false;
await save("05-debruite.png");

// 6. Exposition et tonemapping s'appliquent à l'affichage sans réinitialiser les échantillons.
const before = stats().samples;
for (const [tonemap, exposure] of [["none", 0], ["reinhard", 1], ["acesFilmic", -1], ["acesFilmic", 1.5]]) {
  render.tonemap = tonemap;
  render.exposure = exposure;
  await save(`06-${tonemap}-ev${exposure}.png`);
}
check(stats().samples === before, "exposition et tonemapping conservent l'accumulation");
render.exposure = 0;
render.tonemap = "acesFilmic";
render.paused = false;
