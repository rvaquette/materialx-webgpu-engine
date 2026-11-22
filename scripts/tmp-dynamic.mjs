// Diagnosis only (deleted before commit): node scripts/tmp-dynamic.mjs [materials|rebuild] scene.usda
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openExportSession } from './export-browser-session.mjs';

const [mode, scene] = process.argv.slice(2);
const session = await openExportSession({
  label: 'dynamic', browserModule: '/scripts/tmp-dynamic-browser.ts', quiet: true, browserArgs: ['--force_high_performance_gpu'],
});
try {
  const result = await session.call(mode === 'rebuild' ? 'checkRebuild' : 'checkMaterials', [session.url(scene)], 60 * 60 * 1000);
  if (result.images) {
    await mkdir('bench-results/dynamic', { recursive: true });
    for (const [name, data] of Object.entries(result.images)) await writeFile(join('bench-results/dynamic', `${name}.png`), Buffer.from(data, 'base64'));
    delete result.images;
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  await session.close();
}
