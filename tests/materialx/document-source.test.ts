// T057m3a: loadMaterialXDocuments bridges createGraphMaterialCompiler onto real
// MaterialX Core documents. These tests drive it with a fake MaterialXCore and a
// stub library importer, verifying asset-path keying, library import, read-failure
// handling, and document release.

import { describe, it, expect, vi } from 'vitest';
import { MaterialXCore, type MaterialXCoreModule, type MxDocument } from '../../src/materialx/wasm.ts';
import {
  loadMaterialXDocuments,
  type DocumentLibraryImporter,
} from '../../src/materialx/document-source.ts';
import type { MaterialCompileUnit } from '../../src/usd/materials.ts';

function makeDoc(): MxDocument {
  return {
    getName: () => 'doc',
    getNamePath: () => '/doc',
    validate: () => true,
    importLibrary: vi.fn(),
    delete: vi.fn(),
  };
}

function makeModule(overrides: Partial<MaterialXCoreModule> = {}): MaterialXCoreModule {
  return {
    createDocument: vi.fn(() => makeDoc()),
    readFromXmlString: vi.fn(),
    ...overrides,
  } as MaterialXCoreModule;
}

function unit(assetPath: string, materialName = 'M'): MaterialCompileUnit {
  return { assetPath, referencedPrimPath: '/root', materialName, boundPrims: [] };
}

describe('loadMaterialXDocuments', () => {
  it('reads each asset into a library-imported document keyed by asset path', async () => {
    const module = makeModule();
    const core = new MaterialXCore(module);
    const libraries: DocumentLibraryImporter = { importInto: vi.fn() };
    const texts = new Map([
      ['a.mtlx', '<materialx/>'],
      ['b.mtlx', '<materialx/>'],
    ]);

    const source = await loadMaterialXDocuments({ core, libraries, texts, searchPath: '/libs' });

    expect(module.createDocument).toHaveBeenCalledTimes(2);
    expect(module.readFromXmlString).toHaveBeenCalledTimes(2);
    expect(libraries.importInto).toHaveBeenCalledTimes(2);
    expect(source.documentFor(unit('a.mtlx'))).toBeDefined();
    expect(source.documentFor(unit('b.mtlx'))).toBeDefined();
    expect(source.documentFor(unit('a.mtlx'))).not.toBe(source.documentFor(unit('b.mtlx')));
  });

  it('returns undefined for an unknown asset path', async () => {
    const core = new MaterialXCore(makeModule());
    const source = await loadMaterialXDocuments({
      core,
      libraries: { importInto: vi.fn() },
      texts: new Map([['a.mtlx', '<materialx/>']]),
    });
    expect(source.documentFor(unit('missing.mtlx'))).toBeUndefined();
  });

  it('drops and releases a document whose XML fails to read', async () => {
    const released = makeDoc();
    const module = makeModule({
      createDocument: vi.fn(() => released),
      readFromXmlString: vi.fn(() => {
        throw new Error('bad xml');
      }),
    });
    const core = new MaterialXCore(module);
    const diagnostics: string[] = [];
    const source = await loadMaterialXDocuments({
      core,
      libraries: { importInto: vi.fn() },
      texts: new Map([['a.mtlx', '<broken']]),
      sink: (d) => diagnostics.push(d.message),
    });

    expect(source.documentFor(unit('a.mtlx'))).toBeUndefined();
    expect(released.delete).toHaveBeenCalledTimes(1);
    expect(diagnostics.some((m) => m.includes('a.mtlx'))).toBe(true);
  });

  it('releases every loaded document on delete', async () => {
    const docs = [makeDoc(), makeDoc()];
    let i = 0;
    const module = makeModule({ createDocument: vi.fn(() => docs[i++]!) });
    const core = new MaterialXCore(module);
    const source = await loadMaterialXDocuments({
      core,
      libraries: { importInto: vi.fn() },
      texts: new Map([
        ['a.mtlx', '<materialx/>'],
        ['b.mtlx', '<materialx/>'],
      ]),
    });

    source.delete();

    expect(docs[0]!.delete).toHaveBeenCalledTimes(1);
    expect(docs[1]!.delete).toHaveBeenCalledTimes(1);
    expect(source.documentFor(unit('a.mtlx'))).toBeUndefined();
  });
});
