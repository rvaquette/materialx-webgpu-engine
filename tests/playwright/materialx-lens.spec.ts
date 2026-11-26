import { expect, test } from '@playwright/test';

test.use({ launchOptions: { args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader'] } });

test('MaterialX camera rays implement projections and focused bokeh', async ({ page }) => {
  await page.goto('/');
  const rays = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<{ materialxLensProbe(): Promise<number[][] | null> }>;
    return (await load('/tests/fixtures/materialx-lens-probe.ts')).materialxLensProbe();
  });
  test.skip(!rays, 'WebGPU adapter unavailable');
  const r = rays!;
  const close = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 4);
  close(r[0]![6]!, 1); close(r[1]![6]!, 1);
  close(r[2]![4]!, 1); close(r[2]![6]!, 0);
  expect(r[3]![3]).toBe(0);
  close(r[4]![4]!, 1); close(r[5]![5]!, 1);
  close(r[6]![0]!, 0.5); close(r[6]![1]!, 0);
  close(r[7]![0]!, 0.25); close(r[7]![1]!, 0.25);
  for (const index of [6, 7]) {
    const ray = r[index]!;
    const t = (4 - ray[2]!) / ray[6]!;
    close(ray[0]! + t * ray[4]!, 0);
    close(ray[1]! + t * ray[5]!, 0);
  }
  const perspective = r[8]!;
  close(perspective[0]!, 0.5); close(perspective[2]!, 0);
  const t = 5 / perspective[6]!;
  close(perspective[0]! + t * perspective[4]!, 2.5);
});
