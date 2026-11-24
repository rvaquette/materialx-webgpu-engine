// Remote rendering client: sends a material script to the render server
// (scripts/remote-render-server.mjs, docs/REMOTE_RENDER.md) and receives its progress,
// intermediate frames, log messages and saved files as server-sent events.

export interface RemoteRenderSettings {
  /** Server base URL, e.g. https://render.example.com/ (HTTPS except on localhost). */
  url: string;
  /** Bearer token (MX_REMOTE_TOKEN on the server); empty with Cloudflare Access alone. */
  token: string;
}

export interface RemoteRenderResult {
  ok: boolean;
  message?: string;
  line?: number;
  nodes?: number;
  viewerCommands?: number;
  logs?: string[];
}

export interface RemoteRenderProgress {
  backend?: string;
  pathTracer?: string;
  samples?: number;
  adaptive?: boolean;
  samplesPerSecond?: number;
  noise?: number;
  remaining?: number;
  entry?: string;
}

export type RemoteRenderEvent =
  | { type: 'status'; stage: 'queued' | 'loading' | 'running'; position?: number }
  | { type: 'progress'; progress: RemoteRenderProgress }
  | { type: 'frame'; image: string }
  | { type: 'log'; message: string; level?: 'error' }
  | { type: 'file'; name: string; data: string };

const STORAGE_KEY = 'mx-remote-render';

export function loadRemoteSettings(): RemoteRenderSettings {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<RemoteRenderSettings>;
    return { url: typeof value.url === 'string' ? value.url : '', token: typeof value.token === 'string' ? value.token : '' };
  } catch {
    return { url: '', token: '' };
  }
}

export function saveRemoteSettings(settings: RemoteRenderSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/** The server URL; the token would leak over plain HTTP, which is only accepted on this machine. */
export function remoteServerUrl(url: string): URL {
  let parsed: URL;
  try { parsed = new URL(url.trim()); } catch { throw new Error('URL du serveur de rendu invalide.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    throw new Error('Le serveur de rendu doit être en HTTPS (HTTP accepté seulement pour localhost).');
  }
  if (parsed.username || parsed.password) throw new Error('L’URL du serveur ne doit pas contenir d’identifiants.');
  parsed.search = '';
  parsed.hash = '';
  if (!parsed.pathname.endsWith('/')) parsed.pathname += '/';
  return parsed;
}

/** Incremental `text/event-stream` parser: feed decoded text, get complete events. */
export class EventStreamParser {
  #buffer = '';

  push(text: string): { event: string; data: string }[] {
    this.#buffer += text.replace(/\r\n?/g, '\n');
    const events: { event: string; data: string }[] = [];
    let end: number;
    while ((end = this.#buffer.indexOf('\n\n')) >= 0) {
      const block = this.#buffer.slice(0, end);
      this.#buffer = this.#buffer.slice(end + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (!line || line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
      }
      if (data.length) events.push({ event, data: data.join('\n') });
    }
    return events;
  }
}

/**
 * Runs `script` on the server; `onEvent` receives progress until the returned result.
 * Aborting `signal` cancels the job on the server.
 */
export async function runRemoteScript(
  settings: RemoteRenderSettings, script: string, onEvent: (event: RemoteRenderEvent) => void, signal?: AbortSignal,
): Promise<RemoteRenderResult> {
  const base = remoteServerUrl(settings.url);
  let response: Response;
  try {
    response = await fetch(new URL('jobs', base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {}) },
      body: JSON.stringify({ script }),
      // Sends the Cloudflare Access session cookie of the server's domain.
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(`Serveur de rendu injoignable. S’il est protégé par Cloudflare Access, ouvrir ${base.href} pour se connecter, puis réessayer.`);
  }
  if (response.status === 401) throw new Error('Authentification refusée par le serveur de rendu (jeton ou session Cloudflare Access).');
  if (response.status === 429) throw new Error('File d’attente du serveur de rendu pleine, réessayer plus tard.');
  if (!response.ok || !response.body) throw new Error(`Serveur de rendu : HTTP ${response.status} ${(await response.text().catch(() => '')).slice(0, 200)}`);

  const parser = new EventStreamParser();
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const { event, data } of parser.push(value)) {
      const payload = JSON.parse(data) as Record<string, unknown>;
      if (event === 'done') {
        await reader.cancel().catch(() => {});
        return payload as unknown as RemoteRenderResult;
      }
      if (event === 'progress') onEvent({ type: 'progress', progress: payload as RemoteRenderProgress });
      else if (event === 'status' || event === 'frame' || event === 'log' || event === 'file') {
        onEvent({ type: event, ...payload } as RemoteRenderEvent);
      }
    }
  }
  throw new Error('Connexion au serveur de rendu interrompue avant la fin du script.');
}

