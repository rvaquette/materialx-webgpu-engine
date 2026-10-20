export interface ShaderCompilationError {
  shader: string;
  message: string;
  line: number;
  column: number;
  source: string;
}

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