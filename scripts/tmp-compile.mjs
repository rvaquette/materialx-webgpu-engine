import { openExportSession } from './export-browser-session.mjs';
const variants = {
  viewer:      { environment: true, displayAovs: true, analyticLights: true, opaque: true, pruneUnusedFunctions: true },
  noAovs:      { environment: true, displayAovs: false, analyticLights: true, opaque: true, pruneUnusedFunctions: true },
  noEnv:       { environment: false, displayAovs: true, analyticLights: true, opaque: true, pruneUnusedFunctions: true },
  noLights:    { environment: true, displayAovs: true, analyticLights: false, opaque: true, pruneUnusedFunctions: true },
  lobes2:      { environment: true, displayAovs: true, analyticLights: true, opaque: true, pruneUnusedFunctions: true, maxLobes: 2 },
  notOpaque:   { environment: true, displayAovs: true, analyticLights: true, opaque: false, pruneUnusedFunctions: true },
  minimal:     { environment: false, displayAovs: false, analyticLights: false, opaque: true, pruneUnusedFunctions: true, maxLobes: 2 },
};
for (const [name, options] of Object.entries(variants)) {
  const session = await openExportSession({ label: 'compile', browserModule: '/scripts/tmp-compile-browser.ts', quiet: true, browserArgs: ['--force_high_performance_gpu'] });
  try {
    const r = await session.call('compileKernel', [options], 600000);
    console.log(`${name.padEnd(10)} ${String(r.bytes).padStart(7)} B ${String(Math.round(r.ms)).padStart(7)} ms`);
  } catch (e) { console.log(`${name} error ${e.message.split('\n').slice(0,3).join(' | ')}`); }
  finally { await session.close(); }
}