export function describeRemoteProgress(progress: RemoteRenderProgress): string {
  const scene = String(progress.entry ?? '').split('/').at(-1) ?? '';
  if (!progress.backend) return scene;
  if (progress.backend === 'raster' || progress.pathTracer !== 'ready') {
    return `${scene} : ${progress.backend}${progress.backend === 'raster' ? '' : ` ${progress.pathTracer ?? ''}`}`;
  }
  const rate = progress.samplesPerSecond === undefined ? '' : `, ${progress.samplesPerSecond.toFixed(1)}/s`;
  const noise = progress.noise === undefined ? '' : `, bruit ${(progress.noise * 100).toFixed(1)} %`;
  const remaining = progress.remaining === undefined ? '' : `, ~${Math.round(progress.remaining)} s`;
  return `${scene} : ${progress.backend} ${progress.samples ?? 0} ${progress.adaptive ? 'balayages' : 'spp'}${rate}${noise}${remaining}`;
}

const VIEW_STYLE = `
#remote-render-view { position: absolute; inset: 0; z-index: 2; margin: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; background: #101014; }
#remote-render-view[hidden] { display: none; }
#remote-render-view img { flex: 1; min-height: 0; max-width: 100%; object-fit: contain; }
#remote-render-view figcaption { display: flex; gap: 8px; align-items: center; padding: 6px; font-size: 0.9em; }
#remote-render-view figcaption span { white-space: pre-wrap; }
`;

/** Shows the remote frames above the local viewer canvas, until closed. */
export class RemoteRenderView {
  readonly element: HTMLElement;
  readonly #image: HTMLImageElement;
  readonly #caption: HTMLElement;
  readonly #cancel: HTMLButtonElement;
  onCancel: (() => void) | undefined;

  constructor(container: HTMLElement) {
    if (!document.getElementById('mx-remote-style')) {
      document.head.append(Object.assign(document.createElement('style'), { id: 'mx-remote-style', textContent: VIEW_STYLE }));
    }
    this.element = document.createElement('figure');
    this.element.id = 'remote-render-view';
    this.element.hidden = true;
    this.element.innerHTML = `<img alt="Rendu distant" data-testid="remote-frame">
      <figcaption><span role="status" data-testid="remote-progress"></span>
      <button type="button" data-action="cancel">Annuler</button>
      <button type="button" data-action="close">Fermer</button></figcaption>`;
    this.#image = this.element.querySelector('img')!;
    this.#caption = this.element.querySelector('[data-testid="remote-progress"]')!;
    this.#cancel = this.element.querySelector('[data-action="cancel"]')!;
    this.#cancel.addEventListener('click', () => this.onCancel?.());
    this.element.querySelector('[data-action="close"]')!.addEventListener('click', () => {
      this.onCancel?.();
      this.element.hidden = true;
    });
    container.append(this.element);
  }

  start(): void {
    this.#image.removeAttribute('src');
    this.#cancel.hidden = false;
    this.element.hidden = false;
    this.status('Envoi du script…');
  }

  frame(dataUrl: string): void {
    // Only images produced by the server's canvas capture are displayed.
    if (/^data:image\/(webp|png|jpeg);base64,/.test(dataUrl)) this.#image.src = dataUrl;
  }

  status(text: string): void {
    this.#caption.textContent = text;
  }

  finish(text: string): void {
    this.#cancel.hidden = true;
    this.status(text);
  }
}
