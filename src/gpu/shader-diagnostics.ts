export interface ShaderCompilationError {
  shader: string;
  message: string;
  line: number;
  column: number;
  source: string;
}

export interface ShaderCompilationJob {
  label: string;
  code: () => string;
}

export interface CompiledShader {
  code: string;
  module: GPUShaderModule;
  errors: ShaderCompilationError[];
}

export const SHADER_COMPILATION_CONCURRENCY = 4;

export async function compileShaderWithDiagnostics(
  device: GPUDevice,
  code: string,
  label: string,
): Promise<{ module: GPUShaderModule; errors: ShaderCompilationError[] }> {
  const module = device.createShaderModule({ code, label });
  const info = await module.getCompilationInfo();
  const lines = code.split('\n');
  const errors = info.messages.filter((message) => message.type === 'error').map((message) => ({
    shader: label,
    message: message.message,
    line: message.lineNum,
    column: message.linePos,
    source: lines[message.lineNum - 1] ?? '',
  }));
  return { module, errors };
}

export async function compileShaderBatch(
  device: GPUDevice,
  jobs: readonly ShaderCompilationJob[],
): Promise<CompiledShader[]> {
  const results = new Array<CompiledShader>(jobs.length);
  let nextJob = 0;
  const compileNext = async (): Promise<void> => {
    while (true) {
      const index = nextJob++;
      const job = jobs[index];
      if (!job) return;
      // Yield before synchronous WGSL generation so input and paint can run between jobs.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      const code = job.code();
      const compiled = await compileShaderWithDiagnostics(device, code, job.label);
      results[index] = { code, ...compiled };
    }
  };
  const workerCount = Math.min(SHADER_COMPILATION_CONCURRENCY, jobs.length);
  const outcomes = await Promise.allSettled(Array.from({ length: workerCount }, compileNext));
  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') throw outcome.reason;
  }
  return results;
}