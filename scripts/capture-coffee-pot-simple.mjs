#!/usr/bin/env node

import { spawn } from 'child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { setTimeout as sleep } from 'timers/promises';

const CHROME = process.env.MX_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.MX_PORT ?? 5173);
const HARNESS_URL = `http://127.0.0.1:${PORT}/test-coffee-pot.html`;
const CDP = 'http://127.0.0.1:9222';
const OUTPUT_DIR = './renders';

const log = (m) => console.log(`[capture-coffee-pot] ${m}`);

async function httpOk(url) {
  try {
    const r = await fetch(url);
    return r.ok;
  } catch {
    return false;
  }
}

async function waitFor(fn, attempts, label) {
  for (let i = 0; i < attempts; i++) {
    if (await fn()) return true;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function cdpList() {
  return fetch(`${CDP}/json/list`).then((r) => r.json());
}

async function fetchCanvasesViaCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const msgId = ++id;
      pending.set(msgId, resolve);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('CDP socket error')), { once: true });
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.reload', { ignoreCache: true });

  const evalExpr = async (expression) => {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res?.result?.result?.value;
  };

  // Wait for rendering to complete
  log('Waiting for rendering to complete (256 SPP)...');
  let isDone = false;
  for (let i = 0; i < 960; i++) {
    // Up to 4 minutes
    const ptStatus = await evalExpr(
      "document.getElementById('status-pt')?.textContent || ''"
    );
    const disneyStatus = await evalExpr(
      "document.getElementById('status-disney')?.textContent || ''"
    );
    
    if (i % 40 === 0) {
      log(`PT: ${ptStatus || 'pending'}`);
      log(`Disney: ${disneyStatus || 'pending'}`);
    }
    
    // Check if both reached 256 SPP
    if (
      ptStatus &&
      ptStatus.includes('256/256') &&
      disneyStatus &&
      disneyStatus.includes('256/256')
    ) {
      log(`Path Tracer: ${ptStatus}`);
      log(`Disney: ${disneyStatus}`);
      isDone = true;
      break;
    }
    
    await sleep(250);
  }
  
  if (!isDone) {
    log('Warning: Rendering may not be complete, proceeding anyway');
  }

  // Extract canvas images
  log('Extracting canvas images...');
  const canvasImages = await evalExpr(`
    (async () => {
      const ptCanvas = document.getElementById('canvas-pt');
      const disneyCanvas = document.getElementById('canvas-disney');
      return {
        pt: ptCanvas ? ptCanvas.toDataURL('image/png') : null,
        disney: disneyCanvas ? disneyCanvas.toDataURL('image/png') : null,
      };
    })()
  `);

  ws.close();
  return canvasImages;
}

async function main() {
  // Ensure output directory exists
  try {
    await import('fs').then((m) => {
      if (!m.existsSync(OUTPUT_DIR)) {
        m.mkdirSync(OUTPUT_DIR, { recursive: true });
      }
    });
  } catch (e) {
    // ignore
  }

  // Verify server is running
  if (!(await httpOk(HARNESS_URL))) {
    throw new Error(`Dev server not responding at ${HARNESS_URL}`);
  }
  log(`Dev server is ready at ${HARNESS_URL}`);

  // Launch Chrome with remote debugging
  const profile = mkdtempSync(join(tmpdir(), 'mx-coffee-pot-'));
  const chrome = spawn(CHROME, [
    '--remote-debugging-port=9222',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-unsafe-webgpu',
    '--new-window',
    HARNESS_URL,
  ]);

  try {
    // Wait for harness tab
    let page;
    await waitFor(async () => {
      const list = await cdpList().catch(() => []);
      page = list.find((t) => typeof t.url === 'string' && t.url.includes('/test-coffee-pot.html'));
      return Boolean(page);
    }, 80, 'harness tab');

    log('Connected to browser, starting rendering...');

    // Fetch and save canvas images
    const canvases = await fetchCanvasesViaCdp(page.webSocketDebuggerUrl);

    if (canvases.pt) {
      const data = canvases.pt.replace(/^data:image\/png;base64,/, '');
      const path = `./${OUTPUT_DIR}/coffee-pot-pt-256spp-${Date.now()}.png`;
      const { writeFileSync } = await import('fs');
      writeFileSync(path, Buffer.from(data, 'base64'));
      log(`✓ Path Tracer saved to ${path}`);
    } else {
      log('✗ Failed to get Path Tracer canvas');
    }

    if (canvases.disney) {
      const data = canvases.disney.replace(/^data:image\/png;base64,/, '');
      const path = `./${OUTPUT_DIR}/coffee-pot-disney-256spp-${Date.now()}.png`;
      const { writeFileSync } = await import('fs');
      writeFileSync(path, Buffer.from(data, 'base64'));
      log(`✓ Disney saved to ${path}`);
    } else {
      log('✗ Failed to get Disney canvas');
    }

    log('Done! Rendus sauvegardés dans ./renders/');
  } finally {
    chrome.kill();
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[capture-coffee-pot] ${err.message}`);
    process.exit(1);
  });
