import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function displayUrls(origin, cases, values) {
  return cases.map(({ backend, override }) => {
    const query = new URLSearchParams({
      entry: values.entry, res: values.res, backend,
    });
    if (override) query.set('openpbr', override);
    return `${origin}/index.html?${query}`;
  });
}

export async function displayShaderball(urls, { integrated, chromePath }) {
  const ready = await fetch(urls[0]);
  if (!ready.ok) throw new Error(`Interactive viewer unavailable: HTTP ${ready.status}. In static mode, run npm run build:shaderball.`);
  await ready.arrayBuffer();
  console.log('[shaderball] Display mode: no PNG files or JSON report. Stop with Ctrl+C.');
  console.log('[shaderball] Live WebGPU canvas: drag to orbit, wheel to zoom. Progressive path tracing; --spp does not limit interactive rendering.');
  for (const url of urls) console.log(`[shaderball] ${url}`);
  if (integrated) {
    console.log('[shaderball] VS Code: run "Browser: Open Integrated Browser" (or "Simple Browser: Show") and paste a URL above. WebGPU support depends on the embedded browser.');
  }
  let chrome;
  const profile = integrated ? undefined : mkdtempSync(join(tmpdir(), 'mx-shaderball-display-'));
  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      let stopping = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
        error ? reject(error) : resolve();
      };
      const stop = async () => {
        if (stopping) return;
        stopping = true;
        if (chrome && chrome.exitCode === null) {
          let socket;
          try {
            const [port] = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/);
            const version = await fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json());
            const debuggerUrl = new URL(version.webSocketDebuggerUrl);
            debuggerUrl.hostname = '127.0.0.1';
            socket = new WebSocket(debuggerUrl);
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error('Chrome shutdown timeout')), 5000);
              socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method: 'Browser.close' })), { once: true });
              socket.addEventListener('message', () => { clearTimeout(timeout); resolve(); }, { once: true });
              socket.addEventListener('close', () => { clearTimeout(timeout); resolve(); }, { once: true });
              socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Chrome shutdown connection failed')); }, { once: true });
            });
          } catch (error) {
            console.warn(`[shaderball] Graceful Chrome shutdown failed: ${error.message}`);
            chrome.kill();
          } finally {
            socket?.close();
          }
        } else finish();
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      if (!integrated) {
        chrome = spawn(chromePath, [
          '--enable-unsafe-webgpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
          `--user-data-dir=${profile}`, ...urls,
        ], { stdio: 'ignore' });
        chrome.once('error', finish);
        chrome.once('close', (code, signal) => {
          finish(code && !signal && !stopping ? new Error(`Chrome exited with code ${code}`) : undefined);
        });
      }
    });
  } finally {
    if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}
