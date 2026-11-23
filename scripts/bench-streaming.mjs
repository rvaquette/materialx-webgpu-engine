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
  repeat: { type: 'string', default: '1' },
  out: { type: 'string' },
} });
const scenes = values.scene?.length ? values.scene : DEFAULT_SCENES;
const modes = values.modes.split(',');
const rows = [];
const median = values => [...values].sort((a, b) => a - b)[values.length >> 1];
for (const scene of scenes) {
  for (let repeat = 0; repeat < Number(values.repeat); repeat++) for (const mode of modes) {
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
    } catch (error) {
      console.log(`${scene} [${mode}] failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    } finally {
      await session.close();
    }
  }
}
if (Number(values.repeat) > 1) {
  console.log('\n| Scene | Mode | Cold load (s) | Cold first image (s) | Warm load (s) | Warm first image (s) |');
  console.log('|---|---|---:|---:|---:|---:|');
  for (const scene of scenes) for (const mode of modes) {
    const runs = rows.filter(row => row.scene === scene && row.mode === mode);
    if (!runs.length) continue;
    const cell = (kind, field) => (median(runs.map(row => row[kind][field])) / 1000).toFixed(2);
    console.log(`| ${scene} | ${mode} | ${cell('cold', 'load')} | ${cell('cold', 'firstImage')} | ${cell('warm', 'load')} | ${cell('warm', 'firstImage')} |`);
  }
}
if (values.out) await writeFile(values.out, `${JSON.stringify(rows, null, 2)}\n`);
