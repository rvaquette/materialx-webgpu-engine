import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
  '.wasm': 'application/wasm', '.json': 'application/json',
  '.mtlx': 'application/xml', '.usda': 'text/plain', '.obj': 'text/plain',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.css': 'text/css',
};

/** Local render server: compiled code, live workspace scenes and local WASM assets. */
export async function createShaderballStaticServer({ root, port, coreRoot, libraryRoot, playgroundRoot }) {
  const output = join(root, 'dist-shaderball');
  if (!existsSync(join(output, 'usd-image-harness.html'))) {
    throw new Error('Missing compiled shaderball harness. Run npm run build:shaderball first.');
  }
  const routes = [
    ['/scenes/', join(root, 'scenes')],
    ['/materialx/libraries/', libraryRoot],
    ['/materialx/', coreRoot],
    ['/openusd/', join(root, 'node_modules', '@needle-tools', 'usd', 'src', 'bindings')],
    ['/playground/', playgroundRoot],
    ['/', output],
  ];
  const server = createServer(async (request, response) => {
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    response.setHeader('Cache-Control', 'no-cache');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405).end();
      return;
    }
    let path;
    try { path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { response.writeHead(400).end('Invalid URL'); return; }
    if (path === '/__shaderball_idle__') {
      response.setHeader('Content-Type', MIME['.html']);
      response.end(request.method === 'HEAD' ? undefined : '<!doctype html><title>Shaderball ready</title>');
      return;
    }
    const [prefix, directory] = routes.find(([prefix]) => path.startsWith(prefix));
    const base = resolve(directory);
    const file = resolve(base, path.slice(prefix.length));
    const rel = relative(base, file);
    if (rel.startsWith('..') || isAbsolute(rel) || path.includes('\\') || path.includes('\0')) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    try {
      const info = await stat(file);
      if (!info.isFile()) { response.writeHead(404).end('Not found'); return; }
      response.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
      response.setHeader('Content-Length', info.size);
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = createReadStream(file);
      stream.on('error', error => {
        console.error(`[shaderball-static] ${file}: ${error.message}`);
        response.destroy(error);
      });
      stream.pipe(response);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') response.writeHead(404).end('Not found');
      else {
        console.error(`[shaderball-static] ${file}: ${error.message}`);
        response.writeHead(500).end('File read failed');
      }
    }
  });
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', done);
  });
  return {
    httpServer: server,
    close: () => new Promise((done, reject) => {
      server.close(error => error ? reject(error) : done());
      server.closeIdleConnections();
    }),
  };
}
