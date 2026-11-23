// Chrome on an Android device through adb, driven over the DevTools protocol of a single tab.
// Attaching Playwright to the whole browser (connectOverCDP) stalls on devices with many tabs,
// and _android.launchBrowser() force-stops Chrome: both are avoided on personal devices.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const ADB = process.env['MX_ADB'] ?? 'D:\\platform-tools\\adb.exe';

export interface AndroidDevice {
  serial: string;
  label: string;
  adb(...args: string[]): Promise<string>;
}

/** The single authorized device (or MX_ANDROID_SERIAL), undefined when none is connected. */
export async function androidDevice(): Promise<AndroidDevice | undefined> {
  let listing: string;
  try {
    listing = (await exec(ADB, ['devices'])).stdout;
  } catch {
    return undefined;
  }
  const serials = listing.split(/\r?\n/).filter(line => /\tdevice\s*$/.test(line)).map(line => line.split('\t')[0]!);
  const serial = process.env['MX_ANDROID_SERIAL'] ?? (serials.length === 1 ? serials[0] : undefined);
  if (!serial) return undefined;
  const adb = async (...args: string[]): Promise<string> =>
    (await exec(ADB, ['-s', serial, ...args])).stdout.trim();
  const model = await adb('shell', 'getprop', 'ro.product.model');
  const release = await adb('shell', 'getprop', 'ro.build.version.release');
  return { serial, label: `${model} (Android ${release})`, adb };
}

export interface AndroidTab {
  /** Evaluates in the page, awaiting promises; a frozen tab fails after `timeoutMs`. */
  evaluate<T>(expression: string, timeoutMs?: number): Promise<T>;
  /** Every console message of the page. */
  onConsole(listener: (type: string, text: string) => void): void;
  /** `globalThis[name](payload)` in the page calls `handler` on the host (Runtime.addBinding). */
  bind(name: string, handler: (payload: string) => void): Promise<void>;
  /** Runs `source` in every document the tab loads from now on. */
  addInitScript(source: string): Promise<void>;
  /** Loads `url` in the tab and resolves on its load event. */
  navigate(url: string): Promise<void>;
  screenshot(): Promise<Uint8Array>;
  /** Console errors and uncaught exceptions of the page. */
  errors: string[];
  close(): Promise<void>;
}

/** Opens `url` in a new Chrome tab of the device; the host port is reversed to the device. */
export async function openAndroidTab(device: AndroidDevice, url: string, hostPort: number): Promise<AndroidTab> {
  await device.adb('reverse', `tcp:${hostPort}`, `tcp:${hostPort}`);
  const forward = Number(await device.adb('forward', 'tcp:0', 'localabstract:chrome_devtools_remote'));
  const origin = `http://127.0.0.1:${forward}`;
  const release = async (): Promise<void> => {
    await device.adb('reverse', '--remove', `tcp:${hostPort}`).catch(() => undefined);
    await device.adb('forward', '--remove', `tcp:${forward}`).catch(() => undefined);
  };
  try {
    await device.adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `'${url}'`, 'com.android.chrome');
    interface Target { id: string; url: string; webSocketDebuggerUrl: string }
    let target: Target | undefined;
    for (const end = Date.now() + 60_000; !target && Date.now() < end; await new Promise(resolve => setTimeout(resolve, 500))) {
      const pages = await (await fetch(`${origin}/json/list`, { signal: AbortSignal.timeout(10_000) })).json() as Target[];
      target = pages.find(page => page.url === url);
    }
    if (!target) throw new Error(`The tab ${url} did not open on the device (keep it unlocked).`);
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('CDP connection failed')), { once: true });
    });
    let id = 0;
    const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
    const errors: string[] = [];
    const consoleListeners: ((type: string, text: string) => void)[] = [];
    const bindings = new Map<string, (payload: string) => void>();
    let loaded: (() => void) | undefined;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number; result?: unknown; error?: { message: string }; method?: string;
        params?: {
          type?: string; args?: { value?: unknown; description?: string }[]; name?: string; payload?: string;
          exceptionDetails?: { exception?: { description?: string }; text?: string };
        };
      };
      if (message.method === 'Runtime.consoleAPICalled') {
        const text = message.params?.args?.map(arg => String(arg.value ?? arg.description ?? '')).join(' ') ?? '';
        if (message.params?.type === 'error') errors.push(text);
        for (const listener of consoleListeners) listener(message.params?.type ?? 'log', text);
      } else if (message.method === 'Runtime.bindingCalled') {
        bindings.get(message.params?.name ?? '')?.(message.params?.payload ?? '');
      } else if (message.method === 'Page.loadEventFired') {
        loaded?.();
      } else if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params?.exceptionDetails;
        errors.push(details?.exception?.description ?? details?.text ?? 'exception');
      }
      const request = message.id === undefined ? undefined : pending.get(message.id);
      if (!request) return;
      pending.delete(message.id!);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    const send = (method: string, params: object = {}, timeoutMs = 30_000): Promise<unknown> => new Promise((resolve, reject) => {
      const key = ++id;
      // A crashed or frozen tab never answers: do not wait forever.
      const timer = setTimeout(() => { pending.delete(key); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
      pending.set(key, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      socket.send(JSON.stringify({ id: key, method, params }));
    });
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.bringToFront');
    const targetId = target.id;
    return {
      errors,
      async evaluate<T>(expression: string, timeoutMs = 30_000): Promise<T> {
        const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs) as {
          result: { value: T }; exceptionDetails?: { exception?: { description?: string }; text: string };
        };
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        return result.result.value;
      },
      onConsole(listener: (type: string, text: string) => void): void {
        consoleListeners.push(listener);
      },
      async bind(name: string, handler: (payload: string) => void): Promise<void> {
        bindings.set(name, handler);
        await send('Runtime.addBinding', { name });
      },
      async addInitScript(source: string): Promise<void> {
        await send('Page.addScriptToEvaluateOnNewDocument', { source });
      },
      async navigate(target: string): Promise<void> {
        const load = new Promise<void>(resolve => { loaded = resolve; });
        await send('Page.navigate', { url: target });
        await Promise.race([load, new Promise((_, reject) => setTimeout(() => reject(new Error(`Load timeout: ${target}`)), 120_000))]);
      },
      async screenshot(): Promise<Uint8Array> {
        const { data } = await send('Page.captureScreenshot', { format: 'png' }) as { data: string };
        return Uint8Array.from(atob(data), character => character.charCodeAt(0));
      },
      async close(): Promise<void> {
        socket.close();
        await fetch(`${origin}/json/close/${targetId}`, { signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
        await release();
      },
    };
  } catch (error) {
    await release();
    throw error;
  }
}
