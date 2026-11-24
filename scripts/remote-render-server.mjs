// Remote render server: runs material scripts (docs/SCRIPTING.md) sent by the web viewer in the
// built app (dist/) inside headless Chrome on this machine's GPU, and streams the rendering
// progress, intermediate frames, `log` messages and `save(...)` files back as server-sent events.
// It only listens on 127.0.0.1: expose it through a tunnel (docs/REMOTE_RENDER.md).
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { corsHeaders, createAuthenticator } from './remote-render-auth.mjs';
import { root } from './export-browser-session.mjs';

const HELP = `Usage: npm run render:remote -- [--port 8787] [--origin https://rvaquette.github.io ...] [--dist dist]
  [--timeout 1800] [--frame-interval 1000] [--max-queue 4] [--gpu high-performance|low-power|default] [--headed]

Authentication (at least one; both are checked when set):
  MX_REMOTE_TOKEN            shared bearer token, 32+ characters, entered once in the viewer
  MX_REMOTE_ACCESS_TEAM      Cloudflare Access team domain, e.g. myteam.cloudflareaccess.com
  MX_REMOTE_ACCESS_AUD       Access application audience (AUD) tag
  MX_REMOTE_EMAILS           optional comma-separated e-mail allowlist for Access users
MX_REMOTE_ORIGINS (comma-separated) adds allowed web origins; MX_CHROME selects the browser and
MX_CHROME_ARGS (space-separated) adds Chrome flags, e.g. for Linux GPU VMs. See docs/REMOTE_RENDER.md.`;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.mtlx': 'application/xml', '.xml': 'application/xml',
  '.usda': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.hdr': 'application/octet-stream', '.exr': 'application/octet-stream',
};
const WEBGPU_ARGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'];
const GPU_ARGS = { 'high-performance': ['--force_high_performance_gpu'], 'low-power': ['--force_low_power_gpu'], default: [] };
const MAX_SCRIPT_BYTES = 512 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

const log = message => console.log(`[remote-render] ${new Date().toISOString()} ${message}`);

