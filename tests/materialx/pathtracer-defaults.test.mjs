import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MaterialXCore } from '../../src/materialx/wasm.ts';
import { MaterialXLibraries, defaultLibrarySources } from '../../src/materialx/libraries.ts';
import { loadMaterialXDocuments } from '../../src/materialx/document-source.ts';
import { createGraphMaterialCompiler } from '../../src/render/graph-material-compiler.ts';
import { defaultLibraryRoot, surfaceDefaults, simplifyMaterialXml } from '../../scripts/simplify-pathtracer-materials.mjs';

const coreFile = join(process.env.MX_CORE_DIR
  ?? 'D:\\WebGL2\\MaterialX\\MaterialX-rva\\javascript\\build\\installed\\JavaScript\\MaterialX', 'JsMaterialXCore.js');

describe.skipIf(!existsSync(coreFile) || !existsSync(defaultLibraryRoot))('Pathtracer default shader equivalence', () => {
  it('produces identical WGSL and bindings with explicit or omitted surface defaults throughout the corpus', async () => {
    const factory = (await import(/* @vite-ignore */ pathToFileURL(coreFile).href)).default;
    const core = new MaterialXCore(await factory());
    const libraries = new MaterialXLibraries(core);
    await libraries.load({
      sources: defaultLibrarySources(defaultLibraryRoot),
      fetchText: async path => readFileSync(path, 'utf8'),
    });
    const defaults = surfaceDefaults(defaultLibraryRoot);
    const root = join('scenes', 'pathtracer');
    const texts = new Map();
    const bindings = [];
    for (const file of readdirSync(root).filter(file => file.endsWith('.mtlx'))) {
      const original = readFileSync(join(root, file), 'utf8');
      // Re-author defaults as well, so this regression remains useful after --apply.
      const explicit = original.replace(/<(standard_surface|open_pbr_surface)\b([^>]*)>([\s\S]*?)<\/\1>/g,
        (element, family, attributes, body) => {
          if (/\b(version|nodedef)="/.test(attributes)) return element;
          const names = new Set([...body.matchAll(/<input\b[^>]*\bname="([^"]+)"/g)].map(match => match[1]));
          const extra = [...defaults.get(family)].filter(([name]) => !names.has(name))
            .map(([name, input]) => `    <input name="${name}" type="${input.type}" value="${input.value}" />\n`).join('');
          return `<${family}${attributes}>${body}${extra}</${family}>`;
        });
      texts.set(`${file}:explicit`, explicit);
      texts.set(`${file}:compact`, simplifyMaterialXml(original, defaults).text);
      for (const match of original.matchAll(/<surfacematerial\b[^>]*name="([^"]+)"/g)) {
        bindings.push({ file, materialName: match[1] });
      }
    }
    const diagnostics = [];
    const documents = await loadMaterialXDocuments({ core, libraries, texts, sink: d => diagnostics.push(d) });
    try {
      const compiler = createGraphMaterialCompiler({ documents, sink: d => diagnostics.push(d) });
      for (const { file, materialName } of bindings) {
        const unit = { materialName, referencedPrimPath: `/MaterialX/Materials/${materialName}`, boundPrims: [] };
        const explicit = await compiler.compile({ ...unit, assetPath: `${file}:explicit` });
        const compact = await compiler.compile({ ...unit, assetPath: `${file}:compact` });
        expect(explicit?.layered, `${file}/${materialName}`).toBeDefined();
        expect(compact?.layered, `${file}/${materialName}`).toEqual(explicit.layered);
        expect(compact?.module, `${file}/${materialName}`).toEqual(explicit.module);
      }
      expect(bindings.length).toBeGreaterThanOrEqual(294);
      expect(diagnostics).toEqual([]);
    } finally {
      documents.delete();
      libraries.delete();
    }
  }, 120000);
});
