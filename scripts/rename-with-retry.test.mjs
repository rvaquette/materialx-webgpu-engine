import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renameWithRetry } from './rename-with-retry.mjs';

test('retries transient rename errors and publishes the completed directory', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'scene-rename-test-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'scene.partial');
  const destination = join(directory, 'scene');
  await mkdir(source);
  await writeFile(join(source, 'material.json'), 'complete');
  const { rename } = await import('node:fs/promises');
  let attempts = 0;
  const delays = [];
  await renameWithRetry(source, destination, async (...paths) => {
    if (++attempts <= 2) throw Object.assign(new Error('locked'), { code: 'EPERM' });
    await rename(...paths);
  }, async delay => { delays.push(delay); });
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [200, 400]);
  assert.equal(await readFile(join(destination, 'material.json'), 'utf8'), 'complete');
});

test('reports the original error after retries are exhausted', async () => {
  const error = Object.assign(new Error('locked'), { code: 'EACCES' });
  let attempts = 0;
  await assert.rejects(renameWithRetry('source', 'destination', async () => {
    attempts++;
    throw error;
  }, async () => {}), thrown => thrown === error);
  assert.equal(attempts, 11);
});

test('does not retry unrelated rename failures', async () => {
  const error = Object.assign(new Error('missing source'), { code: 'ENOENT' });
  let attempts = 0;
  await assert.rejects(renameWithRetry('source', 'destination', async () => {
    attempts++;
    throw error;
  }, async () => { throw new Error('unexpected retry'); }), thrown => thrown === error);
  assert.equal(attempts, 1);
});
