import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { openExportSession, root } from './export-browser-session.mjs';

async function main() {
  const { values } = parseArgs({ options: {
    entry: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    'compression-level': { type: 'string', default: '22' },
    timeout: { type: 'string', default: '1800000' },
  } });
  if (values.help) {
    console.log('Usage: npm run export:scene -- --entry scenes\\pathtracer\\volume_cube.usda --out scenes\\compiled\\volume_cube\n' +
      'Requires Node.js >=22 and Chrome/Edge (MX_CHROME overrides its executable).\n' +
      'Loads and compiles USD/USDA/USDC using the shared browser loaders, without opening the viewer UI.\n' +
      'Options: --compression-level 1..22 (default 22), --timeout milliseconds (default 1800000).\n' +
      'The output directory must be empty or absent. No source files are modified.\n' +
      'To compile every catalog scene and library material with their wrapper layers, use npm run compile:scenes.');
    return;
  }
  if (!values.entry || !values.out) throw new Error('Both --entry and --out are required. Use --help.');
  const compressionLevel = Number(values['compression-level']);
  const timeout = Number(values.timeout);
  if (!Number.isInteger(compressionLevel) || compressionLevel < 1 || compressionLevel > 22) throw new Error('--compression-level must be an integer between 1 and 22.');
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2147483647) throw new Error('--timeout must be a positive integer no greater than 2147483647.');
  const entry = resolve(values.entry);
  const entryRelative = relative(root, entry);
  if (entryRelative === '..' || entryRelative.startsWith(`..${sep}`) || isAbsolute(entryRelative) ||
      !/\.(usd|usda|usdc)$/i.test(entry) || !(await stat(entry)).isFile()) {
    throw new Error('The entry must be an existing USD/USDA/USDC file inside the project.');
  }
  const out = resolve(values.out);
  if (existsSync(out) && (await readdir(out)).length) throw new Error('Output directory is not empty. Choose a new directory.');

  const session = await openExportSession();
  try {
    const path = entryRelative.split(sep).join('/');
    console.log(`[export-scene] Compiling ${path} (Zstandard level ${compressionLevel})...`);
    const result = await session.call('compileScene', [session.url(path), compressionLevel], timeout);
    await session.writePackage(result, out, 'scene.json', path);
    console.log(`[export-scene] Exported ${result.files.length} payloads to ${join(out, 'scene.json')}`);
  } finally {
    await session.close();
  }
}

main().catch(error => { console.error(`[export-scene] ${error.message}`); process.exitCode = 1; });