import { expect, test } from '@playwright/test';

test.use({ launchOptions: { args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader'] } });

test('procedural volume baking and extreme phase functions agree with the CPU reference', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as
      (path: string) => Promise<typeof import('../fixtures/volume-gpu-probe.ts')>;
    return (await load('/tests/fixtures/volume-gpu-probe.ts')).volumeGpuProbe();
  });

  test.skip(!result, 'WebGPU adapter unavailable');
  expect(result!.maximumError).toBeLessThan(1e-5);
  expect(result!.cdfError).toBeLessThan(1e-6);
  expect(result!.emissionError).toBeLessThan(1e-5);
  for (const [index, reference] of result!.referencePhases.entries()) {
    expect(Math.abs(result!.phases[index]! - reference) / reference).toBeLessThan(0.003);
  }
});

test('GPU volume mixture preserves colored extinction, emission and phase components', async ({ page }) => {
  await page.goto('/');
  for (const includeInterior of [false, true]) {
    const result = await page.evaluate(async includeInterior => {
      const load = new Function('path', 'return import(path)') as
        (path: string) => Promise<typeof import('../fixtures/volume-gpu-probe.ts')>;
      return (await load('/tests/fixtures/volume-gpu-probe.ts')).volumeMixtureGpuProbe(includeInterior);
    }, includeInterior);
    test.skip(!result, 'WebGPU adapter unavailable');
    for (let c = 0; c < 3; c++) {
      const extinction = result!.media.reduce((sum, medium) => sum + medium.absorption[c]! + medium.scattering[c]!, 0);
      const integral = (1 - Math.exp(-extinction)) / extinction;
      expect(Math.abs(result!.transmitted[c]! - Math.exp(-extinction))).toBeLessThan(0.02);
      expect(Math.abs(result!.emitted[c]! - result!.media.reduce((sum, medium) => sum + medium.emission[c]!, 0) * integral)).toBeLessThan(0.02);
      for (let i = 0; i < result!.media.length; i++) {
        expect(Math.abs(result!.scattered[i]![c]! - result!.media[i]!.scattering[c]! * integral)).toBeLessThan(0.02);
      }
    }
  }
});

test('GPU volume domains distinguish overlapping and coincident instances sharing a material', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as
      (path: string) => Promise<typeof import('../fixtures/volume-gpu-probe.ts')>;
    return (await load('/tests/fixtures/volume-gpu-probe.ts')).volumeDomainGpuProbe();
  });
  test.skip(!result, 'WebGPU adapter unavailable');
  expect(result).toEqual([1, 0, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 1, 1, 1]);
});

test('complete path tracing shader validates with overlapping volumes', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as
      (path: string) => Promise<typeof import('../fixtures/volume-gpu-probe.ts')>;
    return (await load('/tests/fixtures/volume-gpu-probe.ts')).volumePathShaderProbe();
  });
  test.skip(!result, 'WebGPU adapter unavailable');
  expect(result).toEqual([]);
});

test('path tracing transports camera rays through coincident volumes sharing a material', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as
      (path: string) => Promise<typeof import('../fixtures/volume-gpu-probe.ts')>;
    return (await load('/tests/fixtures/volume-gpu-probe.ts')).volumePathRenderProbe();
  });
  test.skip(!result, 'WebGPU adapter unavailable');
  expect(result![0]).toBeCloseTo(Math.exp(-1.2), 1);
  expect(result![1]).toBeCloseTo(Math.exp(-0.6), 1);
  expect(result![2]).toBeCloseTo(Math.exp(-1.2), 3);
});

test('path tracing transports camera rays through distinct overlapping volumes', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as
      (path: string) => Promise<typeof import('../fixtures/volume-gpu-probe.ts')>;
    return (await load('/tests/fixtures/volume-gpu-probe.ts')).volumePathRenderProbe(true);
  });
  test.skip(!result, 'WebGPU adapter unavailable');
  expect(result![0]).toBeCloseTo(Math.exp(-2.2), 1);
  expect(result![1]).toBeCloseTo(Math.exp(-0.3), 1);
  expect(result![2]).toBeCloseTo(Math.exp(-2.2), 3);
});

test('raster composites absorption and emission of coincident volumes', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as
      (path: string) => Promise<typeof import('../fixtures/volume-gpu-probe.ts')>;
    return (await load('/tests/fixtures/volume-gpu-probe.ts')).volumeRasterRenderProbe();
  });

  test.skip(!result, 'WebGPU adapter unavailable');
  const transmission = Math.exp(-1.2);
  const expected = (64 / 255) * transmission + 0.1 / 0.6 * (1 - transmission);
  expect(result!.pixel[0]! / 255).toBeCloseTo(expected, 2);
  expect(result!.shadows[0]).toBeCloseTo(transmission, 3);
  expect(result!.shadows[1]).toBeCloseTo(Math.exp(-0.6), 3);
});

test('path tracing samples the combined emission of coincident volumes', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as
      (path: string) => Promise<typeof import('../fixtures/volume-gpu-probe.ts')>;
    return (await load('/tests/fixtures/volume-gpu-probe.ts')).volumePathEmitterProbe();
  });
  test.skip(!result, 'WebGPU adapter unavailable');
  expect(result!.slice(0, 3)).toEqual([2, 4, 6]);
  expect(result![3]).toBeGreaterThan(0);
});

test('path tracing with volume domains matches single scattering and the boundary transport', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/');
  const run = (depth: number) => page.evaluate(async depth => {
    const load = new Function('path', 'return import(path)') as
      (path: string) => Promise<typeof import('../fixtures/volume-gpu-probe.ts')>;
    return (await load('/tests/fixtures/volume-gpu-probe.ts')).volumePathModesProbe(32768, depth);
  }, depth);
  const single = await run(1);
  test.skip(!single, 'WebGPU adapter unavailable');
  // Independent quadrature of the emitter -> scattering box -> camera integral (red channel).
  for (const mode of [single!.reference, single!.domains]) {
    expect(Math.abs(mode[0]![0]! - 0.02429)).toBeLessThan(0.001);
    expect(mode[1]![0]).toBeCloseTo(4 * (1 - Math.exp(-1)), 1);
  }
  const multiple = (await run(8))!;
  expect(Math.abs(multiple.domains[0]![0]! - multiple.reference[0]![0]!)).toBeLessThan(0.003);
});
