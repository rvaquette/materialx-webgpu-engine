import { openExportSession } from './export-browser-session.mjs';
const [fn, ...args] = process.argv.slice(2);
const session = await openExportSession({ label: 'p7', browserModule: '/scripts/tmp-p7-browser.ts', quiet: true, browserArgs: process.env.MX_DEFAULT_GPU ? [] : ['--force_high_performance_gpu'] });
try {
  const parsed = args.map(a => /^\d+(\.\d+)?$/.test(a) ? Number(a) : a.endsWith('.usda') ? session.url(a) : a);
  const r = await session.call(fn, parsed, 30 * 60 * 1000);
  console.log(JSON.stringify(r, null, 1));
} finally { await session.close(); }
