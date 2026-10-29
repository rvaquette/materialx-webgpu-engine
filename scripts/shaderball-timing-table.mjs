export function formatTimingTable(report, currentCases) {
  const rows = [];
  const global = report.timings;
  const add = (label, milliseconds) => rows.push([label, milliseconds]);
  add(`Démarrage ${report.server === 'static' ? 'serveur statique' : 'Vite'} + Chrome/CDP`,
    (global.serverStartup ?? 0) + (global.browserStartup ?? 0));
  const phases = [
    ['Chargement page/modules', ['pageLoadAndModules']],
    ['Initialisation GPU, import USD et HDR', ['deviceInitialization', 'usdImport', 'environment']],
    ['Documents MaterialX', ['materialDocuments']],
    ['Chargement géométrie', ['geometryLoading']],
    ['Préparation des ressources de scène', ['sceneResources']],
    ["BVH + upload d'environnement", ['bvhAndEnvironmentUpload']],
    ['Dispatch matériaux et textures', ['materialDispatchAndTextures']],
    ['Compilation du pipeline GPU', ['pipelineCompilation']],
    ['Ressources GPU', ['gpuResources']],
    ['Préparation raster', ['rasterPreparation']],
    ['Rendu', ['render']],
  ];
  for (const [label, keys] of phases) {
    if (!currentCases.some(entry => keys.some(key => Number.isFinite(entry.timings?.[key])))) continue;
    add(label, currentCases.reduce((sum, entry) =>
      sum + keys.reduce((subtotal, key) => subtotal + (entry.timings?.[key] ?? 0), 0), 0));
  }
  const measured = rows.reduce((sum, [, ms]) => sum + ms, 0);
  add('Autres opérations et nettoyage', Math.max(0, global.commandTotal - measured));
  add('Total du script', global.commandTotal);
  const seconds = ms => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
  const width = Math.max('Phase'.length, ...rows.map(([label]) => label.length));
  const durationWidth = Math.max('Durée'.length, ...rows.map(([, ms]) => seconds(ms).length));
  return [
    `| ${'Phase'.padEnd(width)} | ${'Durée'.padStart(durationWidth)} |`,
    `| ${'-'.repeat(width)} | ${'-'.repeat(durationWidth)} |`,
    ...rows.map(([label, ms]) => `| ${label.padEnd(width)} | ${seconds(ms).padStart(durationWidth)} |`),
  ].join('\n');
}
