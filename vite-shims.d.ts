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
  export function mkdtemp(prefix: string): Promise<string>;
  export function mkdir(path: string, options: { recursive: true }): Promise<string | undefined>;
  export function readFile(path: string): Promise<Uint8Array<ArrayBuffer>>;
  export function readFile(path: string, encoding: 'utf8'): Promise<string>;
  export function writeFile(path: string, data: string | Uint8Array): Promise<void>;
  export function rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void>;
}
declare module 'node:child_process' {
  export function execFile(file: string, args: readonly string[], callback: (error: Error | null, stdout: string, stderr: string) => void): void;
}
declare module 'node:util' {
  export function promisify(fn: typeof import('node:child_process').execFile):
    (file: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;
}
declare module 'node:os' {
  export function tmpdir(): string;
}
declare module 'node:path' {
  export function resolve(...parts: string[]): string;
  export function join(...parts: string[]): string;
}
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string, options?: { recursive: boolean }): string[];
  export function openSync(path: string, flags: string): number;
  export function readSync(fd: number, buffer: Uint8Array, offset: number, length: number, position: number): number;
  export function closeSync(fd: number): void;
}
declare module 'node:url' {
  export function pathToFileURL(path: string): URL;
  export function fileURLToPath(url: string | URL): string;
}
declare module '*/pathtracer-cache-server.mjs' {
  export function sceneBufferCachePlugin(root: string): import('vite').Plugin;
}
declare const process: { env: Record<string, string | undefined>; execPath: string };
