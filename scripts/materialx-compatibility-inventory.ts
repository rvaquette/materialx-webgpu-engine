import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { ENGINE_SHADER_LIBRARY_XML } from '../src/materialx/engine-shaders.ts';
import { SCRIPT_LIBRARY_FILES, ScriptLibrary } from '../src/materialx/script-api.ts';

const root = process.argv[2] ?? process.env['MX_LIB_ROOT'];
if (!root) throw new Error('Provide the MaterialX libraries directory as an argument or MX_LIB_ROOT.');
const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (commit !== 'bea1e9251d8f936a73930ad19a6f3b37265d46f5') {
  throw new Error(`Expected MaterialX 1.39.6 at bea1e925; found ${commit}.`);
}
const changes = execFileSync('git', ['-C', root, 'status', '--porcelain', '--', '.'], { encoding: 'utf8' }).trim();
if (changes) throw new Error('MaterialX libraries have local changes; use a clean checkout.');

const sources = SCRIPT_LIBRARY_FILES.map(file => readFileSync(join(root, file), 'utf8'));
const library = ScriptLibrary.fromXml([...sources, ENGINE_SHADER_LIBRARY_XML]);
const extensions = ScriptLibrary.fromXml([ENGINE_SHADER_LIBRARY_XML]);
const engineNames = new Set(extensions.classNames.flatMap(className => {
  const category = extensions.categoryOf(className);
  if (!category) throw new Error(`Missing category for ${className}.`);
  return extensions.variants(category).map(def => def.name);
}));
const definitions = library.classNames.flatMap(className => {
  const category = library.categoryOf(className);
  if (!category) throw new Error(`Missing category for ${className}.`);
  return library.variants(category).map(def => ({
    origin: engineNames.has(def.name) ? 'engine' : 'library',
    category, class: className, nodedef: def.name,
    inputs: def.inputs.map(input => ({
      name: input.name, type: input.type,
      ...(input.default !== undefined ? { default: input.default } : {}),
    })),
    outputs: def.outputs.map(output => ({ name: output.name, type: output.type })),
  }));
});
const output = {
  reference: 'MaterialX 1.39.6 / bea1e9251d8f936a73930ad19a6f3b37265d46f5',
  scope: 'Selectable default-version script NodeDefs; not an implementation or conformance claim.',
  files: SCRIPT_LIBRARY_FILES,
  definitions,
};
const file = resolve('docs', 'generated', 'materialx-nodedefs.json');
writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${output.definitions.length} selectable NodeDefs to ${file}.`);
