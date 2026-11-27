import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { ENGINE_SHADER_LIBRARY_XML } from '../src/materialx/engine-shaders.ts';
import { SCRIPT_LIBRARY_FILES, ScriptLibrary } from '../src/materialx/script-api.ts';
import { SURFACE_IR_UPSTREAM } from '../src/compiler/surface-ir.ts';
import { COMPATIBILITY_CASES, compatibilityCase } from './materialx-compatibility-status.ts';
import { probeCpuValue } from './materialx-compatibility-cpu.ts';
import { probeDisneyDirect } from './materialx-compatibility-disney.ts';

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
const engineNames = new Set(extensions.namedDefinitions.map(def => def.name));
const definitions = library.namedDefinitions
  .filter(def => library.categoryOf(def.className) === def.category)
  .map(def => {
    const category = def.category;
    const className = def.className;
    const origin = engineNames.has(def.name) ? 'engine' : 'library';
    const probe = origin === 'engine'
      ? { status: 'not-tested', reason: 'engine extension' } as const
      : probeCpuValue({ ...def, nodedef: def.name });
    const disneyProbe = origin === 'engine'
      ? { status: 'not-tested', reason: 'engine extension' } as const
      : probeDisneyDirect(def);
    return {
      origin, category, class: className, nodedef: def.name,
      selectableBy: library.variants(category).some(variant => variant.name === def.name) ? 'variant' : 'name',
      inputs: def.inputs.map(input => ({
        name: input.name, type: input.type,
        ...(input.default !== undefined ? { default: input.default } : {}),
        ...(input.defaultGeomProp !== undefined ? { defaultGeomProp: input.defaultGeomProp } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.unitType !== undefined ? { unitType: input.unitType } : {}),
        ...(input.colorSpace !== undefined ? { colorSpace: input.colorSpace } : {}),
        ...(input.enum !== undefined ? { enum: input.enum } : {}),
      })),
      outputs: def.outputs.map(output => ({ name: output.name, type: output.type })),
      compatibility: compatibilityCase(def, origin, probe, disneyProbe),
      cpuProbe: probe,
      disneyProbe,
      surfaceValueCategoryRegistered: SURFACE_IR_UPSTREAM.has(category),
    };
  });
const output = {
  reference: 'MaterialX 1.39.6 / bea1e9251d8f936a73930ad19a6f3b37265d46f5',
  scope: 'Script NodeDefs addressable by name, including older versions; classifications are conditional, not a conformance claim.',
  files: SCRIPT_LIBRARY_FILES,
  compatibilityCases: COMPATIBILITY_CASES,
  definitions,
};
const file = resolve('docs', 'generated', 'materialx-nodedefs.json');
writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${output.definitions.length} selectable NodeDefs to ${file}.`);
