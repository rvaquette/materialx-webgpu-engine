import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadMaterialXCore,
  resetMaterialXCore,
  MaterialXCore,
  MaterialXError,
  type MaterialXCoreModule,
  type MxDocument,
  type MxReadOptions,
} from '../../src/materialx/wasm.ts';

function makeDoc(valid = true): MxDocument {
  return {
    getName: () => 'doc',
    getNamePath: () => '/doc',
    validate: () => valid,
    importLibrary: vi.fn(),
    delete: vi.fn(),
  };
}

function makeModule(overrides: Partial<MaterialXCoreModule> = {}): MaterialXCoreModule {
  const deletedOptions: MxReadOptions[] = [];
  class XmlReadOptions implements MxReadOptions {
    readXIncludes = true;
    delete = vi.fn(() => {
      deletedOptions.push(this);
    });
  }
  return {
    createDocument: vi.fn(() => makeDoc()),
    readFromXmlString: vi.fn(),
    XmlReadOptions,
    ...overrides,
  } as MaterialXCoreModule;
}

beforeEach(() => resetMaterialXCore());

describe('loadMaterialXCore', () => {
  it('instantiates via an injected factory and memoizes', async () => {
    const module = makeModule();
    const factory = vi.fn(async () => module);
    const a = await loadMaterialXCore({ factory });
    const b = await loadMaterialXCore({ factory });
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(MaterialXCore);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('passes locateFile to the factory', async () => {
    const module = makeModule();
    const factory = vi.fn(async () => module);
    const locateFile = (p: string) => `/wasm/${p}`;
    await loadMaterialXCore({ factory, locateFile });
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ locateFile }));
  });

  it('throws when neither factory nor moduleUrl is provided', async () => {
    await expect(loadMaterialXCore({})).rejects.toBeInstanceOf(MaterialXError);
  });

  it('allows retry after a failed load', async () => {
    const bad = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(loadMaterialXCore({ factory: bad })).rejects.toThrow('boom');
    const module = makeModule();
    const good = vi.fn(async () => module);
    await expect(loadMaterialXCore({ factory: good })).resolves.toBeInstanceOf(MaterialXCore);
  });
});

describe('MaterialXCore', () => {
  it('reads XML with search path and read options, then releases options', async () => {
    const module = makeModule();
    const core = new MaterialXCore(module);
    const doc = module.createDocument();
    await core.readXmlString(doc, '<xml/>', { searchPath: '/libs', readXIncludes: false });
    expect(module.readFromXmlString).toHaveBeenCalledWith(
      doc,
      '<xml/>',
      '/libs',
      expect.objectContaining({ readXIncludes: false }),
    );
    const optionsArg = (module.readFromXmlString as ReturnType<typeof vi.fn>).mock.calls[0]?.[3];
    expect(optionsArg.delete).toHaveBeenCalled();
  });

  it('wraps read failures as MaterialXError with a diagnostic', async () => {
    const onDiagnostic = vi.fn();
    const module = makeModule({
      readFromXmlString: vi.fn(() => {
        throw new Error('parse error');
      }),
    });
    const core = new MaterialXCore(module, onDiagnostic);
    await expect(core.readXmlString(makeDoc(), '<bad>')).rejects.toBeInstanceOf(MaterialXError);
    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });

  it('reports invalid documents on validate', () => {
    const onDiagnostic = vi.fn();
    const core = new MaterialXCore(makeModule(), onDiagnostic);
    expect(core.validate(makeDoc(false))).toBe(false);
    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });
});
