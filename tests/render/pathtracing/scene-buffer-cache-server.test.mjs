import { describe, expect, it } from 'vitest';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { unlink, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { sceneBufferCacheMiddleware } from '../../../scripts/pathtracer-cache-server.mjs';
import { decodeSceneBufferCache, encodeSceneBufferCache, equalPreparedGeometry } from '../../../src/render/pathtracing/scene-buffer-cache.ts';

describe('loopback file-cache server persistence', () => {
  it('persists exact binary across server restart, rejects unsafe requests, repairs corrupt disk', async () => {
    const key = randomBytes(32).toString('hex'), root = process.cwd();
    const file = join(root, '.cache', 'pathtracer', `${key}.bin`);
    const scene = {
      nodeCount: 1, triangleCount: 1, bounds: { min: [0, 0, 0], max: [1, 1, 0] },
      nodes: new Float32Array([0, 0, 0, -1, 1, 1, 0, -1, 0, 1, 0, 0]),
      triangles: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, ...Array(15).fill(0)]),
      triangleOrder: new Uint32Array([0]), triangleUv: new Float32Array(6), triangleTangent: new Float32Array(),
    };
    const bytes = await encodeSceneBufferCache(scene, key, 1);
    let server;
    const start = async () => {
      const middleware = sceneBufferCacheMiddleware(root);
      server = createServer((req, res) => { void middleware(req, res, () => { res.statusCode = 404; res.end(); }); });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      return `http://127.0.0.1:${server.address().port}/__pathtracer_cache__`;
    };
    const close = () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    const put = (url, value) => fetch(`${url}/${key}.bin`, {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: value,
    });
    try {
      let url = await start();
      expect((await fetch(`${url}/${key}.bin`)).status).toBe(404);
      expect((await put(url, bytes)).status).toBe(204);
      expect(new Uint8Array(await readFile(file))).toEqual(bytes);
      expect((await fetch(`${url}/${key}.bin`, { method: 'PUT', headers: { Origin: 'https://evil.example' }, body: bytes })).status).toBe(403);
      const unsafeHost = await new Promise((resolve, reject) => {
        const req = request(`${url}/${key}.bin`, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
        req.on('error', reject);
        req.end();
      });
      expect(unsafeHost).toBe(403);
      expect((await fetch(`${url}/bad.bin`, { method: 'PUT', body: bytes })).status).toBe(400);
      expect((await fetch(`${url}/${key}.bin`, { method: 'DELETE' })).status).toBe(405);
      expect((await fetch(`${url}/${key}.bin`, { method: 'PUT', body: bytes })).status).toBe(415);
      await close();
      url = await start();
      const reloaded = new Uint8Array(await (await fetch(`${url}/${key}.bin`)).arrayBuffer());
      expect(equalPreparedGeometry(scene, await decodeSceneBufferCache(reloaded, key))).toBe(true);
      await writeFile(file, bytes.slice(0, 17));
      await expect(decodeSceneBufferCache(new Uint8Array(await (await fetch(`${url}/${key}.bin`)).arrayBuffer()), key)).rejects.toThrow('Corrupt');
      expect((await put(url, bytes)).status).toBe(204);
      expect(equalPreparedGeometry(scene, await decodeSceneBufferCache(new Uint8Array(await readFile(file)), key))).toBe(true);
    } finally {
      if (server?.listening) await close();
      await unlink(file).catch(() => {});
    }
  });
});
