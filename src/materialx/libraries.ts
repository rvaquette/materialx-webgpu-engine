// MaterialX standard-library loading. The Core build exposes no
// `loadStandardLibraries`, so the application resolves and reads the required
// local `.mtlx` files and imports them into content documents (plan section 7.1,
// REQ-004). Per-backend shader implementation files (`*_gen*_impl.mtlx`) are
// intentionally excluded: NodeDef/nodegraph definitions and target declarations
// are enough for Core resolution/traversal, and WGSL lowering is TypeScript-owned.

import { throwIfAborted, defaultDiagnosticSink, type DiagnosticSink } from '../core/diagnostics.ts';
import type { MaterialXCore, MxDocument } from './wasm.ts';

export interface LibrarySource {
  /** Logical name for diagnostics/provenance. */
  name: string;
  /** Fetchable URL of the library `.mtlx` document. */
  url: string;
}

export type TextFetcher = (url: string, signal?: AbortSignal) => Promise<string>;

export interface LoadLibrariesOptions {
  sources: readonly LibrarySource[];
  fetchText: TextFetcher;
  /** Search path passed to the XML reader for include resolution. */
  searchPath?: string;
  signal?: AbortSignal;
  onDiagnostic?: DiagnosticSink;
}

/**
 * Default MaterialX library documents loaded for Core resolution, relative to
 * the libraries root. Definitions (`*_defs`), nodegraph implementations
 * (`*_ng`), target declarations, and the bxdf surface shaders. Order matters:
 * targets and stdlib precede the libraries that build on them.
 */
export const MATERIALX_DEFAULT_LIBRARY_FILES: readonly string[] = [
  'targets/genglsl.mtlx',
  'targets/genmsl.mtlx',
  'targets/genosl.mtlx',
  'targets/genmdl.mtlx',
  'stdlib/stdlib_defs.mtlx',
  'stdlib/stdlib_ng.mtlx',
  'pbrlib/pbrlib_defs.mtlx',
  'pbrlib/pbrlib_ng.mtlx',
  'cmlib/cmlib_defs.mtlx',
  'cmlib/cmlib_ng.mtlx',
  'bxdf/standard_surface.mtlx',
  'bxdf/open_pbr_surface.mtlx',
  'bxdf/gltf_pbr.mtlx',
  'bxdf/usd_preview_surface.mtlx',
  'bxdf/disney_principled.mtlx',
];

/** Build library sources from a root URL and a list of relative file paths. */
export function defaultLibrarySources(
  rootUrl: string,
  files: readonly string[] = MATERIALX_DEFAULT_LIBRARY_FILES,
): LibrarySource[] {
  const base = rootUrl.replace(/\/+$/, '');
  return files.map((file) => ({ name: file, url: `${base}/${file}` }));
}

/** Loads MaterialX library documents and imports them into content documents. */
export class MaterialXLibraries {
  private libraryDoc: MxDocument | undefined;

  constructor(private readonly core: MaterialXCore) {}

  /** Read all sources into a single library document (memoized). */
  async load(options: LoadLibrariesOptions): Promise<MxDocument> {
    if (this.libraryDoc) return this.libraryDoc;

    const diag = options.onDiagnostic ?? defaultDiagnosticSink;
    const doc = this.core.createDocument();
    try {
      throwIfAborted(options.signal);
      const texts = await Promise.all(options.sources.map((source) => options.fetchText(source.url, options.signal)));
      for (const xml of texts) {
        throwIfAborted(options.signal);
        await this.core.readXmlString(doc, xml, {
          ...(options.searchPath !== undefined ? { searchPath: options.searchPath } : {}),
          readXIncludes: true,
        });
      }

    } catch (error) {
      doc.delete();
      diag({
        level: 'error',
        message: `Failed to load MaterialX libraries: ${error instanceof Error ? error.message : String(error)}`,
        detail: error,
      });
      throw error;
    }

    if (!this.core.validate(doc)) {
      doc.delete();
      throw new Error('MaterialX library document failed validation.');
    }

    this.libraryDoc = doc;
    return doc;
  }

  /** Import the loaded libraries into a content document. */
  importInto(target: MxDocument): void {
    if (!this.libraryDoc) {
      throw new Error('MaterialXLibraries.importInto called before load().');
    }
    target.importLibrary(this.libraryDoc);
  }

  /** Release the underlying library document. */
  delete(): void {
    this.libraryDoc?.delete();
    this.libraryDoc = undefined;
  }
}

const sharedLibraries = new WeakMap<MaterialXCore, Map<string, Promise<MaterialXLibraries>>>();

/** Core-lifetime libraries; scene documents import them but do not own them. */
export function loadSharedMaterialXLibraries(core: MaterialXCore, options: LoadLibrariesOptions): Promise<MaterialXLibraries> {
  let entries = sharedLibraries.get(core);
  if (!entries) {
    entries = new Map();
    sharedLibraries.set(core, entries);
  }
  const key = JSON.stringify([options.sources, options.searchPath]);
  const existing = entries.get(key);
  if (existing) return existing;
  const libraries = new MaterialXLibraries(core);
  const loading = libraries.load(options).then(() => libraries, (error: unknown) => {
    entries.delete(key);
    throw error;
  });
  entries.set(key, loading);
  return loading;
}
