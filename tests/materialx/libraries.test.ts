import { describe, it, expect, vi } from 'vitest';
import {
  MaterialXLibraries,
  defaultLibrarySources,
  MATERIALX_DEFAULT_LIBRARY_FILES,
  loadSharedMaterialXLibraries,
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
  it('fetches independent sources in parallel but reads XML in dependency order', async () => {
    const { core, read } = makeCore(makeDoc());
    const libs = new MaterialXLibraries(core);
    let resolveFirst!: (text: string) => void;
    const fetchText = vi.fn((url: string) => url === 'a'
      ? new Promise<string>((resolve) => { resolveFirst = resolve; })
      : Promise.resolve('<b/>'));
    const loading = libs.load({ sources: [{ name: 'a', url: 'a' }, { name: 'b', url: 'b' }], fetchText });
    expect(fetchText).toHaveBeenCalledTimes(2);
    expect(read).not.toHaveBeenCalled();
    resolveFirst('<a/>');
    await loading;
    expect(read.mock.calls.map((call) => call[1])).toEqual(['<a/>', '<b/>']);
  });

  it('shares libraries for the same Core and source URLs, including concurrent callers', async () => {
    const { core, read } = makeCore(makeDoc());
    const options = { sources: [{ name: 'a', url: 'a' }], fetchText: vi.fn(async () => '<a/>') };
    const [first, second] = await Promise.all([
      loadSharedMaterialXLibraries(core, options),
      loadSharedMaterialXLibraries(core, options),
    ]);
    expect(first).toBe(second);
    expect(await loadSharedMaterialXLibraries(core, options)).toBe(first);
    expect(options.fetchText).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('evicts failed shared loads so a subsequent scene can retry', async () => {
    const { core } = makeCore(makeDoc());
    const fetchText = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('<a/>');
    const options = { sources: [{ name: 'a', url: 'a' }], fetchText, onDiagnostic: vi.fn() };
    await expect(loadSharedMaterialXLibraries(core, options)).rejects.toThrow('offline');
    await expect(loadSharedMaterialXLibraries(core, options)).resolves.toBeInstanceOf(MaterialXLibraries);
    expect(fetchText).toHaveBeenCalledTimes(2);
  });
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

  it('renames colliding authored nodes and rewires their downstream ports before import', async () => {
    const doc = {
      ...makeDoc(),
      getChild: (name: string) => name === 'ND_colorcorrect_color3' ? { ...makeDoc(), getCategory: () => 'nodedef' } : null,
    };
    const { core } = makeCore(doc);
    const libs = new MaterialXLibraries(core);
    await libs.load({ sources: [{ name: 'a', url: 'a' }], fetchText: async () => '<xml/>' });
    const port = { setNodeName: vi.fn() };
    const node = {
      ...makeDoc(), getName: () => 'ND_colorcorrect_color3', setName: vi.fn(),
      getDownstreamPorts: () => [port],
    };
    const content = {
      ...makeDoc(), getNodes: () => [node],
      getChild: (name: string) => name === 'ND_colorcorrect_color3_content' ? makeDoc() : null,
    };
    libs.importInto(content);
    expect(node.setName).toHaveBeenCalledWith('ND_colorcorrect_color3_content1');
    expect(port.setNodeName).toHaveBeenCalledWith('ND_colorcorrect_color3_content1');
    expect(content.importLibrary).toHaveBeenCalledWith(doc);
  });

  it('declares inherited exporter image signatures when loading stdlib', async () => {
    const { core, read } = makeCore(makeDoc());
    const libs = new MaterialXLibraries(core);
    await libs.load({
      sources: defaultLibrarySources('/lib', ['stdlib/stdlib_defs.mtlx']),
      fetchText: async () => '<materialx/>',
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[1]![1]).toContain('inherit="ND_image_vector3"');
    expect(read.mock.calls[1]![1]).toContain('name="uvtiling" type="vector2"');
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
