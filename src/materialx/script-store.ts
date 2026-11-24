// Persistence of material scripts: the editor draft (localStorage), named scripts (IndexedDB)
// and share links (`#script=` with the deflate-compressed script in base64url).
import { openDB, type IDBPDatabase } from 'idb';

const DRAFT_KEY = 'materialx-webgpu-engine.script-draft.v1';
const DATABASE = 'materialx-webgpu-engine-scripts';
const STORE = 'scripts';
/** Longest script accepted from a link, once decompressed. */
const MAX_SHARED_SCRIPT = 512 * 1024;

export interface StoredScript {
  name: string;
  code: string;
  /** Milliseconds since the epoch. */
  updated: number;
}

export function loadDraft(): string | undefined {
  try { return localStorage.getItem(DRAFT_KEY) ?? undefined; } catch { return undefined; }
}

export function saveDraft(code: string): void {
  try { localStorage.setItem(DRAFT_KEY, code); } catch { /* storage disabled: the draft lasts for the page only */ }
}

/** Named scripts of this browser. */
export class ScriptStore {
  #db: Promise<IDBPDatabase> | undefined;

  #open(): Promise<IDBPDatabase> {
    this.#db ??= openDB(DATABASE, 1, { upgrade: db => { db.createObjectStore(STORE, { keyPath: 'name' }); } });
    return this.#db;
  }

  async list(): Promise<StoredScript[]> {
    const scripts = await (await this.#open()).getAll(STORE) as StoredScript[];
    return scripts.sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(name: string): Promise<StoredScript | undefined> {
    return await (await this.#open()).get(STORE, name) as StoredScript | undefined;
  }

  async save(name: string, code: string): Promise<void> {
    await (await this.#open()).put(STORE, { name, code, updated: Date.now() } satisfies StoredScript);
  }

  async remove(name: string): Promise<void> {
    await (await this.#open()).delete(STORE, name);
  }
}

async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const output = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(output).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

/** The `script=` value of a share link. */
export async function encodeSharedScript(code: string): Promise<string> {
  return toBase64Url(await transform(new TextEncoder().encode(code), new CompressionStream('deflate-raw')));
}

export async function decodeSharedScript(value: string): Promise<string> {
  let bytes: Uint8Array;
  try { bytes = await transform(fromBase64Url(value), new DecompressionStream('deflate-raw')); }
  catch { throw new Error('Lien de script invalide.'); }
  if (bytes.length > MAX_SHARED_SCRIPT) throw new Error('Script du lien trop long.');
  return new TextDecoder().decode(bytes);
}

/** Link to the current page opening the editor with `code` (never run automatically). */
export async function shareLink(code: string, page = location.href): Promise<string> {
  const url = new URL(page);
  url.hash = `script=${await encodeSharedScript(code)}`;
  return url.href;
}

/** Script of a `#script=…` page address, if any. */
export async function sharedScriptOf(hash = location.hash): Promise<string | undefined> {
  const value = new URLSearchParams(hash.replace(/^#/, '')).get('script');
  return value ? decodeSharedScript(value) : undefined;
}
