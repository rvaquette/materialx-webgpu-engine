import { describe, expect, it, vi } from 'vitest';
import { compileShaderBatch, compileShaderWithDiagnostics } from '../../src/gpu/shader-diagnostics.ts';

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

  it('compiles a bounded batch concurrently and returns results in job order', async () => {
    let active = 0;
    let peak = 0;
    let uiTaskRan = false;
    const release: Array<() => void> = [];
    const device = {
      createShaderModule: vi.fn(() => ({
        getCompilationInfo: () => new Promise<Pick<GPUCompilationInfo, 'messages'>>(resolve => {
          active++;
          peak = Math.max(peak, active);
          release.push(() => {
            active--;
            resolve({ messages: [] });
          });
        }),
      })),
    };
    const jobs = Array.from({ length: 6 }, (_, index) => ({
      label: `shader-${index}`,
      code: () => {
        expect(uiTaskRan).toBe(true);
        return `code-${index}`;
      },
    }));
    setTimeout(() => { uiTaskRan = true; }, 0);
    const compiling = compileShaderBatch(device as unknown as GPUDevice, jobs);
    const waitForCompilers = async (count: number): Promise<void> => {
      const deadline = Date.now() + 1000;
      while (release.length < count && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      expect(release).toHaveLength(count);
    };
    await waitForCompilers(4);
    expect(peak).toBe(4);
    release.splice(0).forEach(resolve => resolve());
    await waitForCompilers(2);
    release.splice(0).forEach(resolve => resolve());

    const results = await compiling;
    expect(results.map(result => result.code)).toEqual(jobs.map(job => job.code()));
    expect(results.every(result => result.errors.length === 0)).toBe(true);
  });
});