import { describe, it, expect, vi } from 'vitest';
import {
  MaterialXLibraries,
  defaultLibrarySources,
  MATERIALX_DEFAULT_LIBRARY_FILES,
} from '../../src/materialx/libraries.ts';
import { MaterialXCore, type MaterialXCoreModule, type MxDocument } from '../../src/materialx/wasm.ts';

function makeDoc(valid = true): MxDocument {
  return {
    getName: () => 'doc',
    getNamePath: () => '/doc',
    validate: () => valid,
    importLibrary: vi.fn(),
    delete: vi.fn(),
  };
}

function makeCore(doc: MxDocument, read = vi.fn()): { core: MaterialXCore; read: ReturnType<typeof vi.fn> } {
  const module = {
    createDocument: vi.fn(() => doc),
    readFromXmlString: read,
  } as unknown as MaterialXCoreModule;
  return { core: new MaterialXCore(module), read };
}

describe('defaultLibrarySources', () => {
  it('builds URLs from a root and strips trailing slashes', () => {
    const sources = defaultLibrarySources('https://cdn/libraries/', ['stdlib/stdlib_defs.mtlx']);
    expect(sources).toEqual([{ name: 'stdlib/stdlib_defs.mtlx', url: 'https://cdn/libraries/stdlib/stdlib_defs.mtlx' }]);
  });

  it('excludes per-backend gen*_impl shader files by default', () => {
    expect(MATERIALX_DEFAULT_LIBRARY_FILES.some((f) => f.includes('_impl.mtlx'))).toBe(false);
    expect(MATERIALX_DEFAULT_LIBRARY_FILES).toContain('stdlib/stdlib_defs.mtlx');
    expect(MATERIALX_DEFAULT_LIBRARY_FILES).toContain('bxdf/open_pbr_surface.mtlx');
  });
});

describe('MaterialXLibraries', () => {
  it('reads every source into one document in order and memoizes', async () => {
    const doc = makeDoc();
    const { core, read } = makeCore(doc);
    const libs = new MaterialXLibraries(core);
    const fetchText = vi.fn(async (url: string) => `<xml url="${url}"/>`);
    const sources = defaultLibrarySources('https://cdn/lib', ['a.mtlx', 'b.mtlx']);

    const result = await libs.load({ sources, fetchText });
    expect(result).toBe(doc);
    expect(read).toHaveBeenCalledTimes(2);
    expect(fetchText.mock.calls.map((c) => c[0])).toEqual([
      'https://cdn/lib/a.mtlx',
      'https://cdn/lib/b.mtlx',
    ]);

    const again = await libs.load({ sources, fetchText });
    expect(again).toBe(doc);
    expect(read).toHaveBeenCalledTimes(2); // memoized, not re-read
  });

  it('imports the loaded library into a content document', async () => {
    const doc = makeDoc();
    const { core } = makeCore(doc);
    const libs = new MaterialXLibraries(core);
    await libs.load({ sources: [{ name: 'a', url: 'a' }], fetchText: async () => '<xml/>' });
    const content = makeDoc();
    libs.importInto(content);
    expect(content.importLibrary).toHaveBeenCalledWith(doc);
  });

  it('throws if importInto is called before load', () => {
    const { core } = makeCore(makeDoc());
    const libs = new MaterialXLibraries(core);
    expect(() => libs.importInto(makeDoc())).toThrow();
  });

  it('deletes the document and diagnoses on fetch failure', async () => {
    const doc = makeDoc();
    const { core } = makeCore(doc);
    const onDiagnostic = vi.fn();
    const libs = new MaterialXLibraries(core);
    await expect(
      libs.load({
        sources: [{ name: 'a', url: 'a' }],
        fetchText: async () => {
          throw new Error('404');
        },
        onDiagnostic,
      }),
    ).rejects.toThrow('404');
    expect(doc.delete).toHaveBeenCalled();
    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });

  it('aborts cleanly when the signal is already aborted', async () => {
    const doc = makeDoc();
    const { core } = makeCore(doc);
    const libs = new MaterialXLibraries(core);
    await expect(
      libs.load({
        sources: [{ name: 'a', url: 'a' }],
        fetchText: async () => '<xml/>',
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
