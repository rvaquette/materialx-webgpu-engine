import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createShaderballStaticServer } from './shaderball-static-server.mjs';

test('static shaderball server serves compiled code and live assets', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'shaderball-static-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = {
    root, port: 0, coreRoot: join(root, 'core'),
    libraryRoot: join(root, 'libraries'), playgroundRoot: join(root, 'playground'),
  };
  await assert.rejects(createShaderballStaticServer(options), /npm run build:shaderball/);
  const fixtures = [
    ['dist-shaderball', 'usd-image-harness.html', '<script type="module" src="/assets/harness.js"></script>'],
    ['dist-shaderball/assets', 'harness.js', 'export const compiled = true;'],
    ['scenes', 'scene.usda', '#usda 1.0'],
    ['core', 'runtime.wasm', 'wasm-fixture'],
    ['libraries', 'material.mtlx', '<materialx/>'],
    ['playground', 'example.json', '{}'],
    ['node_modules/@needle-tools/usd/src/bindings', 'usd.js', 'export {};'],
  ];
  for (const [directory, name, content] of fixtures) {
    const target = join(root, ...directory.split('/'));
    await mkdir(target, { recursive: true });
    await writeFile(join(target, name), content);
  }
  const server = await createShaderballStaticServer(options);
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  for (const [path, contentType, content] of [
    ['/usd-image-harness.html', 'text/html', fixtures[0][2]],
    ['/assets/harness.js', 'application/javascript', fixtures[1][2]],
    ['/scenes/scene.usda', 'text/plain', fixtures[2][2]],
    ['/materialx/runtime.wasm', 'application/wasm', fixtures[3][2]],
    ['/materialx/libraries/material.mtlx', 'application/xml', fixtures[4][2]],
    ['/playground/example.json', 'application/json', '{}'],
    ['/openusd/usd.js', 'application/javascript', 'export {};'],
  ]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').startsWith(contentType));
    assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(response.headers.get('cross-origin-embedder-policy'), 'require-corp');
    assert.equal(await response.text(), content);
  }
  const head = await fetch(origin + '/materialx/runtime.wasm', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('content-length')), fixtures[3][2].length);
  assert.equal(await head.text(), '');
  const idle = await fetch(origin + '/__shaderball_idle__');
  assert.doesNotMatch(await idle.text(), /script|raster|wasm/i);
  for (const [path, status] of [
    ['/missing.js', 404], ['/scenes/', 404],
    ['/scenes/..%2f.gitignore', 403], ['/scenes/%5csecret', 403],
    ['/scenes/%00', 403], ['/scenes/%ZZ', 400],
  ]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, status, path);
    await response.text();
  }
  const post = await fetch(origin + '/usd-image-harness.html', { method: 'POST' });
  assert.equal(post.status, 405);
  await post.text();
});
