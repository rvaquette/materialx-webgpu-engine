// Ambient shims for Vite config and file-backed tests. @types/node is intentionally
// absent (tsconfig `types` is restricted to @webgpu/types + vite/client), so
// declare only the Node builtins this config touches at runtime.
declare module 'fs' {
  export function readFileSync(path: string): Uint8Array;
  export function existsSync(path: string): boolean;
}
declare module 'path' {
  export function join(...parts: string[]): string;
  export function normalize(p: string): string;
  export function extname(p: string): string;
}
declare module 'node:fs/promises' {
  export function readFile(path: string): Promise<Uint8Array<ArrayBuffer>>;
  export function readFile(path: string, encoding: 'utf8'): Promise<string>;
}
declare module 'node:path' {
  export function resolve(...parts: string[]): string;
}
declare const process: { env: Record<string, string | undefined> };
