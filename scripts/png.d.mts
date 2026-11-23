export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer;
export function decodePng(file: Buffer): { width: number; height: number; rgba: Uint8Array };
