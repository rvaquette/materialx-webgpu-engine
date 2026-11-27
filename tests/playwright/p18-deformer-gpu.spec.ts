import { chromium, expect, test } from '@playwright/test';

test('GPU deformer stacks match the CPU evaluator', async ({ baseURL }) => {
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--force_high_performance_gpu'],
  });

  const page = await browser.newPage();
  try {
    await page.route('**/__p18_gpu_test__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
    await page.goto(new URL('/__p18_gpu_test__', baseURL).href);
    const result = await page.evaluate(async () => {
      const { computeDeformerPositions } = await import('../../src/render/deformer-compute.ts');
      const { DEFORMER_DEFAULTS, deformerAtTime, deformPosition, deformerKeyframes } = await import('../../src/scene/deformers.ts');
      const { loadScriptLibrary } = await import('../../src/materialx/script-api.ts');
      const { compileDeformerField, compileSerializedDeformerField } = await import('../../src/materialx/deformer-field.ts');
      const { readNanoVdbVectors, nanoVdbVectorGpuData } = await import('../../src/assets/nanovdb.ts');
      const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) throw new Error('No WebGPU adapter available.');
      const device = await adapter.requestDevice();
      try {
        type Deformer = import('../../src/scene/deformers.ts').Deformer;
        const make = (kind: keyof typeof DEFORMER_DEFAULTS, values: Partial<Deformer>): Deformer =>
          ({ ...DEFORMER_DEFAULTS[kind], kind, ...values });
        const lattice = make('Lattice', { dimensions: [3, 2, 2], boundsMin: [-1, -1, -1], boundsMax: [1, 1, 1],
          offsets: Array.from({ length: 36 }, (_, i) => Math.sin(i) * 0.3) });
        const twist = make('Twist', { axis: 'Z', falloff: 0.25, angle: -120 });
        twist.keyframes = deformerKeyframes(twist, [{ time: 0, angle: -120 }, { time: 10, angle: 150 }]);
        const stacks: Deformer[][] = [
          [make('Bend', { axis: 'X', angle: 73, falloff: 0.3 })],
          [twist],
          [make('Taper', { axis: 'Z', factor: -0.5 })],
          [make('Shear', { axis: 'X', factor: 0.8 })],
          [make('Wave', { axis: 'Z', amplitude: 0.7, frequency: 2.3, phase: -0.4 })],
          [make('Wind', { axis: 'X', amplitude: 0.9, frequency: 1.4, phase: 0.3, seed: 0xffffffff })],
          [make('Spherize', { strength: 0.6, radius: 1.5 })],
          [lattice],
          [twist, lattice, make('Wave', { amplitude: 0.2, frequency: 3 })],
        ];
        const points = [0, 0, 0, 1, 1, 1, -1, -1, -1,
          ...Array.from({ length: 210 }, (_, i) => 1.4 * Math.sin(i * 3.17))];
        let maximumError = 0;
        for (const stack of stacks) for (const time of [0, 3.5, 10]) {
          const gpu = await computeDeformerPositions(device, points, stack, time);
          const evaluated = stack.map(item => deformerAtTime(item, time));
          for (let i = 0; i < points.length; i += 3) {
            const cpu = deformPosition(points.slice(i, i + 3), evaluated);
            for (let j = 0; j < 3; j++) maximumError = Math.max(maximumError, Math.abs(cpu[j]! - gpu[i + j]!));
          }
        }
        const library = await loadScriptLibrary(new URL('/materialx/libraries', location.href).href);
        const position = { name: 'position', def: library.resolve('position', 'vector3'),
          inputs: new Map([['space', { value: 'object' }]]) };
        const noise = { name: 'noise', def: library.resolve('noise3d', 'vector3'),
          inputs: new Map<string, import('../../src/materialx/script-api.ts').ScriptInput>([
            ['position', { node: position, output: 'out' }], ['amplitude', { value: [0.2, 0.4, 0.7] }],
          ]) };
        const original = compileDeformerField({ node: noise, output: noise.def.outputs[0]! });
        const program = compileSerializedDeformerField(original.metadata);
        const field = make('Field', { steps: 4, strength: 0.3 });
        const stack = [twist, field];
        const gpu = await computeDeformerPositions(device, points, stack, 3.5, new Map([[1, program]]));
        const evaluated = stack.map(item => deformerAtTime(item, 3.5));
        for (let i = 0; i < points.length; i += 3) {
          const cpu = deformPosition(points.slice(i, i + 3), evaluated, (_field, point) => original.sample(point, 3.5));
          for (let j = 0; j < 3; j++) {
            const error = Math.abs(cpu[j]! - gpu[i + j]!);
            if (error > 0.0001) throw new Error(`Field mismatch at ${points.slice(i, i + 3)}: CPU ${cpu}, GPU ${gpu.slice(i, i + 3)}.`);
            maximumError = Math.max(maximumError, error);
          }
        }
        const gridPoints = [1, -2, 0.5, 1.25, -1.75, 0.75, 0.75, -2, 0.5,
          2.25, -2, 0.5, 9, -2, 0.5, 129, -2, 0.5, 4097, -2, 0.5, 10000, 0, 0];
        const loadedGrids: import('../../src/assets/nanovdb.ts').NanoVdbVectorGrid[] = [];
        for (const name of ['vec3f', 'vec3d', 'staggered']) {
          const response = await fetch(`/tests/fixtures/nanovdb/velocity_${name}.nvdb.gz`);
          if (!response.ok) throw new Error(`Fixture ${name}: HTTP ${response.status}`);
          const bytes = await response.arrayBuffer();
          const header = new Uint8Array(bytes, 0, 2);
          const raw = header[0] === 0x1f && header[1] === 0x8b
            ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
            : bytes;
          const [grid] = await readNanoVdbVectors(raw);
          if (!grid) throw new Error(`Fixture ${name}: missing grid`);
          loadedGrids.push(grid);
          const field = make('Field', { axis: 'X', min: -20000, max: 20000, steps: 4, strength: 0.02 });
          const gpu = await computeDeformerPositions(device, gridPoints, [field], 0,
            new Map([[0, { grid: nanoVdbVectorGpuData(grid, device.limits.maxStorageBufferBindingSize) }]]));
          for (let i = 0; i < gridPoints.length; i += 3) {
            const cpu = deformPosition(gridPoints.slice(i, i + 3), [field], (_field, point) => grid.sample(point));
            for (let j = 0; j < 3; j++) {
              const error = Math.abs(cpu[j]! - gpu[i + j]!);
              if (error > 0.002) throw new Error(`${name} mismatch at ${gridPoints.slice(i, i + 3)}: CPU ${cpu}, GPU ${gpu.slice(i, i + 3)}.`);
            }
          }
        }
        const pair = [make('Field', { axis: 'X', min: 0, max: 3, steps: 2, strength: 0.03 }),
          make('Field', { axis: 'X', min: 0, max: 3, steps: 2, strength: 0.03 })];
        const pairPoints = [1, -2, 0.5];
        const pairGrids = [loadedGrids[0]!, loadedGrids[2]!];
        const pairGpu = await computeDeformerPositions(device, pairPoints, pair, 0, new Map(pairGrids.map((grid, index) =>
          [index, { grid: nanoVdbVectorGpuData(grid, device.limits.maxStorageBufferBindingSize) }])));
        const pairCpu = deformPosition(pairPoints, pair, (field, point) => pairGrids[pair.indexOf(field)]!.sample(point));
        for (let j = 0; j < 3; j++) {
          if (Math.abs(pairCpu[j]! - pairGpu[j]!) > 0.0001) throw new Error(`Grid stack mismatch: CPU ${pairCpu}, GPU ${pairGpu}.`);
        }
        return maximumError;
      } finally {
        device.destroy();
      }
    });
    expect(result).toBeLessThan(0.0001);
  } finally {
    await browser.close();
  }
});

