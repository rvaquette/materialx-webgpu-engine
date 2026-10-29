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
  const timingTable = [
    `| ${'Phase'.padEnd(width)} | ${'Durée'.padStart(durationWidth)} |`,
    `| ${'-'.repeat(width)} | ${'-'.repeat(durationWidth)} |`,
    ...rows.map(([label, ms]) => `| ${label.padEnd(width)} | ${seconds(ms).padStart(durationWidth)} |`),
  ].join('\n');
  const cpu = [...currentCases.map(entry => entry.memory?.cpu), report.memory?.cpu].filter(Boolean);
  const gpu = currentCases.map(entry => entry.memory?.gpu).filter(Boolean);
  const memoryRows = [];
  const mib = bytes => `${(bytes / 1024 ** 2).toFixed(1).replace('.', ',')} Mio`;
  const maximum = (label, values) => {
    const available = values.filter(Number.isFinite);
    memoryRows.push([label, available.length ? mib(Math.max(...available)) : 'indisponible']);
  };
  maximum('CPU Node : RSS (max. relevé)', cpu.map(sample => sample.node.rss));
  maximum('CPU Node : pic RSS processus', cpu.map(sample => sample.node.peakRss));
  maximum('CPU Node : tas JS utilisé (max. relevé)', cpu.map(sample => sample.node.heapUsed));
  maximum('CPU Node : mémoire externe (max. relevé)', cpu.map(sample => sample.node.external));
  maximum('CPU Node : ArrayBuffers (inclus dans externe)', cpu.map(sample => sample.node.arrayBuffers));
  maximum('CPU Chrome + enfants : RSS (max. relevé)', cpu.map(sample => sample.chrome.rss));
  maximum('CPU Chrome + enfants : mémoire privée (max. relevé)', cpu.map(sample => sample.chrome.privateBytes));
  maximum('GPU estimé : pic buffers', gpu.map(sample => sample.peakBufferBytes));
  maximum('GPU estimé : pic textures', gpu.map(sample => sample.peakTextureBytes));
  maximum('GPU estimé : pic total simultané', gpu.map(sample => sample.peakBytes));
  const unknownFormats = [...new Set(gpu.flatMap(sample => sample.unknownFormats))];
  if (unknownFormats.length) memoryRows.push(['GPU formats non comptabilisés', unknownFormats.join(', ')]);
  const labelWidth = Math.max('Mémoire'.length, ...memoryRows.map(([label]) => label.length));
  const valueWidth = Math.max('Valeur'.length, ...memoryRows.map(([, value]) => value.length));
  return timingTable + '\n\n' + [
    `| ${'Mémoire'.padEnd(labelWidth)} | ${'Valeur'.padStart(valueWidth)} |`,
    `| ${'-'.repeat(labelWidth)} | ${'-'.repeat(valueWidth)} |`,
    ...memoryRows.map(([label, value]) => `| ${label.padEnd(labelWidth)} | ${value.padStart(valueWidth)} |`),
  ].join('\n');
}
