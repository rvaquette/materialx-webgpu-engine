import { test } from 'node:test';
import assert from 'node:assert/strict';
import { median, compareHdr, summarize } from './benchmark-pathtracer.mjs';

test('median validates measurements without mutating input', () => {
  const values = [8, 2, 4, 6];
  assert.equal(median(values), 5);
  assert.deepEqual(values, [8, 2, 4, 6]);
  assert.equal(median([9, 2, 3]), 3);
  assert.throws(() => median([]));
  assert.throws(() => median([NaN]));
});

test('HDR comparison checks exact RGB and sample counts', () => {
  const hdr = new Float32Array([0.2, 0.3, 0.4, 8]);
  assert.deepEqual(compareHdr(hdr, hdr.slice(), 8), { identical: true, maxAbsoluteError: 0 });
  assert.equal(compareHdr(hdr, new Float32Array([0.5, 0.3, 0.4, 8]), 8).identical, false);
  assert.throws(() => compareHdr(hdr, new Float32Array(8), 8));
  assert.throws(() => compareHdr(hdr, new Float32Array([NaN, 0, 0, 8]), 8));
  assert.throws(() => compareHdr(hdr, new Float32Array([0.2, 0.3, 0.4, 7]), 8));
});

test('summaries exclude warmup and never substitute wall time for GPU time', () => {
  const row = { scene: 'gold', variant: '8x8', parity: { identical: true } };
  const result = summarize([
    { ...row, warmup: true, renderMs: 1000, gpuMs: 900 },
    { ...row, warmup: false, renderMs: 20, gpuMs: 10 },
    { ...row, warmup: false, renderMs: 40, gpuMs: null },
  ]);
  assert.equal(result[0].wallMedianMs, 30);
  assert.equal(result[0].gpuMedianMs, null);
  assert.equal(result[0].repetitions, 2);
  assert.equal(result[0].identical, true);
});
