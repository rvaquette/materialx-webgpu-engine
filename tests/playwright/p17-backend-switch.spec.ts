import { expect, test } from '@playwright/test';

test.use({ launchOptions: { args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader'] } });

test('raster script captures survive switching back from path tracing', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  test.skip(!await page.evaluate(async () => !!await navigator.gpu?.requestAdapter()), 'WebGPU adapter unavailable');
  await page.waitForFunction(() => typeof (globalThis as { __mxRunScript?: unknown }).__mxRunScript === 'function', null, { timeout: 120_000 });
  const result = await page.evaluate(async () => {
    const saved: Record<string, string> = {};
    const globals = globalThis as typeof globalThis & {
      __mxSaveFile: (name: string, base64: string) => Promise<void>;
      __mxRunScript: (code: string) => Promise<{ ok: boolean; message?: string }>;
    };
    globals.__mxSaveFile = async (name, data) => { saved[name] = data; };
    const run = await globals.__mxRunScript(`
const surface = new StandardSurface();
surface.base_color = [0.8, 0.1, 0.05];
new Sphere({ radius: 1, material: surface });
const sky = new EnvironmentShader();
sky.model = "gradient";
sky.zenithColor = [0.3, 0.4, 0.6];
sky.horizonColor = [0.3, 0.4, 0.6];
sky.groundColor = [0.3, 0.4, 0.6];
await environment(sky.out);
render.resolution = 128;
setCamera({ eye: [3, 2, 4], target: [0, 0, 0], fov: 40 });
render.backend = "raster";
await save("before.png");
render.backend = "pathtracing";
render.backend = "raster";
await save("after.png");
`);
    if (!run.ok) throw new Error(run.message);
    const pixels = async (name: string) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${saved[name]}`)).blob());
      const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    };
    const before = await pixels('before.png');
    const after = await pixels('after.png');
    let difference = 0, redPixels = 0;
    for (let i = 0; i < before.length; i += 4) {
      difference += Math.abs(before[i]! - after[i]!) + Math.abs(before[i + 1]! - after[i + 1]!)
        + Math.abs(before[i + 2]! - after[i + 2]!);
      if (after[i]! > after[i + 1]! * 1.3 && after[i]! > 40) redPixels++;
    }
    return { difference: difference / (before.length / 4 * 3), redPixels };
  });
  expect(result.redPixels).toBeGreaterThan(100);
  expect(result.difference).toBeLessThan(2);
});
