// Compiles every catalog scene and MaterialX library material into scenes/compiled
// (see src/scene/compiled-paths.ts), skipping those whose binaries already exist,
// and writes the USDA wrapper layers that reference the compiled scene and shader binaries.
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { findEmptyCompiledBuffer } from './compiled-buffer-check.mjs';
import { openExportSession, root } from './export-browser-session.mjs';
import { renameWithRetry } from './rename-with-retry.mjs';
import { shareSceneBuffers, sharedPackSize } from './shared-buffers.mjs';
import {
  compiledMaterialDirectory, compiledSceneDirectory, compiledSharedBuffersDirectory, compiledWrapperLayer, compiledWrapperPath,
} from '../src/scene/compiled-paths.ts';

const usage = `Usage: npm run compile:scenes -- [options]
Compiles the scene catalog and scenes/mtlx-library into scenes/compiled, skipping
scenes whose scene.json/shaders.wgsl.zst and materials whose material.json already exist.
Unexpectedly empty buffer files are recompiled; empty shared packs are reported as errors.
Each compiled scene gets a USDA wrapper layer (scenes/compiled/<scene>.usda) shown in the UI.
Scenes of a shared group (scenes/lama) pool their buffers into one deduplicated, append-only
pack (scenes/compiled/lama/_shared/buffers.bin.zst); already compiled scenes are migrated to it.
Options:
  --scenes-only | --materials-only   restrict the batch
  --filter <text>                    only sources whose path contains <text> (repeatable)
  --force                            recompile even when binaries exist
  --compression-level 1..22          Zstandard level (default 19)
  --timeout <ms>                     per item (default 1800000)
  --restart-every <n>                fresh browser every n compilations (default 20)
  --dry-run                          list the work without compiling
Requires Node.js >=22 and Chrome/Edge (MX_CHROME overrides its executable).`;

const projectPath = path => join(root, ...path.split('/'));

