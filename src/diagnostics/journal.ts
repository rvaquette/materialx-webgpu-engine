// Structured diagnostics: a bounded, timestamped, JSON-serializable journal of
// engine diagnostics and shader compilation errors, exportable as one document.

import type { Diagnostic, DiagnosticLevel } from '../core/diagnostics.ts';

export interface DiagnosticRecord {
  readonly time: string;
  readonly level: DiagnosticLevel;
  readonly message: string;
  readonly code?: string;
  readonly detail?: unknown;
  /** WGSL location for shader compilation errors. */
  readonly shader?: { readonly name: string; readonly line: number; readonly column: number; readonly source: string };
}

/** Errors, typed arrays, maps and cycles become plain JSON values. */
export function jsonSafe(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return typeof value === 'string' && value.length > 4000 ? `${value.slice(0, 4000)}…` : value;
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (ArrayBuffer.isView(value)) return { type: value.constructor.name, byteLength: value.byteLength };
  if (typeof value !== 'object' || depth > 5 || seen.has(value)) return String(value);
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 100).map(item => jsonSafe(item, depth + 1, seen));
  if (value instanceof Map) return Object.fromEntries([...value].slice(0, 100).map(([key, item]) => [String(key), jsonSafe(item, depth + 1, seen)]));
  if (value instanceof Set) return [...value].slice(0, 100).map(item => jsonSafe(item, depth + 1, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item, depth + 1, seen)]));
}

export class DiagnosticJournal {
  readonly #records: DiagnosticRecord[] = [];
  readonly #limit: number;
  #dropped = 0;

  constructor(limit = 1000) {
    this.#limit = limit;
  }

  get records(): readonly DiagnosticRecord[] {
    return [...this.#records];
  }

  get dropped(): number {
    return this.#dropped;
  }

  record(diagnostic: Diagnostic, shader?: DiagnosticRecord['shader']): DiagnosticRecord {
    const detail = jsonSafe(diagnostic.detail);
    const record: DiagnosticRecord = {
      time: new Date().toISOString(), level: diagnostic.level, message: diagnostic.message,
      ...(diagnostic.code !== undefined ? { code: diagnostic.code } : {}),
      ...(detail !== undefined ? { detail } : {}),
      ...(shader ? { shader } : {}),
    };
    this.#records.push(record);
    if (this.#records.length > this.#limit) {
      this.#records.shift();
      this.#dropped++;
    }
    return record;
  }

  /** JSON document (format `materialx-webgpu-diagnostics`, version 1) with caller context. */
  export(context: Record<string, unknown> = {}): string {
    return JSON.stringify({
      format: 'materialx-webgpu-diagnostics', version: 1, exportedAt: new Date().toISOString(),
      userAgent: globalThis.navigator?.userAgent ?? '', ...jsonSafe(context) as object,
      droppedDiagnostics: this.#dropped, diagnostics: this.#records,
    }, null, 2);
  }
}
