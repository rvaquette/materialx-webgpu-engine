import { test } from 'node:test';
import assert from 'node:assert/strict';
import { median, compareHdr, summarize, debuggerPages, parseBenchmarkArgs,
  harnessReady, isTransientContextError } from './benchmark-pathtracer.mjs';

test('benchmark defaults to the fixed reference and supports only the cache experiment', () => {
  const defaults = parseBenchmarkArgs([]);
  assert.equal(defaults.target, 'local');
  assert.equal(defaults.res, '128');
  assert.equal(defaults.spp, '8');
  assert.equal(defaults.repeats, '5');
  assert.equal(defaults['cache-test'], false);
  assert.equal(parseBenchmarkArgs(['--cache-test'])['cache-test'], true);
  for (const flag of ['--bvh-test', '--bvh-candidate', '--sampling-test', '--profile-test',
    '--shading-profile', '--bsdf-test', '--architecture-test', '--reference-spp']) {
    assert.throws(() => parseBenchmarkArgs([flag]), /Unknown option/);
  }
});

test('CDP startup retries transient Android tunnel errors with an explicit diagnostic', async t => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed', { cause: { code: 'UND_ERR_SOCKET' } });
  });
  const warning = t.mock.method(console, 'warn', () => {});
  assert.deepEqual(await debuggerPages('http://127.0.0.1:1234'), []);
  assert.equal(warning.mock.callCount(), 1);
});

test('CDP startup does not hide HTTP errors', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 404 }));
  await assert.rejects(debuggerPages('http://127.0.0.1:1234'), /HTTP 404/);
});

test('median validates measurements without mutating input', () => {
  const values = [8, 2, 4, 6];
  assert.equal(median(values), 5);
  assert.deepEqual(values, [8, 2, 4, 6]);
  assert.equal(median([9, 2, 3]), 3);
  assert.throws(() => median([]));
  assert.throws(() => median([NaN]));
});

test('HDR comparison checks exact RGB and per-pixel sample counts', () => {
  const hdr = new Float32Array([0.2, 0.3, 0.4, 8]);
  assert.deepEqual(compareHdr(hdr, hdr.slice(), 8), { identical: true, maxAbsoluteError: 0 });
  assert.equal(compareHdr(hdr, new Float32Array([0.5, 0.3, 0.4, 8]), 8).identical, false);
  assert.throws(() => compareHdr(hdr, new Float32Array(8), 8));
  assert.throws(() => compareHdr(hdr, new Float32Array([NaN, 0, 0, 8]), 8));
  assert.throws(() => compareHdr(hdr, new Float32Array([0.2, 0.3, 0.4, 7]), 8));
});

test('reference summaries exclude warmup and never substitute wall time for GPU time', () => {
  const row = { scene: 'gold', variant: 'reference', parity: { identical: true } };
  const result = summarize([
    { ...row, warmup: true, renderMs: 1000, gpuMs: 900 },
    { ...row, warmup: false, renderMs: 20, gpuMs: 10 },
    { ...row, warmup: false, renderMs: 40, gpuMs: null },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].variant, 'reference');
  assert.equal(result[0].wallMedianMs, 30);
  assert.equal(result[0].gpuMedianMs, null);
  assert.equal(result[0].repetitions, 2);
  assert.equal(result[0].identical, true);
  assert.equal(summarize([{ ...row, warmup: false, renderMs: 20, gpuMs: 10,
    parity: { identical: false } }])[0].identical, false);
});

test('harness readiness retries only recognized transient CDP context errors', async () => {
  for (const message of ['Cannot find default execution context', 'Execution context was destroyed.',
    'Cannot find context with specified id', 'Not attached to an active page']) {
    assert.equal(isTransientContextError(new Error(message)), true);
    assert.equal(await harnessReady(async () => { throw new Error(message); }, '/reload'), false);
  }
  await assert.rejects(harnessReady(async () => { throw new Error('ReferenceError: broken harness'); }),
    /broken harness/);
  assert.equal(isTransientContextError(new Error('Uncaught Cannot find default execution context in user code')), false);
  let expression;
  assert.equal(await harnessReady(async value => { expression = value; return true; }, '/reload'), true);
  assert.match(expression, /location\.href === "\/reload"/);
});