/** Writes a package through a sibling temporary directory so partial output never looks compiled. */
async function writeAtomically(session, result, directory, manifest, generatedFrom, sharedBuffers) {
  const out = projectPath(directory);
  const staging = `${out}.partial`;
  await rm(staging, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  await session.writePackage(result, staging, manifest, generatedFrom);
  if (sharedBuffers) await shareSceneBuffers(staging, projectPath(sharedBuffers));
  await rm(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  await renameWithRetry(staging, out);
}

async function writeWrapper(source) {
  const target = projectPath(compiledWrapperPath(source));
  const text = compiledWrapperLayer(source);
  if (existsSync(target) && await readFile(target, 'utf8') === text) return false;
  await writeFile(target, text);
  return true;
}

async function main() {
  const { values } = parseArgs({ options: {
    help: { type: 'boolean', short: 'h' },
    'scenes-only': { type: 'boolean' }, 'materials-only': { type: 'boolean' },
    filter: { type: 'string', multiple: true }, force: { type: 'boolean' }, 'dry-run': { type: 'boolean' },
    'compression-level': { type: 'string', default: '19' },
    timeout: { type: 'string', default: '1800000' },
    'restart-every': { type: 'string', default: '20' },
  } });
  if (values.help) { console.log(usage); return; }
  const compressionLevel = Number(values['compression-level']);
  const timeout = Number(values.timeout);
  const restartEvery = Number(values['restart-every']);
  if (!Number.isInteger(compressionLevel) || compressionLevel < 1 || compressionLevel > 22) throw new Error('--compression-level must be an integer between 1 and 22.');
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2147483647) throw new Error('--timeout must be a positive integer no greater than 2147483647.');
  if (!Number.isInteger(restartEvery) || restartEvery < 1) throw new Error('--restart-every must be a positive integer.');
  if (values['scenes-only'] && values['materials-only']) throw new Error('--scenes-only and --materials-only are exclusive.');
  const filters = values.filter ?? [];
  const selected = path => !filters.length || filters.some(filter => path.toLowerCase().includes(filter.toLowerCase()));

  const session = await openExportSession({ label: 'compile-browser', quiet: true });
  const failures = [];
  const counts = { scenes: 0, materials: 0, skipped: 0, noMaterial: 0, wrappers: 0, pooled: 0 };
  const sharedGroups = new Set();
  let compilations = 0;
  const checkBuffers = async (label, directory, manifestName, sharedBuffers) => {
    try {
      const empty = await findEmptyCompiledBuffer(projectPath(directory), manifestName,
        sharedBuffers ? projectPath(sharedBuffers) : undefined);
      if (empty?.shared) throw new Error(`Shared buffer is empty: ${empty.path}. Rebuild the shared group before compiling.`);
      if (empty) console.log(`[compile-scenes] Recompiling ${label}: empty buffer ${empty.path}`);
      return { empty: !!empty };
    } catch (error) {
      failures.push({ label, error });
      console.error(`[compile-scenes] FAILED ${label}: ${error.message.split('\n')[0]}`);
      return undefined;
    }
  };
  const run = async (label, task) => {
    if (compilations > 0 && (compilations % restartEvery === 0 || !session.alive)) await session.restart();
    compilations++;
    const started = Date.now();
    try {
      const result = await task();
      console.log(`[compile-scenes] ${label} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
      return result;
    } catch (error) {
      failures.push({ label, error });
      console.error(`[compile-scenes] FAILED ${label}: ${error.message.split('\n')[0]}`);
      if (!session.alive) await session.restart();
      return undefined;
    }
  };
  try {
    const sources = await session.call('listSources');
    const scenes = values['materials-only'] ? [] : sources.scenes.filter(selected);
    const materials = values['scenes-only'] ? [] : sources.materials.filter(selected);
    console.log(`[compile-scenes] ${scenes.length} scenes, ${materials.length} materials (Zstandard level ${compressionLevel}).`);

    for (const [index, source] of scenes.entries()) {
      const directory = compiledSceneDirectory(source);
      const sharedBuffers = compiledSharedBuffersDirectory(source);
      const label = `[scene ${index + 1}/${scenes.length}] ${source}`;
      const compiled = ['scene.json', 'shaders.wgsl.zst'].some(file => existsSync(projectPath(`${directory}/${file}`)));
      const buffers = compiled ? await checkBuffers(label, directory, 'scene.json', sharedBuffers) : { empty: false };
      if (!buffers) continue;
      if (compiled && !values.force && !buffers.empty) {
        counts.skipped++;
        // Pool the buffers of scenes compiled before their group was shared.
        if (sharedBuffers && !values['dry-run'] && existsSync(projectPath(`${directory}/buffers.bin.zst`))) {
          try {
            await shareSceneBuffers(projectPath(directory), projectPath(sharedBuffers));
            counts.pooled++;
          } catch (error) {
            failures.push({ label, error });
            console.error(`[compile-scenes] FAILED pooling ${label}: ${error.message}`);
            continue;
          }
        }
      }
      else if (values['dry-run']) { console.log(`[compile-scenes] would compile ${label}`); continue; }
      else {
        const ok = await run(label, async () => {
          const result = await session.call('compileScene', [session.url(source), compressionLevel], timeout);
          await writeAtomically(session, result, directory, 'scene.json', source, sharedBuffers);
          return true;
        });
        if (!ok) continue;
        counts.scenes++;
      }
      if (sharedBuffers) sharedGroups.add(sharedBuffers);
      if (!values['dry-run'] && existsSync(projectPath(`${directory}/scene.json`)) && await writeWrapper(source)) counts.wrappers++;
    }

    const probe = session.url('scripts/material-probe.usda');
    for (const [index, source] of materials.entries()) {
      const directory = compiledMaterialDirectory(source);
      const label = `[material ${index + 1}/${materials.length}] ${source}`;
      const compiled = existsSync(projectPath(`${directory}/material.json`));
      const buffers = compiled ? await checkBuffers(label, directory, 'material.json') : { empty: false };
      if (!buffers) continue;
      if (compiled && !values.force && !buffers.empty) { counts.skipped++; continue; }
      if (!/<surfacematerial\b/.test(await readFile(projectPath(source), 'utf8'))) { counts.noMaterial++; continue; }
      if (values['dry-run']) { console.log(`[compile-scenes] would compile ${label}`); continue; }
      const ok = await run(label, async () => {
        const result = await session.call('compileMaterial', [session.url(source), probe, compressionLevel], timeout);
        if (!result) throw new Error('No surfacematerial found.');
        await writeAtomically(session, result, directory, 'material.json', source);
        return true;
      });
      if (ok) counts.materials++;
    }
  } finally {
    await session.close();
  }
  console.log(`[compile-scenes] Compiled ${counts.scenes} scenes and ${counts.materials} materials; ` +
    `${counts.wrappers} wrapper layers written; ${counts.skipped} already compiled; ` +
    `${counts.pooled} existing scenes moved to shared buffers; ` +
    `${counts.noMaterial} documents without surfacematerial; ${failures.length} failures.`);
  for (const group of sharedGroups) {
    console.log(`[compile-scenes] Shared buffers ${group}/buffers.bin.zst: ${((await sharedPackSize(projectPath(group))) / 1048576).toFixed(1)} MiB.`);
  }
  for (const { label, error } of failures) console.error(`  - ${label}: ${error.message.split('\n')[0]}`);
  if (failures.length) process.exitCode = 1;
}

main().catch(error => { console.error(`[compile-scenes] ${error.message}`); process.exitCode = 1; });
