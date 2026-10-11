// Shared diagnostics primitive. The engine never drops information silently
// (REQ-013): subsystems report through a DiagnosticSink instead of swallowing
// errors or logging ad hoc.

export type DiagnosticLevel = 'info' | 'warning' | 'error';

export interface Diagnostic {
  level: DiagnosticLevel;
  message: string;
  detail?: unknown;
}

export type DiagnosticSink = (diagnostic: Diagnostic) => void;

export const defaultDiagnosticSink: DiagnosticSink = (d) => {
  const log = d.level === 'error' ? console.error : d.level === 'warning' ? console.warn : console.info;
  log(`[${d.level}] ${d.message}`, d.detail ?? '');
};

export class AbortError extends Error {
  override readonly name = 'AbortError';
  constructor(message = 'Operation aborted.') {
    super(message);
  }
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AbortError();
}
