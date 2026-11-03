import { mkdir, lstat, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_BYTES = 512 * 1024 * 1024;

/** Same-origin, loopback-only Vite middleware. The client supplies only a SHA key. */
export function sceneBufferCacheMiddleware(root) {
  const cacheRoot = join(resolve(root), '.cache', 'pathtracer');
  const safeDirectory = async () => {
    for (const directory of [join(resolve(root), '.cache'), cacheRoot]) {
      await mkdir(directory, { recursive: true });
      if ((await lstat(directory)).isSymbolicLink()) throw new Error('Cache directory cannot be a link');
    }
  };
  return async (req, res, next) => {
    if (!req.url?.startsWith('/__pathtracer_cache__')) { next(); return; }
    const reply = (status, text) => { res.statusCode = status; res.end(text); };
    const match = /^\/__pathtracer_cache__\/([a-f0-9]{64})\.bin$/.exec(req.url);
    if (!match) { reply(400, 'Invalid cache key'); return; }
    const host = req.headers.host;
    if (!/^(localhost|127\.0\.0\.1):\d+$/.test(host ?? '') ||
        !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) ||
        (req.headers.origin && req.headers.origin !== `http://${host}`) ||
        (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) {
      reply(403, 'Local same-origin requests only'); return;
    }
    if (!['GET', 'PUT'].includes(req.method)) { reply(405, 'GET or PUT only'); return; }
    const file = join(cacheRoot, `${match[1]}.bin`);
    let staging;
    try {
      await safeDirectory();
      const stat = await lstat(file).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
      if (stat && (!stat.isFile() || stat.isSymbolicLink())) { reply(403, 'Cache file cannot be a link'); return; }
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.method === 'GET') {
        if (!stat) { reply(404, 'Cache absent'); return; }
        if (stat.size > MAX_BYTES) { reply(413, 'Cache too large'); return; }
        const bytes = await readFile(file);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', bytes.length);
        res.end(bytes);
        return;
      }
      if (req.headers['content-type'] !== 'application/octet-stream') { reply(415, 'Binary body required'); return; }
      if (Number(req.headers['content-length']) > MAX_BYTES) { reply(413, 'Cache too large'); return; }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BYTES) { reply(413, 'Cache too large'); return; }
        chunks.push(chunk);
      }
      if (size < 48) { reply(400, 'Cache body too short'); return; }
      staging = join(cacheRoot, `${match[1]}.${randomUUID()}.partial`);
      await writeFile(staging, Buffer.concat(chunks), { flag: 'wx' });
      await rename(staging, file);
      staging = undefined;
      reply(204, '');
    } catch (error) {
      console.error(`Pathtracer file cache: ${error.message}`);
      if (!res.headersSent) reply(500, 'Local cache unavailable');
      else res.destroy(error);
    } finally {
      if (staging) {
        try {
          await unlink(staging);
        } catch (error) {
          if (error.code !== 'ENOENT') {
            console.error(`Pathtracer file cache staging cleanup failed: ${error.message}`);
          }
        }
      }
    }
  };
}

export function sceneBufferCachePlugin(root) {
  return { name: 'pathtracer-local-file-cache', configureServer(server) {
    server.middlewares.use(sceneBufferCacheMiddleware(root));
  } };
}
