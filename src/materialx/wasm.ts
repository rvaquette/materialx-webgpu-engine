// MaterialX Core WASM facade. Wraps the Emscripten `JsMaterialXCore` module for
// XML read/validate/resolve/traverse only. No shader generator is loaded or
// called -- WGSL is produced by the TypeScript backend (plan sections 1, 7.1,
// REQ-004). Embind objects are released deterministically via `delete()`.

import { defaultDiagnosticSink, type DiagnosticSink } from '../core/diagnostics.ts';

/** Embind-backed object with deterministic release. */
export interface MxObject {
  delete(): void;
}

export interface MxElement extends MxObject {
  getName(): string;
  getNamePath(): string;
  getCategory?(): string;
  validate(): boolean;
}

export interface MxDocument extends MxElement {
  importLibrary(library: MxDocument): void;
  getChild?(name: string): MxElement | null;
  getNodes?(): MxLibraryNode[];
}

export interface MxLibraryNode extends MxElement {
  setName(name: string): void;
  getDownstreamPorts(): { setNodeName(name: string): void }[];
}

export interface MxReadOptions extends MxObject {
  readXIncludes: boolean;
}

/** Subset of the JsMaterialXCore module surface this engine uses. */
export interface MaterialXCoreModule {
  createDocument(): MxDocument;
  readFromXmlString(
    doc: MxDocument,
    xml: string,
    searchPath?: string,
    options?: MxReadOptions | null,
  ): void | Promise<void>;
  readFromXmlFile?(
    doc: MxDocument,
    file: string,
    searchPath?: string,
    options?: MxReadOptions | null,
  ): void | Promise<void>;
  XmlReadOptions?: new () => MxReadOptions;
  getEnviron?(name: string): string;
  setEnviron?(name: string, value: string): void;
  [key: string]: unknown;
}

/** Asynchronous Emscripten module factory exported by JsMaterialXCore.js. */
export type MaterialXModuleFactory = (
  moduleArg?: Record<string, unknown>,
) => Promise<MaterialXCoreModule>;

export interface ReadXmlOptions {
  searchPath?: string;
  /** Process XIncludes. Default true. */
  readXIncludes?: boolean;
}

export interface LoadMaterialXOptions {
  /** URL of JsMaterialXCore.js (an ESM/CJS module exposing the factory). */
  moduleUrl?: string;
  /** Preloaded factory (takes precedence over `moduleUrl`), e.g. for tests. */
  factory?: MaterialXModuleFactory;
  /** Emscripten `locateFile` to resolve the sibling `.wasm`. */
  locateFile?: (path: string, prefix: string) => string;
  onDiagnostic?: DiagnosticSink;
}

export class MaterialXError extends Error {
  override readonly name = 'MaterialXError';
}

/** Deterministic lifetime wrapper around a loaded MaterialX Core module. */
export class MaterialXCore {
  constructor(
    readonly module: MaterialXCoreModule,
    private readonly diag: DiagnosticSink = defaultDiagnosticSink,
  ) {}

  createDocument(): MxDocument {
    return this.module.createDocument();
  }

  /** Read (and accumulate) XML into `doc`. Throws MaterialXError on failure. */
  async readXmlString(doc: MxDocument, xml: string, options: ReadXmlOptions = {}): Promise<void> {
    const { searchPath = '', readXIncludes = true } = options;
    const readOptions = this.makeReadOptions(readXIncludes);
    try {
      await this.module.readFromXmlString(doc, xml, searchPath, readOptions ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.diag({ level: 'error', message: `MaterialX XML read failed: ${message}`, detail: error });
      throw new MaterialXError(message);
    } finally {
      readOptions?.delete();
    }
  }

  /** Structural validation. Emits a diagnostic and returns false on failure. */
  validate(doc: MxDocument): boolean {
    const ok = doc.validate();
    if (!ok) {
      this.diag({ level: 'error', message: 'MaterialX document failed structural validation.' });
    }
    return ok;
  }

  private makeReadOptions(readXIncludes: boolean): MxReadOptions | undefined {
    const Ctor = this.module.XmlReadOptions;
    if (!Ctor) return undefined;
    const options = new Ctor();
    options.readXIncludes = readXIncludes;
    return options;
  }
}

let cached: Promise<MaterialXCore> | undefined;

/** Load and instantiate the MaterialX Core module once (memoized). */
export function loadMaterialXCore(options: LoadMaterialXOptions = {}): Promise<MaterialXCore> {
  if (cached) return cached;
  cached = instantiate(options).catch((error) => {
    cached = undefined; // allow a retry after a failed load
    throw error;
  });
  return cached;
}

/** Reset the memoized Core instance (tests / device-independent reinitialization). */
export function resetMaterialXCore(): void {
  cached = undefined;
}

async function instantiate(options: LoadMaterialXOptions): Promise<MaterialXCore> {
  const diag = options.onDiagnostic ?? defaultDiagnosticSink;
  const factory = options.factory ?? (await importFactory(options.moduleUrl));
  const moduleArg: Record<string, unknown> = {};
  if (options.locateFile) moduleArg['locateFile'] = options.locateFile;
  const module = await factory(moduleArg);
  return new MaterialXCore(module, diag);
}

async function importFactory(moduleUrl: string | undefined): Promise<MaterialXModuleFactory> {
  if (!moduleUrl) {
    throw new MaterialXError('loadMaterialXCore requires either `factory` or `moduleUrl`.');
  }
  const mod = (await import(/* @vite-ignore */ moduleUrl)) as {
    default?: MaterialXModuleFactory;
  } & Record<string, unknown>;
  const factory = mod.default ?? (mod as unknown as MaterialXModuleFactory);
  if (typeof factory !== 'function') {
    throw new MaterialXError(`Module at ${moduleUrl} does not export a MaterialX factory.`);
  }
  return factory;
}
