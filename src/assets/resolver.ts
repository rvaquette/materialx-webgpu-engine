// Asset resolver: turns MaterialX/USD references into fetchable URLs under an
// explicit asset-root policy. The browser cannot open arbitrary local paths
// (e.g. `D:\...`), so absolute/local paths must be provided through `fileMap`
// (local selection) or served under `rootUrl`. Unresolved or out-of-policy
// references raise a diagnostic and throw -- they are never silently repaired
// (plan section 8, REQ-013).

import { defaultDiagnosticSink, type DiagnosticSink } from '../core/diagnostics.ts';

export interface AssetResolverOptions {
  /** Base URL (http(s) or blob root) assets are served from. */
  rootUrl?: string;
  /** Explicit logical-path -> URL map for locally selected assets. */
  fileMap?: ReadonlyMap<string, string>;
  onDiagnostic?: DiagnosticSink;
}

export interface ResolvedAsset {
  /** Normalized logical path, used as a stable cache key. */
  key: string;
  /** Fetchable URL. */
  url: string;
}

export class AssetResolutionError extends Error {
  override readonly name = 'AssetResolutionError';
}

const UDIM_TOKEN = /<UDIM>/gi;
const READY_SCHEME = /^(https?:|blob:|data:)/i;
const DRIVE_PATH = /^[a-zA-Z]:[\\/]/;

function isReadyUrl(ref: string): boolean {
  return READY_SCHEME.test(ref);
}

function isLocalAbsolute(ref: string): boolean {
  return DRIVE_PATH.test(ref) || ref.startsWith('file:') || ref.startsWith('/');
}

/** Normalize a POSIX-style path. Returns null if it escapes above the root. */
function normalizePosix(path: string): string | null {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else {
      out.push(segment);
    }
  }
  return out.join('/');
}

function dirOf(key: string): string {
  const i = key.lastIndexOf('/');
  return i < 0 ? '' : key.slice(0, i);
}

function toPosix(path: string): string {
  return path.replace(/\\/g, '/');
}

export class AssetResolver {
  private readonly rootUrl: string | undefined;
  private readonly fileMap: ReadonlyMap<string, string> | undefined;
  private readonly diag: DiagnosticSink;

  constructor(options: AssetResolverOptions = {}) {
    this.rootUrl = options.rootUrl ? options.rootUrl.replace(/\/+$/, '') : undefined;
    this.fileMap = options.fileMap;
    this.diag = options.onDiagnostic ?? defaultDiagnosticSink;
  }

  static hasUdim(ref: string): boolean {
    UDIM_TOKEN.lastIndex = 0;
    return UDIM_TOKEN.test(ref);
  }

  static expandUdim(ref: string, tile: number): string {
    return ref.replace(UDIM_TOKEN, String(tile));
  }

  /**
   * Resolve `ref` (optionally relative to the authoring document `baseKey`) to a
   * fetchable URL. Throws AssetResolutionError on unresolved/out-of-policy paths.
   */
  resolve(ref: string, baseKey = ''): ResolvedAsset {
    const trimmed = ref.trim();
    if (trimmed === '') {
      throw this.fail('Empty asset reference.', ref);
    }

    if (isReadyUrl(trimmed)) {
      return { key: trimmed, url: trimmed };
    }

    if (isLocalAbsolute(trimmed)) {
      // Local/absolute path: resolvable only via an explicit fileMap entry.
      const mapped = this.lookupFileMap(trimmed);
      if (mapped) return mapped;
      throw this.fail(
        `Local/absolute path cannot be opened by the browser and is not in the file map: ${trimmed}`,
        ref,
      );
    }

    const base = dirOf(toPosix(baseKey));
    const joined = base ? `${base}/${toPosix(trimmed)}` : toPosix(trimmed);
    const key = normalizePosix(joined);
    if (key === null) {
      throw this.fail(`Reference escapes the asset root: ${trimmed} (base ${baseKey})`, ref);
    }

    const fromMap = this.fileMap?.get(key);
    if (fromMap) return { key, url: fromMap };

    if (this.rootUrl) {
      return { key, url: `${this.rootUrl}/${key}` };
    }

    throw this.fail(`No asset root configured to resolve: ${key}`, ref);
  }

  /** Resolve a single UDIM tile of a `<UDIM>`-templated reference. */
  resolveUdimTile(ref: string, tile: number, baseKey = ''): ResolvedAsset {
    return this.resolve(AssetResolver.expandUdim(ref, tile), baseKey);
  }

  private lookupFileMap(ref: string): ResolvedAsset | undefined {
    if (!this.fileMap) return undefined;
    const direct = this.fileMap.get(ref);
    if (direct) return { key: ref, url: direct };
    // Also accept a match on the normalized basename-ish tail.
    const tail = toPosix(ref).replace(DRIVE_PATH, '').replace(/^file:\/*/i, '').replace(/^\/+/, '');
    const url = this.fileMap.get(tail);
    return url ? { key: tail, url } : undefined;
  }

  private fail(message: string, ref: string): AssetResolutionError {
    this.diag({ level: 'error', message, detail: { ref } });
    return new AssetResolutionError(message);
  }
}
