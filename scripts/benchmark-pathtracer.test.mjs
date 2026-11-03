import { test } from 'node:test';
import assert from 'node:assert/strict';
import { median, compareHdr, summarize, experimentVariants, compareBvhSummaries,
  averageHdr, hdrError, compareSamplingSummaries, debuggerPages, summarizeTraversalProfiles,
  summarizeShadingProfiles, summarizeArchitectureInventory } from './benchmark-pathtracer.mjs';

test('architecture inventory requires stable reference-only draws and exact triangle coverage', () => {
  const row = { scene: 'gold', variant: 'reference', bsdfEvaluation: 'reference',
    bvhTraversal: 'reference', workgroupSize: [8, 8], parity: { identical: true },
    sceneMetadata: { triangleCount: 6, instancing: { expandedTriangles: 6, uniqueTriangles: 4 } } };
  const [inventory] = summarizeArchitectureInventory([{ ...row, warmup: true }, row]);
  assert.equal(inventory.uniqueTriangles, 4);
  assert.match(inventory.interpretation, /not measured BLAS\/TLAS/);
  assert.deepEqual(summarizeArchitectureInventory([{ ...row, warmup: true }]), []);
  for (const change of [{ variant: 'unrolled' }, { parity: { identical: false } },
    { shadingProfile: {} }, { sceneMetadata: { ...row.sceneMetadata, triangleCount: 7 } }]) {
    assert.throws(() => summarizeArchitectureInventory([{ ...row, ...change }]), /architecture inventory/);
  }
  assert.throws(() => summarizeArchitectureInventory([row, {
    ...row, sceneMetadata: { triangleCount: 8, instancing: { expandedTriangles: 8, uniqueTriangles: 4 } },
  }]), /architecture inventory/);
});

test('BSDF summaries require exact closure inputs and negative self-test without claiming full shading attribution', () => {
  const row = { scene: 'gold', variant: 'profile', gpuMs: 100, shadingProfile: {
    workload: { calls: 42, evalCalls: 21, sampleCalls: 21 }, inputsIdentical: true,
    eventCountsIdentical: true, replayMismatchDetected: true, replayFirst: true,
    stages: [{ mode: 1, gpuMs: 150, identical: true }, { mode: 3, gpuMs: 60, identical: true },
      { mode: 2, gpuMs: 50, identical: true }, { mode: 0, gpuMs: 100, identical: true }],
  } };
  const [summary] = summarizeShadingProfiles([{ scene: 'gold', variant: 'reference', gpuMs: 80 }, row]);
  assert.equal(summary.pairedReductionMedianPercent, 50);
  assert.equal(summary.controlOverheadPercent, 25);
  assert.equal(summary.replayFirstReductionMedianPercent, 50);
  assert.match(summary.interpretation, /Material graphs, textures, opacity/);
  assert.throws(() => summarizeShadingProfiles([{ ...row, shadingProfile: { ...row.shadingProfile, inputsIdentical: false } }]), /Missing exact/);
  assert.throws(() => summarizeShadingProfiles([{ ...row, shadingProfile: { ...row.shadingProfile, replayMismatchDetected: false } }]), /Missing exact/);
  assert.throws(() => summarizeShadingProfiles([row, {
    ...row, shadingProfile: { ...row.shadingProfile, workload: { calls: 43 } },
  }]), /workload changed/);
  assert.throws(() => summarizeShadingProfiles([{
    ...row, shadingProfile: { ...row.shadingProfile, stages: [...row.shadingProfile.stages].reverse() },
  }]), /Missing exact/);
});

