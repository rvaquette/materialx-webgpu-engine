import { describe, expect, it, vi } from 'vitest';
import { compileShaderWithDiagnostics } from '../../src/gpu/shader-diagnostics.ts';

describe('shader compilation diagnostics', () => {
  it('returns the compiled module and structured errors with source locations', async () => {
    const module = {
      getCompilationInfo: vi.fn(async () => ({ messages: [
        { type: 'error', message: 'Invalid constructor', lineNum: 2, linePos: 3 },
        { type: 'warning', message: 'Unused value', lineNum: 1, linePos: 1 },
      ] })),
    };
    const device = { createShaderModule: vi.fn(() => module) };
    const result = await compileShaderWithDiagnostics(device as unknown as GPUDevice, 'fn main() {\n  invalid();\n}', 'Raster: absval');
    expect(result.module).toBe(module);
    expect(device.createShaderModule).toHaveBeenCalledWith({ code: 'fn main() {\n  invalid();\n}', label: 'Raster: absval' });
    expect(result.errors).toEqual([{
      shader: 'Raster: absval', message: 'Invalid constructor', line: 2, column: 3, source: '  invalid();',
    }]);
  });

  it('returns no errors for valid shaders', async () => {
    const device = { createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }) };
    const result = await compileShaderWithDiagnostics(device as unknown as GPUDevice, '', 'Path tracing');
    expect(result.errors).toEqual([]);
  });

  it('handles diagnostics without a source line', async () => {
    const device = { createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [
      { type: 'error', message: 'Module rejected', lineNum: 0, linePos: 0 },
    ] }) }) };
    const result = await compileShaderWithDiagnostics(device as unknown as GPUDevice, '', 'Path tracing');
    expect(result.errors[0]?.source).toBe('');
  });
});