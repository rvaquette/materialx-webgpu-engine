// Priorité 1 : rendu progressif intelligent (docs/ROADMAP_DONE.md).
// Convergence uniforme puis adaptative jusqu'à l'arrêt automatique (scène de Veach), puis sur
// une scène à 17 lumières rectangulaires : arrêt sur budget de temps, AOV (PNG et PFM),
// comparaison brut/débruité, exposition et tonemapping sans perte d'échantillons.
// L'arrêt exige que le pixel le plus bruité de chaque zone passe sous la cible : 25 % demande
// environ 6000 spp sur la scène de Veach (3 min en 128² sur NVIDIA T500). Sur hyperion, des
// pixels restent au-delà de 190 % même à 1024 spp : l'arrêt automatique n'y aboutit pas.
// npm run script -- examples/scripts/p1-progressive-rendering.js --out renders/validation/p1
// Sur GPU mobile (≈ 13 fois plus lent que la T500), la convergence complète demanderait plus de
// 30 min : les étapes 1 et 2 s'arrêtent sur un budget de 90 s et vérifient les mesures de bruit et
// l'estimation du temps restant ; les autres étapes utilisent 4 fois moins d'échantillons.

const mobile = capabilities()?.mobile === true;
const spp = count => mobile ? Math.max(4, count / 4) : count;
const pct = value => value === undefined ? "-" : `${(value * 100).toFixed(2)} %`;
const summary = label => {
  const s = stats();
  log(`${label} : ${s.samples} ${s.adaptive ? "balayages" : "spp"}, ${s.elapsed?.toFixed(1)} s actives, ` +
    `${s.samplesPerSecond?.toFixed(1)}/s, bruit RMS ${pct(s.noise)}, max ${pct(s.maxNoise)}, ` +
    `variance ${s.variance?.toFixed(3) ?? "-"}, arrêt ${s.stopReason ?? "-"}`);
  return s;
};

await scene("./scenes/pathtracer/test_veach.usda");
render.backend = "pathtracing";
render.resolution = 128;
render.depth = 8;
render.denoise = false;
render.view = "beauty";
render.tonemap = "acesFilmic";
render.exposure = 0;

// 1. Convergence uniforme vers 25 % de bruit relatif (intervalle de confiance à 95 %).
render.adaptive = false;
render.noiseTarget = 0.25;
render.stopOnConvergence = !mobile;
render.timeBudget = mobile ? 90 : 0;
await render();
await converge(900);
const uniform = summary("Uniforme");
if (mobile) {
  check(uniform.stopReason === "time-budget", "arrêt sur le budget de 90 s (uniforme, mobile)");
  check(uniform.maxNoise > 0 && uniform.remaining > 0, `bruit mesuré par zone et temps restant estimé (${uniform.remaining?.toFixed(0)} s)`);
} else {
  check(uniform.stopReason === "convergence", "arrêt automatique sur la cible de bruit (uniforme)");
  check(uniform.maxNoise <= 0.25, "bruit maximal des zones sous la cible");
}
check(uniform.samples >= 64, "au moins 64 spp avant l'arrêt");
check(uniform.variance > 0, "variance normalisée reconstruite en mode uniforme");
await save("01-uniforme-convergee.png");

// 2. Même cible en adaptatif : les pixels convergés ne sont recalculés qu'un balayage sur 8.
render.adaptive = true;
await render();
await converge(900);
const adaptive = summary("Adaptatif");
check(adaptive.stopReason === (mobile ? "time-budget" : "convergence"),
  mobile ? "arrêt sur le budget de 90 s (adaptatif, mobile)" : "arrêt automatique sur la cible de bruit (adaptatif)");
check(adaptive.variance === undefined, "variance indisponible en adaptatif (comptes par pixel)");
log(mobile ? `Balayages en 90 s, adaptatif / uniforme : ${(adaptive.samples / uniform.samples).toFixed(2)}`
  : `Temps actif adaptatif / uniforme : ${(adaptive.elapsed / uniform.elapsed).toFixed(2)}`);
await save("02-adaptatif-converge.png");

await scene("./scenes/pathtracer/hyperion_rect_lights.usda");
render.resolution = mobile ? 128 : 256;
render.stopOnConvergence = false;

// 3. Budget de temps : l'arrêt survient à la fin du lot qui dépasse 4 s.
render.adaptive = false;
render.stopOnConvergence = false;
render.timeBudget = 4;
await render();
await converge(120);
const budget = summary("Budget 4 s");
check(budget.stopReason === "time-budget", "arrêt sur budget de temps");
check(budget.elapsed >= 4 && budget.elapsed < (mobile ? 10 : 8), "temps actif borné par le budget (à un lot près)");
await save("03-budget-4s.png");
render.timeBudget = 0;

// 4. AOV : chaque vue est accumulée séparément, puis exportée en PNG (affichée) et PFM (32 bits).
for (const view of ["albedo", "normal", "depth", "variance", "emission", "transmission"]) {
  render.view = view;
  await render(spp(32));
  await save(`04-aov-${view}.png`);
  await save(`04-aov-${view}.pfm`);
}
render.view = "beauty";

// 5. Débruitage et comparaison brut (gauche) / débruité (droite) sur la même accumulation.
render.denoise = true;
await render(spp(64));
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