for (const name of ['materialx', 'nanovdb']) test(`${name} field is evaluated on the GPU during animation`, async ({ baseURL }) => {
  test.setTimeout(180_000);
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--force_high_performance_gpu'],
  });

  const page = await browser.newPage();
  try {
    await page.goto(baseURL!);
    await page.waitForFunction(() => typeof (globalThis as { __mxRunScript?: unknown }).__mxRunScript === 'function');
    const result = await page.evaluate(async name => {
      const source = await (await fetch(`/examples/scripts/p18-${name}-field.js`)).text();
      const script = source.replace(/await save\([^;]+;/, '').replace(/await video\([^;]+;/, 'await setTime(12);');
      const run = (globalThis as unknown as { __mxRunScript(code: string): Promise<{ ok: boolean; message?: string }> }).__mxRunScript;
      const response = await run(script);
      return { ...response, dispatches: performance.getEntriesByName('deformer:compute').length };
    }, name);
    expect(result.message).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.dispatches).toBeGreaterThan(1);
  } finally {
    await browser.close();
  }
});

test('GPU deformation is followed by animated material displacement', async ({ baseURL }) => {
  test.setTimeout(180_000);
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--force_high_performance_gpu'],
  });
  const page = await browser.newPage();
  try {
    await page.goto(baseURL!);
    await page.waitForFunction(() => typeof (globalThis as { __mxRunScript?: unknown }).__mxRunScript === 'function');
    const result = await page.evaluate(async () => {
      const run = (globalThis as unknown as { __mxRunScript(code: string): Promise<{ ok: boolean; message?: string }> }).__mxRunScript;
      const response = await run(`
        water = new Water(); water.waveHeight = 0.15; water.speed = 0.5;
        bend = new Twist({ axis: "X" });
        bend.keyframes = [{ time: 0, angle: 0 }, { time: 24, angle: 45 }];
        pond = new Plane({ width: 2, length: 2, axis: "Y", resolution: 8, material: water });
        pond.deformers = [bend];
        await render(1); await setTime(12);
      `);
      const deformation = performance.getEntriesByName('deformer:compute').at(-1);
      const displacement = performance.getEntriesByName('deformer:displacement').at(-1);
      return { ...response, deformationEnd: deformation && deformation.startTime + deformation.duration,
        displacementStart: displacement?.startTime };
    });
    expect(result.message).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.deformationEnd).toBeDefined();
    expect(result.displacementStart).toBeGreaterThanOrEqual(result.deformationEnd!);
  } finally {
    await browser.close();
  }
});