/** Serves the built viewer to the local browser only, cross-origin isolated (binary USD). */
async function startStaticServer(dist) {
  if (!existsSync(join(dist, 'index.html'))) throw new Error(`${dist}/index.html is missing: run npm run build first.`);
  const server = createServer(async (request, response) => {
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    response.setHeader('Cache-Control', 'no-cache');
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    let path;
    try { path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { response.writeHead(400).end(); return; }
    const file = resolve(dist, `.${path.endsWith('/') ? `${path}index.html` : path}`);
    const rel = relative(dist, file);
    if (rel.startsWith('..') || isAbsolute(rel) || path.includes('\0')) { response.writeHead(403).end(); return; }
    try {
      const info = await stat(file);
      if (!info.isFile()) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': info.size });
      if (request.method === 'HEAD') { response.end(); return; }
      createReadStream(file).on('error', error => response.destroy(error)).pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((done, reject) => server.once('error', reject).listen(0, '127.0.0.1', done));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(done => server.close(done)) };
}

/** Event stream of one job; writes are dropped once the client is gone. */
function eventStream(response) {
  let open = true;
  const ping = setInterval(() => open && response.write(': ping\n\n'), 15_000);
  response.on('close', () => { open = false; clearInterval(ping); });
  return {
    get open() { return open; },
    send(event, data) { if (open) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); },
    end() { clearInterval(ping); if (open) response.end(); open = false; },
  };
}

async function readJson(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Script too large.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON body.'), { status: 400 }); }
}

/** Runs one script in a fresh browser context restricted to the local static server. */
async function runJob({ browser, appOrigin, script, stream, signal, timeoutMs, frameIntervalMs }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', acceptDownloads: false });
  const abort = () => { void context.close().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  let outputBytes = 0;
  // The viewer reports errors while its page is torn down; they are not the script's.
  let forward = true;
  try {
    // Scripts are JavaScript: the page may only reach the app's own files (no LAN, no exfiltration).
    await context.route('**/*', route => (new URL(route.request().url()).origin === appOrigin ? route.continue() : route.abort('blockedbyclient')));
    await context.routeWebSocket(/.*/, socket => socket.close());
    await context.addInitScript(() => {
      for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel']) {
        Object.defineProperty(globalThis, name, { value: undefined, configurable: false, writable: false });
      }
    });
    await context.exposeBinding('__mxSaveFile', async (_source, name, base64) => {
      const file = basename(String(name)).slice(0, 200) || 'output.bin';
      outputBytes += base64.length * 3 / 4;
      if (outputBytes > MAX_OUTPUT_BYTES) throw new Error('Remote output limit exceeded (256 MiB).');
      stream.send('file', { name: file, data: base64 });
    });
    const page = await context.newPage();
    page.on('console', message => {
      if (!forward) return;
      const text = message.text();
      if (text.startsWith('[script]')) stream.send('log', { message: text.slice(9) });
      else if (message.type() === 'error') stream.send('log', { level: 'error', message: text.slice(0, 2000) });
    });
    page.on('pageerror', error => forward && stream.send('log', { level: 'error', message: error.message.slice(0, 2000) }));
    stream.send('status', { stage: 'loading' });
    await page.goto(`${appOrigin}/`);
    await page.waitForFunction(() => typeof globalThis.__mxRunScript === 'function', undefined, { timeout: 120_000 });
    stream.send('status', { stage: 'running' });

    let finished = false;
    const frames = (async () => {
      let lastFrame = '';
      let lastProgress = '';
      while (!finished && stream.open) {
        await sleep(frameIntervalMs);
        if (finished) break;
        try {
          const progress = await page.evaluate(() => globalThis.__mxProgress?.());
          const json = JSON.stringify(progress ?? {});
          if (json !== lastProgress) { lastProgress = json; stream.send('progress', progress ?? {}); }
          const frame = await page.evaluate(captureView);
          if (frame && frame !== lastFrame) { lastFrame = frame; stream.send('frame', { image: frame }); }
        } catch { /* the page is busy loading or closing; try again at the next tick */ }
      }
    })();
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Script timed out after ${timeoutMs / 1000} s.`)), timeoutMs); });
    let result;
    try { result = await Promise.race([page.evaluate(code => globalThis.__mxRunScript(code), script), timeout]); }
    finally {
      clearTimeout(timer);
      finished = true;
      await frames;
    }
    const frame = await page.evaluate(captureView).catch(() => undefined);
    if (frame) stream.send('frame', { image: frame });
    stream.send('progress', await page.evaluate(() => globalThis.__mxProgress?.()).catch(() => ({})) ?? {});
    forward = false;
    return result;
  } finally {
    forward = false;
    signal.removeEventListener('abort', abort);
    await context.close().catch(() => {});
  }
}

/** The viewer canvas as a WebP data URL (runs in the page). */
async function captureView() {
  const canvas = document.getElementById('view');
  if (!(canvas instanceof HTMLCanvasElement) || !canvas.width) return undefined;
  const blob = await new Promise(done => canvas.toBlob(done, 'image/webp', 0.92));
  if (!blob) return undefined;
  return new Promise((done, reject) => {
    const reader = new FileReader();
    reader.onload = () => done(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function main() {
  const { values } = parseArgs({ options: {
    port: { type: 'string', default: '8787' }, origin: { type: 'string', multiple: true, default: [] },
    dist: { type: 'string', default: 'dist' }, timeout: { type: 'string', default: '1800' },
    'frame-interval': { type: 'string', default: '1000' }, 'max-queue': { type: 'string', default: '4' },
    gpu: { type: 'string', default: 'high-performance' }, headed: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) { console.log(HELP); return; }
  const integer = (name, min) => {
    const value = Number(values[name]);
    if (!Number.isSafeInteger(value) || value < min) throw new Error(`--${name} must be an integer >= ${min}.`);
    return value;
  };
  const port = integer('port', 1);
  const timeoutMs = integer('timeout', 1) * 1000;
  const frameIntervalMs = Math.max(250, integer('frame-interval', 1));
  const maxQueue = integer('max-queue', 0);
  const gpuArgs = GPU_ARGS[values.gpu];
  if (!gpuArgs) throw new Error('--gpu must be high-performance, low-power or default.');
  const origins = [...new Set([
    ...values.origin, ...(process.env.MX_REMOTE_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(Boolean),
  ])];
  if (!origins.length) origins.push('https://rvaquette.github.io');
  const env = process.env;
  const authenticate = createAuthenticator({
    token: env.MX_REMOTE_TOKEN || undefined,
    access: env.MX_REMOTE_ACCESS_TEAM || env.MX_REMOTE_ACCESS_AUD ? {
      team: env.MX_REMOTE_ACCESS_TEAM ?? '', audience: env.MX_REMOTE_ACCESS_AUD ?? '',
      emails: (env.MX_REMOTE_EMAILS ?? '').split(',').map(email => email.trim()).filter(Boolean),
    } : undefined,
  });
  if ((env.MX_REMOTE_ACCESS_TEAM && !env.MX_REMOTE_ACCESS_AUD) || (!env.MX_REMOTE_ACCESS_TEAM && env.MX_REMOTE_ACCESS_AUD)) {
    throw new Error('Set both MX_REMOTE_ACCESS_TEAM and MX_REMOTE_ACCESS_AUD.');
  }

  const app = await startStaticServer(resolve(root, values.dist));
  const launch = () => chromium.launch({
    headless: !values.headed, args: [...WEBGPU_ARGS, ...gpuArgs, ...(env.MX_CHROME_ARGS ?? '').split(/\s+/).filter(Boolean)],
    ...(env.MX_CHROME ? { executablePath: env.MX_CHROME } : { channel: 'chrome' }),
  });
  let browser = await launch();
  let running;
  let queued = 0;
  let tail = Promise.resolve();

  const server = createServer(async (request, response) => {
    const cors = corsHeaders(request.headers.origin, origins);
    if (cors) for (const [name, value] of Object.entries(cors)) response.setHeader(name, value);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const path = new URL(request.url, 'http://localhost').pathname;
    // A browser request from any other site is refused before authentication.
    if (request.headers.origin && !cors) { response.writeHead(403).end('Origin not allowed.'); return; }
    if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
    if (request.method === 'GET' && path === '/') {
      // Landing page: opening it once logs the browser in to Cloudflare Access.
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('MaterialX remote render server.\n');
      return;
    }
    let user;
    try { user = await authenticate(request.headers); }
    catch (error) {
      log(`refused ${request.method} ${path} from ${request.headers['cf-connecting-ip'] ?? request.socket.remoteAddress}: ${error.message}`);
      response.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    if (request.method === 'GET' && path === '/status') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify({ busy: Boolean(running), queued, maxQueue }));
      return;
    }
    if (request.method !== 'POST' || path !== '/jobs') { response.writeHead(404).end(); return; }
    // application/json forces a CORS preflight: plain forms from other sites cannot post jobs.
    if (!/^application\/json\b/i.test(request.headers['content-type'] ?? '')) { response.writeHead(415).end(); return; }
    let body;
    try { body = await readJson(request, MAX_SCRIPT_BYTES); }
    catch (error) { response.writeHead(error.status ?? 400).end(error.message); return; }
    if (typeof body?.script !== 'string' || !body.script.trim()) { response.writeHead(400).end('Expected { "script": "..." }.'); return; }
    if (queued + (running ? 1 : 0) > maxQueue) { response.writeHead(429, { 'Retry-After': '30' }).end('Render queue full.'); return; }

    response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    response.flushHeaders();
    const stream = eventStream(response);
    const controller = new AbortController();
    response.on('close', () => controller.abort());
    const position = queued + (running ? 1 : 0);
    queued++;
    if (position) stream.send('status', { stage: 'queued', position });
    const job = tail.then(async () => {
      queued--;
      if (controller.signal.aborted) return;
      const started = performance.now();
      running = { user: user.email };
      log(`job by ${user.email}: ${body.script.length} bytes`);
      try {
        if (!browser.isConnected()) browser = await launch();
        const result = await runJob({ browser, appOrigin: app.origin, script: body.script, stream, signal: controller.signal, timeoutMs, frameIntervalMs });
        stream.send('done', result);
        log(`job by ${user.email}: ${result.ok ? 'ok' : `failed (${result.message})`} in ${((performance.now() - started) / 1000).toFixed(1)} s`);
      } catch (error) {
        const message = controller.signal.aborted ? 'Cancelled by the client.' : error.message;
        stream.send('done', { ok: false, message });
        log(`job by ${user.email}: ${message}`);
      } finally {
        running = undefined;
        stream.end();
      }
    });
    tail = job.catch(() => {});
  });
  await new Promise((done, reject) => server.once('error', reject).listen(port, '127.0.0.1', done));
  log(`listening on http://127.0.0.1:${port} for ${origins.join(', ')}; app ${app.origin}; GPU ${values.gpu}`);

  const shutdown = async () => {
    log('stopping');
    server.close();
    server.closeAllConnections();
    await browser.close().catch(() => {});
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch(error => { console.error(`[remote-render] ${error.message}`); process.exitCode = 1; });
