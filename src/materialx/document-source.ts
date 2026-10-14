// T057m3a: build a MaterialDocumentSource (graph-material-compiler, m1) backed by
// real MaterialX Core documents. The compiler needs a synchronous documentFor,
// so every referenced .mtlx asset is read into a document up front (createDocument
// + readXmlString + importInto the standard libraries) and keyed by asset path.
// This is the bridge that feeds createGraphMaterialCompiler genuine WASM documents
// in the browser; the loading stays a thin, node-testable wrapper over an injected
// MaterialXCore and library importer.

import type { Diagnostic, DiagnosticSink } from '../core/diagnostics.ts';
import type { MaterialCompileUnit, MtlxDocumentView } from '../usd/materials.ts';
import type { MaterialDocumentSource } from '../render/graph-material-compiler.ts';
import type { MaterialXCore, MxDocument } from './wasm.ts';

/** Imports the standard libraries into a content document (MaterialXLibraries). */
export interface DocumentLibraryImporter {
  importInto(target: MxDocument): void;
}

/** A document source that owns the loaded documents and releases them on delete. */
export interface MaterialXDocumentSource extends MaterialDocumentSource {
  delete(): void;
}

export interface LoadMaterialXDocumentsOptions {
  core: MaterialXCore;
  libraries: DocumentLibraryImporter;
  /** Material asset path (unit.assetPath) -> raw .mtlx XML text. */
  texts: ReadonlyMap<string, string>;
  /** Search path passed to the XML reader for XInclude resolution. */
  searchPath?: string;
  sink?: DiagnosticSink;
}

/** Read each referenced .mtlx into a library-imported document, keyed by asset path. */
export async function loadMaterialXDocuments(
  options: LoadMaterialXDocumentsOptions,
): Promise<MaterialXDocumentSource> {
  const emit: (d: Diagnostic) => void = options.sink ?? (() => undefined);
  const docs = new Map<string, MxDocument>();

  for (const [assetPath, xml] of options.texts) {
    const doc = options.core.createDocument();
    try {
      await options.core.readXmlString(doc, xml, {
        ...(options.searchPath !== undefined ? { searchPath: options.searchPath } : {}),
        readXIncludes: true,
      });
      options.libraries.importInto(doc);
    } catch (error) {
      doc.delete();
      emit({
        level: 'error',
        message: `Failed to read MaterialX document ${assetPath}: ${error instanceof Error ? error.message : String(error)}`,
        detail: { asset: assetPath },
      });
      continue;
    }
    docs.set(assetPath, doc);
  }

  return {
    documentFor(unit: MaterialCompileUnit): MtlxDocumentView | undefined {
      // The Embind document carries getMaterialNode/getChild at runtime; MxDocument's
      // typed surface does not declare them, so bridge through the view contract.
      return docs.get(unit.assetPath) as unknown as MtlxDocumentView | undefined;
    },
    delete(): void {
      for (const doc of docs.values()) doc.delete();
      docs.clear();
    },
  };
}