test('profiling exposes control overhead and replay sensitivity, not a fictional shading-time share', () => {
  const reference = { scene: 'gold', variant: 'reference', gpuMs: 100 };
  const row = { scene: 'gold', variant: 'profile', gpuMs: 110, traversalProfile: {
    workload: { rays: 42 }, rayInputsIdentical: true, eventCountsIdentical: true, replayMismatchDetected: true,
    replayFirst: false,
    stages: [{ mode: 1, gpuMs: 150, identical: true }, { mode: 3, gpuMs: 90, identical: true },
      { mode: 0, gpuMs: 110, identical: true }, { mode: 2, gpuMs: 55, identical: true }],
  } };
  const summary = summarizeTraversalProfiles([reference, row, { ...row, warmup: true, gpuMs: 999 }]);
  assert.equal(summary[0].repetitions, 1);
  assert.ok(Math.abs(summary[0].controlOverheadPercent - 10) < 1e-10);
  assert.equal(summary[0].replayReductionPercent, 50);
  assert.equal(summary[0].pairedReductionMedianPercent, 50);
  assert.equal(summary[0].replayFirstReductionMedianPercent, null);
  assert.equal(summary[0].controlFirstReductionMedianPercent, 50);
  assert.match(summary[0].interpretation, /not additive/);
  assert.equal(summarizeTraversalProfiles([{ ...reference, gpuMs: null }, { ...row, gpuMs: null }])[0].controlOverheadPercent, null);
  assert.throws(() => summarizeTraversalProfiles([{ ...row, traversalProfile: { ...row.traversalProfile, rayInputsIdentical: false } }]), /Missing exact/);
  assert.throws(() => summarizeTraversalProfiles([{ ...row, traversalProfile: { ...row.traversalProfile, replayMismatchDetected: false } }]), /Missing exact/);
  assert.throws(() => summarizeTraversalProfiles([row, { ...row, traversalProfile: { ...row.traversalProfile, workload: { rays: 43 } } }]), /workload changed/);
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

test('quality reference averages independent HDR means and sums sample counts', () => {
  const a = new Float32Array([1, 2, 3, 256]);
  const b = new Float32Array([3, 4, 5, 256]);
  const reference = averageHdr(a, b, 256);
  assert.deepEqual([...reference], [2, 3, 4, 512]);
  assert.deepEqual([...a], [1, 2, 3, 256]);
  assert.throws(() => averageHdr(a, new Float32Array([3, 4, 5, 128]), 256));
});

test('HDR error excludes sample counters, validates finite values and reports linear RGB RMSE', () => {
  const reference = new Float32Array([2, 2, 2, 512]);
  assert.deepEqual(hdrError(reference, new Float32Array([1, 1, 1, 8]), 512, 8),
    { mse: 1, rmse: 1, relativeRmse: 0.5 });
  assert.throws(() => hdrError(reference, new Float32Array([NaN, 1, 1, 8]), 512, 8));
  assert.throws(() => hdrError(reference, new Float32Array([1, 1, 1, 7]), 512, 8));
  assert.throws(() => hdrError(new Float32Array([0, 0, 0, 512]), new Float32Array([1, 1, 1, 8]), 512, 8));
});

test('convergence qualification requires comparable measured GPU budgets, not a time-normalized proxy', () => {
  const reference = { scene: 'gold', variant: 'pcg', gpuMedianMs: 100, rmseMedian: 1 };
  const candidate = { scene: 'gold', variant: 'halton', gpuMedianMs: 102, rmseMedian: 0.9 };
  const [comparison] = compareSamplingSummaries([reference, candidate]);
  assert.equal(comparison.comparableGpuBudget, true);
  assert.ok(Math.abs(comparison.rmseGainPercent - 10) < 1e-10);
  assert.equal(comparison.eligibleForConfirmation, true);
  assert.equal(compareSamplingSummaries([reference, { ...candidate, gpuMedianMs: 110 }])[0].eligibleForConfirmation, false);
  assert.equal(compareSamplingSummaries([reference, { ...candidate, gpuMedianMs: null }])[0].comparableGpuBudget, false);
  assert.equal(compareSamplingSummaries([reference, { ...candidate, rmseMedian: 0.99 }])[0].eligibleForConfirmation, false);
});

test('quality summaries exclude high-spp references and report error dispersion without claiming exact HDR parity', () => {
  const row = { scene: 'gold', variant: 'halton', renderMs: 20, gpuMs: 10 };
  const summary = summarize([
    { ...row, warmup: true, role: 'quality-reference' },
    { ...row, warmup: true, quality: { rmse: 999, relativeRmse: 999 } },
    { ...row, warmup: false, quality: { rmse: 2, relativeRmse: 0.2 } },
    { ...row, warmup: false, quality: { rmse: 4, relativeRmse: 0.4 } },
  ]);
  assert.equal(summary[0].repetitions, 2);
  assert.equal(summary[0].rmseMedian, 3);
  assert.ok(Math.abs(summary[0].relativeRmseMedian - 0.3) < 1e-10);
  assert.equal(summary[0].rmseMin, 2);
  assert.equal(summary[0].rmseMax, 4);
  assert.equal('identical' in summary[0], false);
});

test('triangle-edge experiment warms both variants and alternates their order', () => {
  assert.deepEqual(experimentVariants(true, false, -1, 'bvh4'), ['reference', 'bvh4']);
  assert.deepEqual(experimentVariants(true, false, 0, 'bvh4'), ['bvh4', 'reference']);
  assert.deepEqual(experimentVariants(true, false, 1, 'bvh4'), ['reference', 'bvh4']);
  assert.deepEqual(experimentVariants(true, false, -1), ['reference', 'triangleEdges']);
  assert.deepEqual(experimentVariants(true, false, 0), ['triangleEdges', 'reference']);
  assert.deepEqual(experimentVariants(true, false, 1), ['reference', 'triangleEdges']);
  assert.deepEqual(experimentVariants(false, true, 0), ['8x8']);
  assert.deepEqual(experimentVariants(false, false, -1), ['8x8', '4x4', '16x4', '16x8']);
});

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

test('triangle-edge comparisons report scene-specific gain without inventing unsupported GPU measurements', () => {
  const rows = [
    { scene: 'gold', variant: 'reference', gpuMedianMs: 100, wallMedianMs: 200, identical: true },
    { scene: 'gold', variant: 'triangleEdges', gpuMedianMs: 95, wallMedianMs: 190, identical: true },
    { scene: 'cloth', variant: 'reference', gpuMedianMs: null, wallMedianMs: 200, identical: true },
    { scene: 'cloth', variant: 'triangleEdges', gpuMedianMs: null, wallMedianMs: 210, identical: false },
  ];
  const [gold, cloth] = compareBvhSummaries(rows);
  assert.equal(gold.gpuGainPercent, 5);
  assert.equal(gold.wallGainPercent, 5);
  assert.equal(gold.identical, true);
  assert.equal(cloth.gpuGainPercent, null);
  assert.equal(cloth.wallGainPercent, -5);
  assert.equal(cloth.identical, false);
});

test('BVH4 comparison selects only the requested candidate and preserves regression signs', () => {
  const rows = [
    { scene: 'gold', variant: 'reference', gpuMedianMs: 100, wallMedianMs: 200, identical: true },
    { scene: 'gold', variant: 'triangleEdges', gpuMedianMs: 80, wallMedianMs: 160, identical: true },
    { scene: 'gold', variant: 'bvh4', gpuMedianMs: 120, wallMedianMs: 240, identical: true },
  ];
  const [result] = compareBvhSummaries(rows, 'bvh4');
  assert.equal(result.gpuGainPercent, -20);
  assert.equal(result.wallGainPercent, -20);
  assert.equal(result.identical, true);
});

test('BSDF unrolling comparisons and order remain independent of BVH candidates', () => {
  assert.deepEqual(experimentVariants(true, false, -1, 'unrolled'), ['reference', 'unrolled']);
  assert.deepEqual(experimentVariants(true, false, 0, 'unrolled'), ['unrolled', 'reference']);
  assert.deepEqual(experimentVariants(true, false, 1, 'unrolled'), ['reference', 'unrolled']);
  const rows = [
    { scene: 'gold', variant: 'reference', gpuMedianMs: 100, wallMedianMs: 110, identical: true },
    { scene: 'gold', variant: 'unrolled', gpuMedianMs: 94, wallMedianMs: 104, identical: true },
    { scene: 'gold', variant: 'bvh4', gpuMedianMs: 50, wallMedianMs: 60, identical: true },
  ];
  const [comparison] = compareBvhSummaries(rows, 'unrolled');
  assert.equal(comparison.candidateVariant, 'unrolled');
  assert.equal(comparison.gpuGainPercent, 6);
  assert.equal(comparison.identical, true);
});
