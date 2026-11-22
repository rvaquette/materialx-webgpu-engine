// Streaming benchmark: for each scene, a cold load (fresh browser profile: no
// geometry, BVH or shader caches) then a warm load in the same browser, with and
// without streaming. Reports the load time and the time to the first displayed
// image (streaming preview or complete scene).
//
//   node scripts/bench-streaming.mjs [--scene path.usda ...] [--modes stream,complete] [--out file.json]
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { openExportSession } from './export-browser-session.mjs';
import { DEFAULT_SCENES } from './bench-engine.mjs';

const { values } = parseArgs({ options: {
  scene: { type: 'string', multiple: true },
  modes: { type: 'string', default: 'complete,stream' },
  out: { type: 'string' },
} });
const scenes = values.scene?.length ? values.scene : DEFAULT_SCENES;
const modes = values.modes.split(',');
const rows = [];
for (const scene of scenes) {
  for (const mode of modes) {
    const session = await openExportSession({
      label: 'bench-streaming', browserModule: '/scripts/bench-streaming-browser.ts', quiet: true,
      browserArgs: process.env.MX_DEFAULT_GPU ? [] : ['--force_high_performance_gpu'],
    });
    try {
      const [cold, warm] = await session.call('measureLoad', [session.url(scene), mode === 'stream', 2], 30 * 60 * 1000);
      const row = { scene, mode, cold, warm };
      rows.push(row);
      const format = run => `load ${(run.load / 1000).toFixed(2)} s, first image ${(run.firstImage / 1000).toFixed(2)} s (${run.stages.join(' > ')})`;
      console.log(`${scene} [${mode}] cold: ${format(cold)}; warm: ${format(warm)}`);
    } finally {
      await session.close();
    }
  }
}
if (values.out) await writeFile(values.out, `${JSON.stringify(rows, null, 2)}\n`);
