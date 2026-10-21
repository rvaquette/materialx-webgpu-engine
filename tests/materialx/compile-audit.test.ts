import { describe, expect, it } from 'vitest';
import { compilationStatus, summarizeCompilation, type AuditFile, type AuditShader } from './compile-audit.harness.ts';

const shaders: AuditShader[] = [
  { backend: 'raster', errors: [], failure: null },
  { backend: 'pathtracing', errors: [], failure: null },
];

describe('MaterialX compilation audit', () => {
  it('requires both backends to compile', () => {
    expect(compilationStatus(shaders, [])).toBe('compiled');
    expect(compilationStatus(shaders.slice(0, 1), [])).toBe('failed');
    expect(compilationStatus([{ ...shaders[0]!, failure: 'Invalid pipeline' }, shaders[1]!], [])).toBe('failed');
  });

  it('does not mistake a black fallback for a successful material', () => {
    expect(compilationStatus(shaders, [{ level: 'warning', message: "Upstream node 'acos' has no WGSL lowering; substituting a neutral constant" }])).toBe('incomplete');
    expect(compilationStatus(shaders, [{ level: 'warning', message: 'Input driven by unsupported node' }])).toBe('incomplete');
  });

  it('distinguishes compiler errors from unrelated warnings', () => {
    expect(compilationStatus(shaders, [{ level: 'error', message: 'Missing named input' }])).toBe('failed');
    expect(compilationStatus(shaders, [{ level: 'warning', message: 'Unresolved NodeDef' }])).toBe('compiled');
  });

  it('counts skipped files separately', () => {
    const files = ['compiled', 'failed', 'incomplete', 'skipped'].map((status) => ({ file: status, status, diagnostics: [], materials: [] })) as AuditFile[];
    expect(summarizeCompilation(files)).toEqual({ compiled: 1, failed: 1, incomplete: 1, skipped: 1 });
  });
});