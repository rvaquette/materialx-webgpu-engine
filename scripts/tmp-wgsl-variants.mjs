// Temporary: write WGSL variants with stubbed function bodies.
// node scripts/tmp-wgsl-variants.mjs <in.wgsl> <outDir> name=stub ...  (stub is the new body)
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function stub(code, name, body) {
  const start = code.indexOf(`fn ${name}(`);
  if (start < 0) throw new Error(`missing fn ${name}`);
  const open = code.indexOf('{', code.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) return `${code.slice(0, open)}{ ${body} }${code.slice(i + 1)}`;
  }
  throw new Error(`unbalanced fn ${name}`);
}

const [input, outDir, ...specs] = process.argv.slice(2);
const code = await readFile(input, 'utf8');
await mkdir(outDir, { recursive: true });
for (const spec of specs) {
  const [label, ...pairs] = spec.split('|');
  let variant = code;
  for (const pair of pairs) {
    const index = pair.indexOf('=');
    variant = stub(variant, pair.slice(0, index), pair.slice(index + 1));
  }
  await writeFile(join(outDir, `${label}.wgsl`), variant);
  console.log(join(outDir, `${label}.wgsl`));
}
