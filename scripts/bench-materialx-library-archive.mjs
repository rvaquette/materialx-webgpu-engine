import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { strFromU8, strToU8, unzipSync, zipSync } from 'three/addons/libs/fflate.module.js';

const root = process.env.MX_LIB_ROOT ?? 'D:/WebGL2/MaterialX/MaterialX-rva/libraries';
const coreRoot = process.env.MX_CORE_DIR
  ?? 'D:/WebGL2/MaterialX/MaterialX-rva/javascript/build/installed/JavaScript/MaterialX';
const files = JSON.parse(readFileSync(new URL('../src/materialx/default-library-files.json', import.meta.url), 'utf8'));
const sourceTexts = new Map(files.map(file => [file, readFileSync(join(root, file), 'utf8')]));
const sourceBytes = [...sourceTexts.values()].reduce((sum, text) => sum + Buffer.byteLength(text), 0);

const zipStart = performance.now();
const archive = zipSync(Object.fromEntries(
  [...sourceTexts].map(([file, text]) => [file, strToU8(text)]),
), { level: 6 });
const zipMs = performance.now() - zipStart;

const unzipStart = performance.now();
const unpacked = unzipSync(archive);
const archiveTexts = new Map(Object.entries(unpacked).map(([file, bytes]) => [file, strFromU8(bytes)]));
const unzipMs = performance.now() - unzipStart;
if (archiveTexts.size !== sourceTexts.size) throw new Error('Archive changed the library file count.');
for (const [file, text] of sourceTexts) {
  if (archiveTexts.get(file) !== text) throw new Error(`Archive round-trip mismatch: ${file}`);
}

const coreModuleUrl = pathToFileURL(join(coreRoot, 'JsMaterialXCore.js')).href;
const coreInitStart = performance.now();
const coreModule = await import(coreModuleUrl);
const mx = await coreModule.default();
const coreInitMs = performance.now() - coreInitStart;

async function parseAndValidate(texts) {
  const document = mx.createDocument();
  const start = performance.now();
  try {
    for (const xml of texts.values()) {
      const options = mx.XmlReadOptions ? new mx.XmlReadOptions() : undefined;
      if (options) options.readXIncludes = true;
      try {
        await mx.readFromXmlString(document, xml, root, options ?? null);
      } finally {
        options?.delete();
      }
    }
    if (!document.validate()) throw new Error('MaterialX library document failed validation.');
    return performance.now() - start;
  } finally {
    document.delete();
  }
}

await parseAndValidate(sourceTexts);
await parseAndValidate(archiveTexts);
const directParseTimes = [];
const archiveParseTimes = [];
for (let i = 0; i < 3; i++) {
  directParseTimes.push(await parseAndValidate(sourceTexts));
  archiveParseTimes.push(await parseAndValidate(archiveTexts));
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const coreWasmBytes = statSync(join(coreRoot, 'JsMaterialXCore.wasm')).size;
const coreJsBytes = statSync(join(coreRoot, 'JsMaterialXCore.js')).size;

console.log(JSON.stringify({
  files: sourceTexts.size,
  sourceBytes,
  archiveBytes: archive.byteLength,
  archiveRatio: Number((archive.byteLength / sourceBytes).toFixed(3)),
  zipMs: Number(zipMs.toFixed(2)),
  unzipMs: Number(unzipMs.toFixed(2)),
  coreInitMs: Number(coreInitMs.toFixed(2)),
  parseRounds: directParseTimes.length,
  directParseAndValidateMedianMs: Number(median(directParseTimes).toFixed(2)),
  archiveParseAndValidateMedianMs: Number(median(archiveParseTimes).toFixed(2)),
  coreJsBytes,
  coreWasmBytes,
}, null, 2));
