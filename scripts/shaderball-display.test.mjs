import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { displayUrls } from './shaderball-display.mjs';

test('display URLs preserve scene settings and optional material overrides', () => {
  const urls = displayUrls('http://127.0.0.1:5176', [
    { backend: 'pathtracing' }, { backend: 'raster', override: '/scenes/a b.mtlx' },
  ], { entry: '/scenes/pathtracer/ajax.usda', res: '512', spp: '16' });
  const first = new URL(urls[0]);
  assert.equal(first.pathname, '/index.html');
  assert.equal(first.searchParams.get('res'), '512');
  assert.equal(first.searchParams.has('spp'), false);
  assert.equal(first.searchParams.get('backend'), 'pathtracing');
  assert.equal(first.searchParams.get('entry'), '/scenes/pathtracer/ajax.usda');
  assert.equal(first.searchParams.has('session'), false);
  assert.equal(first.searchParams.has('openpbr'), false);
  assert.equal(new URL(urls[1]).searchParams.get('openpbr'), '/scenes/a b.mtlx');
});

test('integrated display serves the harness and exits cleanly on stop without launching Chrome', async () => {
  const server = createServer((request, response) => response.end('<!doctype html>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/usd-image-harness.html`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { displayShaderball } from './scripts/shaderball-display.mjs';
    process.on('message', () => process.emit('SIGINT'));
    await displayShaderball([${JSON.stringify(url)}], { integrated: true, chromePath: 'must-not-launch' });
    process.disconnect();
  `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = '';
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`Exit ${code}: ${output}`)));
  });
  const timer = setTimeout(() => child.kill(), 15000);
  try {
    child.stdout.on('data', data => {
      output += data;
      if (output.includes('VS Code:')) child.send('stop');
    });
    await closed;
    assert.match(output, /no PNG files or JSON report/);
    assert.ok(output.includes(url));
  } finally {
    clearTimeout(timer);
    child.kill();
    await new Promise(resolve => server.close(resolve));
  }
});
