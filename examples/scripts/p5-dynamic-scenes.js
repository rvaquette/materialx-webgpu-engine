// Priorité 5 : scènes dynamiques (docs/ROADMAP_DONE.md).
// Scène de contrôle animée : séquence d'images raster et path tracing sur toute la timeline
// (caméra, hiérarchie, grille déformée, visibilité, lumière animée, matériaux à horloge,
// changement de topologie), variant set, déplacements/masquages/lumières/caméra par l'API,
// paramètres de matériaux sans recompilation, historique temporel et flou de mouvement.
// npm run script -- examples/scripts/p5-dynamic-scenes.js --out renders/validation/p5 --timeout 3600000

// GPU mobile (≈ 13 fois plus lent que la T500) : 256² et 4 fois moins d'échantillons.
const mobile = capabilities()?.mobile === true;
const spp = count => mobile ? Math.max(4, count / 4) : count;

const pad = value => String(value).padStart(2, "0");

await scene("./scenes/bench/animated.usda");
const range = timeline() ?? { start: 0, end: 48, fps: 24 };
check(range.end > range.start, `timeline ${range.start}–${range.end} à ${range.fps} images/s`);
render.resolution = mobile ? 256 : 512;

// 1. Séquence raster complète : chaque image est évaluée sans rechargement.
render.backend = "raster";
let started = performance.now();
for (let t = range.start; t <= range.end; t += 2) {
  await setTime(t);
  await save(`01-raster/frame-${pad(t)}.png`);
}
log(`Raster : ${((performance.now() - started) / 25).toFixed(0)} ms par image (enregistrement compris)`);

// 2. Path tracing aux instants clés : avant/après la disparition (24) et le changement de topologie.
render.backend = "pathtracing";
render.depth = 4;
for (const t of [0, 12, 23, 24, 25, 36, 48]) {
  await setTime(t);
  check(stats().time === t, `instant ${t} appliqué`);
  await render(spp(64));
  await save(`02-pathtracing/frame-${pad(t)}.png`);
}

// 3. Variant set : finition métal du cube, recomposition avec caméra et temps conservés.
const finish = variants().find(set => set.set === "finish");
check(finish?.variants.includes("metal"), "variant set finish exposé");
await setVariant("/World/Rig/Cube", "finish", "metal");
check(stats().time === 48, "le changement de variante conserve l'instant");
await render(spp(64));
await save("03-variante-metal.png");

// 4. Modifications explicites : prioritaires sur l'animation.
setTransform("/World/Rig/Cube", transform({ translate: [0, 1.5, 1], rotate: [25, 45, 0], scale: 1.4 }));
setVisibility("/World/Wave", false);
setLight("/World/Lights/Key", { intensity: 120, color: [0.3, 0.6, 1] });
setLight("/World/Lights/Fill", { transform: transform({ translate: [-6, 3, 6] }) });
setCamera({ eye: [7, 5, 10], target: [0, 1, 0], fov: 40 });
await render(spp(128));
await save("04-modifications-api.png");
await setTime(0);
await render(spp(64));
await save("04-modifications-api-t0.png");

// 5. Paramètres de matériaux en uniformes (UsdPreviewSurface du panneau) : sans recompilation.
const panel = materialParameters("/World/Panel");
const color = panel.find(p => p.id.endsWith("diffuseColor")) ?? { id: "surface:diffuseColor" };
check(panel.some(p => p.id === color.id), "couleur diffuse du panneau éditable");
for (const [label, rgb] of [["vert", [0.1, 0.9, 0.2]], ["jaune", [1, 0.85, 0.1]]]) {
  await setMaterialParameters("/World/Panel", { [color.id]: rgb });
  await render(spp(64));
  await save(`05-panneau-${label}.png`);
}

// Retour à l'état de la scène : les overrides sont retirés.
setTransform("/World/Rig/Cube");
setVisibility("/World/Wave");
setLight("/World/Lights/Key");
setLight("/World/Lights/Fill");

// 6. Historique temporel : 16 spp gardés à chaque image de la lecture au lieu de repartir de zéro.
render.temporalHistory = 16;
for (let t = 0; t <= 12; t += 1) {
  await setTime(t);
  await render(4);
}
await save("06-historique-temporel-16.png");
render.temporalHistory = 0;
await setTime(12);
await render(4);
await save("06-sans-historique-4spp.png");

// 7. Flou de mouvement : échantillons répartis sur l'intervalle d'obturation.
for (const [label, shutter] of [["court", [20, 22]], ["long", [12, 36]]]) {
  await capture(`07-flou-${label}.png`, { samples: spp(256), shutter, steps: 32 });
}
await setTime(24);
await capture("07-net-t24.png", { samples: spp(256) });
