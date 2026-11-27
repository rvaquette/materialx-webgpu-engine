import { chromium, expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Run `npm run test:playwright:demo` to watch these tests in a slowed-down browser.

const SOURCE_SCENE = '/?entry=./scenes/standard-shader-ball/standard-shader-ball.usda';

interface Editor {
  panel: Locator;
  /** CodeMirror's editable content (typing, shortcuts). */
  code: Locator;
  /** Colored tokens (`.tok-*`) live in the editor content. */
  highlight: Locator;
  completions: Locator;
  helper: Locator;
  status: Locator;
  xml: Locator;
}

function editor(page: Page): Editor {
  const panel = page.locator('#script-editor-panel');
  return {
    panel,
    code: panel.locator('.cm-content'),
    highlight: panel.getByTestId('script-code'),
    completions: page.locator('.cm-tooltip-autocomplete'),
    helper: panel.getByTestId('script-value-helper'),
    status: panel.getByTestId('script-status'),
    xml: panel.getByTestId('script-xml'),
  };
}

/** Script text of the editor (the panel's `script` property). */
const scriptOf = (e: Editor): Promise<string> => e.panel.evaluate(element => (element as HTMLElement & { script: string }).script);

async function setScript(e: Editor, code: string): Promise<void> {
  await e.panel.evaluate((element, text) => { (element as HTMLElement & { script: string }).script = text; }, code);
}

const demo = (info: TestInfo): boolean => info.project.name === 'demo';

/** Give the viewer of a demo run time to read the screen. */
async function pause(page: Page, info: TestInfo, ms = 1500): Promise<void> {
  if (demo(info)) await page.waitForTimeout(ms);
}

async function type(page: Page, info: TestInfo, text: string): Promise<void> {
  await page.keyboard.type(text, { delay: demo(info) ? 70 : 0 });
}

/** CodeMirror ignores Enter for 75 ms after the completion list opens; a test types faster than that. */
async function acceptCompletion(page: Page): Promise<void> {
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
}

async function openEditor(page: Page, url = '/'): Promise<Editor> {
  await page.goto(url);
  await page.locator('#open-script-editor').click();
  const e = editor(page);
  await expect(e.panel).toBeVisible();
  await expect(e.status).toContainText('Script valide', { timeout: 30_000 });
  return e;
}

async function expectCode(e: Editor, text: string): Promise<void> {
  await expect.poll(() => scriptOf(e)).toContain(text);
}

type Screenshot = Awaited<ReturnType<Locator['screenshot']>>;

/** Mean and maximum per-channel difference (0-255) between two PNG screenshots of equal size. */
async function imageDifference(page: Page, a: Screenshot, b: Screenshot): Promise<{ mean: number; max: number }> {
  return page.evaluate(async ([first, second]) => {
    const pixels = async (base64: string): Promise<ImageData> => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height);
    };
    const [x, y] = [await pixels(first), await pixels(second)];
    if (x.width !== y.width || x.height !== y.height) return { mean: 255, max: 255 };
    let sum = 0;
    let max = 0;
    for (let i = 0; i < x.data.length; i++) {
      const delta = Math.abs(x.data[i]! - y.data[i]!);
      sum += delta;
      max = Math.max(max, delta);
    }
    return { mean: sum / x.data.length, max };
  }, [a.toString('base64'), b.toString('base64')] as const);
}

/** Put the caret at the end of the first line containing `text`. */
async function caretOn(e: Editor, text: string): Promise<void> {
  const line = (await scriptOf(e)).split('\n').findIndex(candidate => candidate.includes(text));
  expect(line).toBeGreaterThanOrEqual(0);
  await e.code.click();
  await e.code.press('Control+Home');
  for (let i = 0; i < line; i++) await e.code.press('ArrowDown');
  await e.code.press('End');
}

test('colorise le script et signale les entrées inconnues', async ({ page }, info) => {
  const e = await openEditor(page);
  await expect(e.highlight.locator('.tok-node')).toContainText(['Fractal3d', 'Mix', 'StandardSurface']);
  await expect(e.highlight.locator('.tok-var').first()).toHaveText('noise');
  await expect(e.highlight.locator('.tok-input').first()).toHaveText('octaves');
  await expect(e.highlight.locator('.tok-output').first()).toHaveText('out');
  await expect(e.highlight.locator('.tok-comment')).toHaveCount(1);
  await expect(e.highlight.locator('.tok-number').first()).toHaveText('4');
  await pause(page, info, 2500);

  await caretOn(e, 'surface.thin_walled');
  await type(page, info, '\nsurface.bogus = 1;');
  await expect(e.highlight.locator('.tok-error')).toHaveText('bogus');
  await expect(e.status).toHaveClass(/error/);
  await expect(e.status).toContainText('has no input "bogus"');
  await pause(page, info, 2500);

  await e.code.press('Escape');
  await expect(e.panel).toBeHidden();
  await page.keyboard.press('F2');
  await expect(e.panel).toBeVisible();
});

test('débogue un script : point d’arrêt, variables, pas à pas, arrêt', async ({ page }, info) => {
  const e = await openEditor(page);
  await setScript(e, 'a = 1;\nb = a + 1;\nfor (let i = 0; i < 3; i++) {\n  c = i * 2;\n}\nlog("fin " + c);');
  await expect(e.status).toContainText('Script valide');
  await e.panel.locator('.cm-breakpoint-gutter .cm-gutterElement').nth(4).click();
  await e.panel.getByTestId('script-debug').click();
  await expect(e.status).toContainText('Pause ligne 4');
  await expect(e.panel.locator('.cm-paused-line')).toHaveCount(1);
  const variables = e.panel.getByTestId('script-variables');
  const cells = variables.locator('td');
  await expect(cells).toHaveText(['a', '1', 'b', '2']);
  await pause(page, info, 2500);
  await e.panel.getByTestId('script-step').click();
  await expect(cells).toHaveText(['a', '1', 'b', '2', 'c', '0']);
  await e.panel.getByTestId('script-pause').click();
  await expect(cells).toHaveText(['a', '1', 'b', '2', 'c', '2']);
  await pause(page, info);
  await e.panel.getByTestId('script-stop').click();
  await expect(e.status).toHaveText('Script arrêté à la ligne 4.');
  await expect(e.panel.getByTestId('script-apply')).toBeEnabled();
  await expect(e.panel.locator('.cm-paused-line')).toHaveCount(0);
});

test('documente au survol, enregistre, partage et insère des modèles', async ({ page, context }, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const e = await openEditor(page);
  await e.panel.locator('.tok-input', { hasText: 'octaves' }).hover();
  await expect(page.getByTestId('script-hover')).toContainText('noise.octaves : entrée integer');
  await e.panel.getByTestId('script-tab-graph').click();
  await expect(e.panel.getByTestId('script-graph-summary')).toHaveText('Graphe : 3 nœuds, 2 liens.');
  // Editing in the litegraph canvas rewrites the script: the octaves widget's right arrow adds 1.
  const graph = e.panel.locator('.mx-node-graph');
  const arrow = await graph.evaluate(element => (element as HTMLElement & {
    mxGraph: { point(id: string, kind: string, name: string): { x: number; y: number } | undefined };
  }).mxGraph.point('noise', 'widget', 'octaves'));
  await page.mouse.click(arrow!.x, arrow!.y);
  await expectCode(e, 'noise.octaves = 5;');
  // « Ajouter un nœud en amont » lists nodes whose output has the input's type (color3 here).
  await graph.evaluate((element) => {
    void (element as HTMLElement & { mxGraph: { openUpstream(id: string, input: string): Promise<void> } })
      .mxGraph.openUpstream('surface', 'specular_color');
  });
  const picker = e.panel.locator('.mx-graph-picker');
  await expect(picker.locator('strong')).toHaveText('En amont de specular_color (color3)');
  await expect(picker.getByRole('option', { name: /^blend\.out/ })).toBeVisible();
  await picker.getByRole('searchbox').fill('ND_image_color3');
  await page.keyboard.press('Enter');
  await expectCode(e, 'image = new Image("ND_image_color3");\nsurface.specular_color = image.out;');
  await pause(page, info);

  await e.panel.getByTestId('script-name').fill('essai');
  await e.panel.getByTestId('script-save').click();
  await expect(e.panel.getByTestId('script-console')).toContainText('Script « essai » enregistré dans Mes scripts.');
  await setScript(e, '');
  await e.panel.getByTestId('script-templates').selectOption({ label: 'Rendu path tracing d’une scène' });
  await expectCode(e, 'await render(256);');
  await e.panel.getByTestId('script-library').selectOption('essai');
  await expectCode(e, 'noise.octaves = 5;');

  await e.panel.getByTestId('script-share').click();
  await expect(e.panel.getByTestId('script-console')).toContainText('Lien de partage copié');
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const shared = await context.newPage();
  await shared.goto(link);
  const opened = editor(shared);
  await expect(opened.status).toContainText('lien de partage', { timeout: 30_000 });
  await expectCode(opened, 'noise.octaves = 5;');
  expect(shared.url()).not.toContain('#script=');
});

test('affiche les shaders d’extension P16 dans le graphe', async ({ page }) => {
  const e = await openEditor(page);
  await setScript(e, `
    lens = new LensShader(); lens.projection = "fisheye";
    filter = new LightFilterShader(); filter.lightPath = "/World/Spot"; filter.pattern = "grid";
    ground = new Plane(); prototype = new Sphere();
    scatterSettings = new ScatterShader();
    scatterSettings.surfacePath = ground.path; scatterSettings.prototypePath = prototype.path;
    scatterSettings.density = 4;
    p = new Position(); p.space = "world";
    split = new Separate3("ND_separate3_vector3"); split.in = p.out;
    height = new CustomAovShader(); height.source = "scalar"; height.scalar = split.outy;
  `);
  await expect(e.status).toContainText('Script valide');
  await e.panel.getByTestId('script-tab-graph').click();
  await expect(e.panel.getByTestId('script-graph-summary')).toHaveText('Graphe : 6 nœuds, 2 liens.');

  const graph = e.panel.locator('.mx-node-graph');
  const widgets = await graph.evaluate(element => {
    const view = element as HTMLElement & { mxGraph: { point(id: string, kind: string, name: string): { x: number; y: number } | undefined } };
    return [
      view.mxGraph.point('lens', 'widget', 'projection'),
      view.mxGraph.point('filter', 'widget', 'pattern'),
      view.mxGraph.point('scatterSettings', 'widget', 'density'),
      view.mxGraph.point('height', 'widget', 'source'),
    ];
  });
  expect(widgets.every(Boolean)).toBe(true);
});

test('sépare le graphe MaterialX du graphe scène et génère sans exécuter', async ({ page }) => {
  const e = await openEditor(page);
  await e.panel.getByTestId('script-tab-scene-graph').click();
  await expect(e.panel.getByTestId('scene-graph-summary')).toHaveText('Prototype valide : 7 nœuds, 7 liens.');

  page.once('dialog', dialog => dialog.accept());
  await e.panel.getByTestId('scene-graph-to-script').click();
  await expectCode(e, 'material.displacementshader = displacement;');
  await expectCode(e, 'sphereA.material = material;');
  await expectCode(e, 'sphereB.material = material;');
  await expect(e.status).toContainText('il n’a pas été exécuté');

  await e.panel.getByTestId('script-tab-graph').click();
  await expect(e.panel.getByTestId('script-graph-summary')).toHaveText('Graphe : 3 nœuds, 2 liens.');
  await e.panel.getByTestId('script-tab-scene-graph').click();
  await expect(e.panel.getByTestId('scene-graph-summary')).toHaveText('Prototype valide : 7 nœuds, 7 liens.');
});

test.describe('paramètres de shaders déclarés', () => {
  test('modifie surface et image dans le rendu sans réexécuter', async ({ baseURL }) => {
    test.setTimeout(300_000);
    const browser = await chromium.launch({
      channel: 'chrome',
      args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--force_high_performance_gpu'],
    });
    const page = await browser.newPage();
    try {
      await page.goto(baseURL!);
      const webgpu = await page.evaluate(async () => Boolean(await navigator.gpu?.requestAdapter()));
      test.skip(!webgpu, 'WebGPU indisponible dans Chrome.');
      await expect(page.locator('#app')).toHaveClass(/ui-ready/, { timeout: 120_000 });
      await expect(page.locator('#busy-indicator')).toBeHidden({ timeout: 120_000 });
      await page.locator('#open-script-editor').click();
      const e = editor(page);
      await setScript(e, `
surface = new StandardSurface();
surface.base_color = [0.1, 0.1, 0.9];
surface.specular_roughness = 0.5;
expose(surface, "base_color", "Couleur");
ball = new Sphere({ radius: 0.8, material: surface });
image = new ImageShader();
image.exposure = 0;
expose(image, "exposure", "Exposition image");
await postprocess(image.out);
render.resolution = 256;
render.backend = "raster";
setCamera({ eye: [0, 0, 4], target: [0, 0, 0], fov: 38 });
log("exécution unique");
await render(1);`);
      await expect(e.status).toContainText('Script valide', { timeout: 30_000 });
      await e.panel.getByTestId('script-apply').click();
      await expect(e.status).toHaveText('Script exécuté.', { timeout: 180_000 });
      await e.panel.getByTestId('script-tab-parameters').click();
      const parameters = e.panel.getByTestId('script-parameters');
      await expect(parameters.locator('label')).toHaveCount(2);
      await expect(parameters).not.toContainText('specular_roughness');
      const canvas = page.locator('#view');
      await page.waitForTimeout(1000);
      const before = await canvas.screenshot();
      const red = parameters.getByLabel('Couleur 1');
      await red.fill('0.9');
      await red.press('Tab');
      await expect(parameters.locator('fieldset')).toBeEnabled({ timeout: 120_000 });
      await expect(parameters.getByRole('alert')).toHaveCount(0);
      await page.waitForTimeout(1000);
      const afterSurface = await canvas.screenshot();
      expect((await imageDifference(page, before, afterSurface)).mean).toBeGreaterThan(0.1);
      const exposure = parameters.getByLabel('Exposition image');
      await exposure.fill('-2');
      await exposure.press('Tab');
      await expect(parameters.locator('fieldset')).toBeEnabled({ timeout: 120_000 });
      await expect(parameters.getByRole('alert')).toHaveCount(0);
      await page.waitForTimeout(1000);
      const afterImage = await canvas.screenshot();
      expect((await imageDifference(page, afterSurface, afterImage)).mean).toBeGreaterThan(1);
      await expect(e.panel.getByTestId('script-console').getByText('exécution unique')).toHaveCount(1);
      await expectCode(e, 'surface.base_color = [0.1, 0.1, 0.9];');
    } finally {
      await browser.close();
    }
  });

  test('reconstruit la dispersion tout en conservant la scène interactive', async ({ baseURL }) => {
    test.setTimeout(300_000);
    const browser = await chromium.launch({
      channel: 'chrome',
      args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--force_high_performance_gpu'],
    });
    const page = await browser.newPage();
    try {
      await page.goto(baseURL!);
      test.skip(!await page.evaluate(async () => Boolean(await navigator.gpu?.requestAdapter())), 'WebGPU indisponible dans Chrome.');
      await expect(page.locator('#app')).toHaveClass(/ui-ready/, { timeout: 120_000 });
      await expect(page.locator('#busy-indicator')).toBeHidden({ timeout: 120_000 });
      await page.locator('#open-script-editor').click();
      const e = editor(page);
      await setScript(e, `
ground = new Plane({ width: 3, length: 3 });
anchor = new Sphere({ radius: 0.3 });
fire = new Fire(); fire.emission = 1; expose(fire, "emission", "Émission du volume");
flame = new Volume({ width: 1, height: 1, length: 1, translate: [2, 0, 0], material: fire });
surface = new StandardSurface(); surface.base_color = [0.8, 0.1, 0.1];
expose(surface, "base_color", "Couleur des instances");
prototype = new Sphere({ radius: 0.25, material: surface });
scattering = new ScatterShader();
scattering.surfacePath = ground.path;
scattering.prototypePath = prototype.path;
scattering.density = 0;
expose(scattering, "density", "Densité");
await scatter(scattering.out);
render.resolution = 256; render.backend = "raster";
setCamera({ eye: [3, 4, 5], target: [0, 0, 0], fov: 38 });
setTransform(anchor.path, transform({ translate: [2, 0.5, 0] }));
log("dispersion unique"); await render(1);`);
      await expect(e.status).toContainText('Script valide', { timeout: 30_000 });
      await e.panel.getByTestId('script-apply').click();
      await expect(e.status).toHaveText('Script exécuté.', { timeout: 180_000 });
      await e.panel.getByTestId('script-tab-parameters').click();
      const parameters = e.panel.getByTestId('script-parameters');
      const canvas = page.locator('#view');
      await parameters.getByLabel('Émission du volume').fill('10');
      await parameters.getByLabel('Émission du volume').press('Tab');
      await expect(parameters.locator('fieldset')).toBeEnabled({ timeout: 120_000 });
      expect(await parameters.getByRole('alert').allTextContents()).toEqual([]);
      await page.waitForTimeout(1000);
      const before = await canvas.screenshot();
      const density = parameters.getByLabel('Densité');
      await density.fill('1');
      await density.press('Tab');
      await expect(parameters.locator('fieldset')).toBeEnabled({ timeout: 120_000 });
      await expect(parameters.getByRole('alert')).toHaveCount(0);
      await page.waitForTimeout(1000);
      const after = await canvas.screenshot();
      expect((await imageDifference(page, before, after)).mean).toBeGreaterThan(0.1);
      const color = parameters.getByLabel('Couleur des instances 1');
      await color.fill('0.05');
      await color.press('Tab');
      await expect(parameters.locator('fieldset')).toBeEnabled({ timeout: 120_000 });
      await expect(parameters.getByRole('alert')).toHaveCount(0);
      await page.waitForTimeout(1000);
      const recolored = await canvas.screenshot();
      expect((await imageDifference(page, after, recolored)).mean).toBeGreaterThan(0.1);
      await parameters.getByLabel('Densité').fill('0');
      await parameters.getByLabel('Densité').press('Tab');
      await expect(parameters.locator('fieldset')).toBeEnabled({ timeout: 120_000 });
      await expect(parameters.getByRole('alert')).toHaveCount(0);
      await page.waitForTimeout(1000);
      expect((await imageDifference(page, before, await canvas.screenshot())).mean).toBeLessThan(0.3);
      await expect(e.panel.getByTestId('script-console').getByText('dispersion unique')).toHaveCount(1);
    } finally {
      await browser.close();
    }
  });

  test('modifie un shader de volume procédural déclaré', async ({ baseURL }) => {
    test.setTimeout(300_000);
    const browser = await chromium.launch({
      channel: 'chrome',
      args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--force_high_performance_gpu'],
    });
    const page = await browser.newPage();
    try {
      await page.goto(baseURL!);
      test.skip(!await page.evaluate(async () => Boolean(await navigator.gpu?.requestAdapter())), 'WebGPU indisponible dans Chrome.');
      await expect(page.locator('#app')).toHaveClass(/ui-ready/, { timeout: 120_000 });
      await expect(page.locator('#busy-indicator')).toBeHidden({ timeout: 120_000 });
      await page.locator('#open-script-editor').click();
      const e = editor(page);
      await setScript(e, `
fire = new Fire();
fire.emission = 1;
expose(fire, "emission", "Émission");
bounds = new Volume({ width: 2, height: 3, length: 2, material: fire });
render.resolution = 256; render.backend = "raster";
setCamera({ eye: [3, 2, 5], target: [0, 0, 0], fov: 38 });
await render(1);`);
      await expect(e.status).toContainText('Script valide', { timeout: 30_000 });
      await e.panel.getByTestId('script-apply').click();
      await expect(e.status).toHaveText('Script exécuté.', { timeout: 180_000 });
      await e.panel.getByTestId('script-tab-parameters').click();
      const parameters = e.panel.getByTestId('script-parameters');
      const canvas = page.locator('#view');
      await page.waitForTimeout(1000);
      const before = await canvas.screenshot();
      const emission = parameters.getByLabel('Émission');
      await emission.fill('10');
      await emission.press('Tab');
      await expect(parameters.locator('fieldset')).toBeEnabled({ timeout: 180_000 });
      expect(await parameters.getByRole('alert').allTextContents()).toEqual([]);
      await page.waitForTimeout(1000);
      expect((await imageDifference(page, before, await canvas.screenshot())).mean).toBeGreaterThan(0.1);
    } finally {
      await browser.close();
    }
  });

  test('déplace un filtre entre deux spots sans réexécuter le script', async ({ baseURL }) => {
    test.setTimeout(300_000);
    const browser = await chromium.launch({
      channel: 'chrome',
      args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--force_high_performance_gpu'],
    });
    const page = await browser.newPage();
    try {
      await page.route('**/examples/scenes/p16-extension-light.usda', async route => {
        const response = await route.fetch();
        const source = await response.text();
        const secondSpot = `
    def SpotLight "SpotB"
    {
        float inputs:intensity = 24
        float inputs:shaping:cone:innerAngle = 22
        float inputs:shaping:cone:outerAngle = 42
        float3 xformOp:translate = (2, 4, 4)
        float3 xformOp:rotateXYZ = (-40, 0, 0)
        uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateXYZ"]
    }
`;
        await route.fulfill({ response, body: source.replace(/\}\s*$/, `${secondSpot}}`) });
      });
      await page.goto(baseURL!);
      test.skip(!await page.evaluate(async () => Boolean(await navigator.gpu?.requestAdapter())), 'WebGPU indisponible dans Chrome.');
      await expect(page.locator('#app')).toHaveClass(/ui-ready/, { timeout: 120_000 });
      await expect(page.locator('#busy-indicator')).toBeHidden({ timeout: 120_000 });
      await page.locator('#open-script-editor').click();
      const e = editor(page);
      await setScript(e, `
await scene("./examples/scenes/p16-extension-light.usda");
render.backend = "pathtracing"; render.resolution = 256;
await setLight("/World/Spot", { intensity: 30 });
filter = new LightFilterShader(); filter.lightPath = "/World/Spot";
expose(filter, "lightPath", "Lumière"); expose(filter, "scale", "Échelle");
await lightFilter(filter.out);
log("filtre unique"); await render(1);`);
      await expect(e.status).toContainText('Script valide', { timeout: 30_000 });
      await e.panel.getByTestId('script-apply').click();
      await expect(e.status).toHaveText('Script exécuté.', { timeout: 180_000 });
      await e.panel.getByTestId('script-tab-parameters').click();
      const parameters = e.panel.getByTestId('script-parameters');
      await parameters.getByLabel('Lumière').fill('/World/SpotB');
      await parameters.getByLabel('Lumière').press('Tab');
      await expect(parameters.locator('fieldset')).toBeEnabled({ timeout: 120_000 });
      expect(await parameters.getByRole('alert').allTextContents()).toEqual([]);
      await parameters.getByLabel('Échelle').fill('7');
      await parameters.getByLabel('Échelle').press('Tab');
      await expect(parameters.locator('fieldset')).toBeEnabled({ timeout: 120_000 });
      expect(await parameters.getByRole('alert').allTextContents()).toEqual([]);
      await parameters.getByLabel('Lumière').fill('/World/Absent');
      await parameters.getByLabel('Lumière').press('Tab');
      await expect(parameters.getByRole('alert')).toContainText('Unknown light');
      await expect(e.panel.getByTestId('script-console').getByText('filtre unique')).toHaveCount(1);
    } finally {
      await browser.close();
    }
  });
});

test('anime les déformeurs par les échantillons USD dans le viewer', async ({ baseURL }) => {
  test.setTimeout(300_000);
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--force_high_performance_gpu'],
  });
  const page = await browser.newPage();
  try {
    await page.goto(baseURL!);
    test.skip(!await page.evaluate(async () => Boolean(await navigator.gpu?.requestAdapter())), 'WebGPU indisponible dans Chrome.');
    await expect(page.locator('#app')).toHaveClass(/ui-ready/, { timeout: 120_000 });
    await expect(page.locator('#busy-indicator')).toBeHidden({ timeout: 120_000 });
    await page.locator('#open-script-editor').click();
    const e = editor(page);
    await setScript(e, `
surface = new StandardSurface(); surface.base_color = [0.2, 0.4, 0.8];
twist = new Twist(); twist.axis = "X";
twist.keyframes = [{ time: 0, angle: 0 }, { time: 24, angle: 150 }];
ribbon = new Plane({ width: 2, length: 1, axis: "Z", resolution: 24, material: surface });
ribbon.deformers = [twist];
render.resolution = 256; render.backend = "raster";
setCamera({ eye: [2, 2, 5], target: [0, 0, 0], fov: 38 });
await render(1); await setTime(0);`);
    await expect(e.status).toContainText('Script valide', { timeout: 30_000 });
    await e.panel.getByTestId('script-apply').click();
    await expect(e.status).toHaveText('Script exécuté.', { timeout: 180_000 });
    await expect(page.locator('#view-timeline')).toBeVisible();
    await expect(page.locator('#view-timeline-time')).toHaveAttribute('max', '24');
    const canvas = page.locator('#view');
    await page.waitForTimeout(1000);
    const before = await canvas.screenshot();
    await setScript(e, 'await setTime(24); await render(1);');
    await expect(e.status).toContainText('Script valide', { timeout: 30_000 });
    await e.panel.getByTestId('script-apply').click();
    await expect(e.status).toHaveText('Script exécuté.', { timeout: 180_000 });
    await page.waitForTimeout(1000);
    expect((await imageDifference(page, before, await canvas.screenshot())).mean).toBeGreaterThan(0.1);
  } finally {
    await browser.close();
  }
});

test('affiche et commande la barre de temps pour un matériau animé', async ({ baseURL }) => {
  test.setTimeout(240_000);
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--force_high_performance_gpu'],
  });
  const page = await browser.newPage();
  try {
    await page.goto(baseURL!);
    test.skip(!await page.evaluate(async () => Boolean(await navigator.gpu?.requestAdapter())), 'WebGPU indisponible dans Chrome.');
    await expect(page.locator('#app')).toHaveClass(/ui-ready/, { timeout: 120_000 });
    await expect(page.locator('#busy-indicator')).toBeHidden({ timeout: 120_000 });
    await page.locator('#open-script-editor').click();
    const e = editor(page);
    const apply = async (script: string) => {
      await setScript(e, script);
      await expect(e.status).toContainText('Script valide', { timeout: 30_000 });
      await e.panel.getByTestId('script-apply').click();
      await expect(e.status).toHaveText('Script exécuté.', { timeout: 180_000 });
    };
    const scene = 'new Sphere({ material: surface }); render.resolution = 256; render.backend = "raster"; await render(1);';
    await apply(`surface = new StandardSurface(); ${scene}`);
    const bar = page.locator('#view-timeline');
    await expect(bar).toBeHidden();
    await apply(`clock = new Time(); surface = new StandardSurface(); surface.emission = clock.out; ${scene}`);
    await expect(bar).toBeVisible();
    const slider = page.locator('#view-timeline-time');
    const value = page.locator('#view-timeline-value');
    const button = page.locator('#view-timeline-play');
    await expect(slider).toHaveAttribute('max', '240');
    await slider.evaluate((element: HTMLInputElement) => {
      element.value = '120';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(value).toContainText('120.0');
    await button.click();
    await expect(button).toHaveText('Arrêter');
    await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(120);
    await button.click();
    await expect(button).toHaveText('Lire');
    const stopped = await slider.inputValue();
    await page.waitForTimeout(300);
    await expect(slider).toHaveValue(stopped);
    await apply(`surface = new StandardSurface(); ${scene}`);
    await expect(bar).toBeHidden();
  } finally {
    await browser.close();
  }
});

test('anime un maillage USD importé par treillis dans la vue', async ({ baseURL }) => {
  test.setTimeout(240_000);
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--force_high_performance_gpu'],
  });
  const page = await browser.newPage();
  try {
    await page.goto(baseURL!);
    test.skip(!await page.evaluate(async () => Boolean(await navigator.gpu?.requestAdapter())), 'WebGPU indisponible dans Chrome.');
    await expect(page.locator('#app')).toHaveClass(/ui-ready/, { timeout: 120_000 });
    await expect(page.locator('#busy-indicator')).toBeHidden({ timeout: 120_000 });
    await page.locator('#open-script-editor').click();
    const e = editor(page);
    await setScript(e, `
surface = new StandardSurface(); surface.base_color = [0.1, 0.4, 0.8];
gem = await importMesh("./scenes/bench/p18-gem.usda", "/Gem");
gem.material = surface;
lattice = new Lattice(); lattice.offsets = Array(24).fill(0);
end = Array(24).fill(0);
for (const index of [2, 3, 6, 7]) end[index * 3] = 0.8;
lattice.keyframes = [{ time: 0, offsets: lattice.offsets }, { time: 24, offsets: end }];
gem.deformers = [lattice];
render.resolution = 256; render.backend = "raster";
setCamera({ eye: [3, 2, 5], target: [0, 0, 0], fov: 36 });
await render(1); await setTime(0);`);
    await expect(e.status).toContainText('Script valide', { timeout: 30_000 });
    await e.panel.getByTestId('script-apply').click();
    await expect(e.status).toHaveText('Script exécuté.', { timeout: 180_000 });
    const canvas = page.locator('#view');
    await page.waitForTimeout(1000);
    const before = await canvas.screenshot();
    await setScript(e, 'await setTime(24); await render(1);');
    await expect(e.status).toContainText('Script valide', { timeout: 30_000 });
    await e.panel.getByTestId('script-apply').click();
    await expect(e.status).toHaveText('Script exécuté.', { timeout: 180_000 });
    await page.waitForTimeout(1000);
    expect((await imageDifference(page, before, await canvas.screenshot())).mean).toBeGreaterThan(0.1);
  } finally {
    await browser.close();
  }
});

test('initialise le viewer avec les panneaux de rendu regroupés en onglets', async ({ baseURL }) => {
  test.setTimeout(240_000);
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--force_high_performance_gpu'],
  });
  try {
    for (const activeView of ['view', 'render']) {
      const page = await browser.newPage();
      const layout = {
        grid: { root: { type: 'branch', data: [{ type: 'leaf', data: { views: ['render', 'view'], activeView, id: '2' }, size: 800 }], size: 800 }, width: 800, height: 800, orientation: 'HORIZONTAL' },
        panels: {
          render: { id: 'render', contentComponent: 'render', title: 'Rendu interactif' },
          view: { id: 'view', contentComponent: 'view', title: 'Vue' },
        },
        activeGroup: '2',
      };
      await page.addInitScript(value => localStorage.setItem('materialx-webgpu-engine.workbench.v1', JSON.stringify(value)), layout);
      await page.goto(baseURL!);
      test.skip(!await page.evaluate(async () => Boolean(await navigator.gpu?.requestAdapter())), 'WebGPU indisponible dans Chrome.');
      await expect(page.locator('#app')).toHaveClass(/ui-ready/, { timeout: 120_000 });
      await expect(page.locator('#status')).toBeHidden();
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('capture une déformation animée avec obturateur en path tracing', async ({ baseURL }) => {
  test.setTimeout(480_000);
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--force_high_performance_gpu'],
  });
  const page = await browser.newPage({ acceptDownloads: true });
  const downloads: import('@playwright/test').Download[] = [];
  page.on('download', download => downloads.push(download));
  try {
    await page.goto(baseURL!);
    test.skip(!await page.evaluate(async () => Boolean(await navigator.gpu?.requestAdapter())), 'WebGPU indisponible dans Chrome.');
    await expect(page.locator('#app')).toHaveClass(/ui-ready/, { timeout: 120_000 });
    await expect(page.locator('#busy-indicator')).toBeHidden({ timeout: 120_000 });
    await page.locator('#open-script-editor').click();
    const e = editor(page);
    await setScript(e, `
surface = new StandardSurface(); surface.base_color = [0.2, 0.4, 0.8];
twist = new Twist(); twist.axis = "X";
twist.keyframes = [{ time: 0, angle: -120 }, { time: 12, angle: 0 }, { time: 24, angle: 120 }];
ribbon = new Plane({ width: 2, length: 1, axis: "Z", resolution: 16, material: surface });
ribbon.deformers = [twist];
render.resolution = 256; render.backend = "pathtracing"; render.depth = 2;
setCamera({ eye: [2, 2, 5], target: [0, 0, 0], fov: 38 });
await render(1); await setTime(0);
await capture("deformation-still.png", { samples: 32 });
await capture("deformation-blur.png", { samples: 32, shutter: [0, 24], steps: 8 });
await video("deformation-blur.webm", { start: 0, end: 24, fps: 2, samples: 4, shutter: [0, 2], steps: 2 });`);
    await expect(e.status).toContainText('Script valide', { timeout: 30_000 });
    await e.panel.getByTestId('script-apply').click();
    await expect(e.status).toHaveText('Script exécuté.', { timeout: 360_000 });
    await expect.poll(() => downloads.length, { timeout: 30_000 }).toBe(3);
    const still = downloads.find(download => download.suggestedFilename() === 'deformation-still.png')!;
    const blur = downloads.find(download => download.suggestedFilename() === 'deformation-blur.png')!;
    const [stillPath, blurPath] = await Promise.all([still.path(), blur.path()]);
    expect(stillPath).not.toBeNull();
    expect(blurPath).not.toBeNull();
    const [first, second] = await Promise.all([readFile(stillPath!), readFile(blurPath!)]);
    expect((await imageDifference(page, first, second)).mean).toBeGreaterThan(0.1);
    const video = downloads.find(download => download.suggestedFilename() === 'deformation-blur.webm');
    expect(video).toBeDefined();
    expect((await readFile((await video!.path())!)).length).toBeGreaterThan(100);
  } finally {
    await browser.close();
  }
});

test('exporte une animation en vidéo lisible avec des images différentes', async ({ baseURL }) => {
  test.setTimeout(240_000);
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--force_high_performance_gpu'],
  });
  const page = await browser.newPage({ acceptDownloads: true });
  try {
    await page.goto(baseURL!);
    test.skip(!await page.evaluate(async () => Boolean(await navigator.gpu?.requestAdapter())), 'WebGPU indisponible dans Chrome.');
    await expect(page.locator('#app')).toHaveClass(/ui-ready/, { timeout: 120_000 });
    await expect(page.locator('#busy-indicator')).toBeHidden({ timeout: 120_000 });
    await page.locator('#open-script-editor').click();
    const e = editor(page);
    await setScript(e, `
surface = new StandardSurface(); surface.base_color = [0.2, 0.4, 0.8];
twist = new Twist(); twist.axis = "X";
twist.keyframes = [{ time: 0, angle: -120 }, { time: 24, angle: 120 }];
ribbon = new Plane({ width: 2, length: 1, axis: "Z", resolution: 16, material: surface });
ribbon.deformers = [twist];
render.resolution = 256; render.backend = "raster";
setCamera({ eye: [2, 2, 5], target: [0, 0, 0], fov: 38 });
await render(1); await setTime(12);
await video("animation.mp4", { start: 0, end: 24, fps: 8 });`);
    await expect(e.status).toContainText('Script valide', { timeout: 30_000 });
    const downloadPromise = page.waitForEvent('download', { timeout: 180_000 });
    await e.panel.getByTestId('script-apply').click();
    const download = await downloadPromise;
    await expect(e.status).toHaveText('Script exécuté.', { timeout: 180_000 });
    expect(download.suggestedFilename()).toBe('animation.mp4');
    const path = await download.path();
    expect(path).not.toBeNull();
    const data = await readFile(path!);
    const result = await page.evaluate(async bytes => {
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }));
      try {
        const video = document.createElement('video');
        video.muted = true;
        video.src = url;
        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = () => reject(new Error('Cannot decode exported video.'));
        });
        video.currentTime = Math.min(0.01, video.duration / 2);
        await new Promise<void>((resolve, reject) => {
          video.onseeked = () => resolve();
          video.onerror = () => reject(new Error('Cannot seek exported video.'));
        });
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d')!;
        context.drawImage(video, 0, 0);
        const first = context.getImageData(0, 0, canvas.width, canvas.height).data;
        video.currentTime = video.duration * 0.75;
        await new Promise<void>((resolve, reject) => {
          video.onseeked = () => resolve();
          video.onerror = () => reject(new Error('Cannot seek exported video.'));
        });
        context.drawImage(video, 0, 0);
        const last = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let difference = 0;
        for (let i = 0; i < first.length; i++) difference += Math.abs(first[i]! - last[i]!);
        return { duration: video.duration, width: canvas.width, height: canvas.height, difference: difference / first.length };
      } finally {
        URL.revokeObjectURL(url);
      }
    }, [...data]);
    expect(result.duration).toBeCloseTo(1, 1);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.difference).toBeGreaterThan(0.1);
  } finally {
    await browser.close();
  }
});

test('convertit le script en graphe de scène puis conserve les modifications MaterialX', async ({ page }) => {
  const e = await openEditor(page);
  await e.panel.getByTestId('script-tab-scene-graph').click();
  page.once('dialog', dialog => dialog.accept());
  await e.panel.getByTestId('scene-graph-to-script').click();
  const example = await scriptOf(e);
  await setScript(e, example.replace('[0.12, 0.42, 0.72]', '[0.8, 0.2, 0.1]'));
  await expect(e.status).toContainText('Script valide');
  await e.panel.getByTestId('script-to-scene-graph').click();
  await expect(e.status).toContainText('converti en graphe de scène');
  await expect(e.panel.getByTestId('scene-graph-summary')).toHaveText('Prototype valide : 7 nœuds, 7 liens.');
  await setScript(e, (await scriptOf(e)).replace('[0.8, 0.2, 0.1]', '[0.1, 0.7, 0.2]'));

  const graph = e.panel.getByTestId('scene-graph').locator('.mx-node-graph');
  const point = await graph.evaluate(element => {
    const view = (element as HTMLElement & { mxGraph: {
      select(id: string, center: boolean): void;
      point(id: string, kind: string, name: string): { x: number; y: number } | undefined;
    } }).mxGraph;
    view.select('camera', true);
    return view.point('camera', 'widget', 'fov');
  });
  expect(point).toBeDefined();
  await page.mouse.click(point!.x, point!.y);
  await e.panel.getByTestId('scene-graph-to-script').click();
  await expectCode(e, 'surface.base_color = [0.1, 0.7, 0.2];');
  await expectCode(e, 'sphereB.material = material;');
  expect(await scriptOf(e)).not.toContain('fov: 42');

  const changedScene = (await scriptOf(e)).replace('render.depth = 4;', 'render.depth = 5;');
  await setScript(e, changedScene);
  await e.panel.getByTestId('scene-graph-to-script').click();
  await expect(e.panel.getByTestId('scene-graph-error')).toContainText('Le script de scène a changé');
  expect(await scriptOf(e)).toBe(changedScene);

  const unsupported = changedScene.replace('await render(16);', 'if (true) { log("non converti"); }');
  await setScript(e, unsupported);
  await e.panel.getByTestId('script-to-scene-graph').click();
  await expect(e.panel.getByTestId('scene-graph-error')).toContainText('structure JavaScript non convertible');
  expect(await scriptOf(e)).toBe(unsupported);
  await expect(e.panel.getByTestId('scene-graph-summary')).toHaveText('Prototype valide : 7 nœuds, 7 liens.');
});

test('IntelliSense propose les nœuds et leurs entrées/sorties issues des NodeDefs', async ({ page }, info) => {
  const e = await openEditor(page);
  await e.code.click();
  await e.code.press('Control+A');
  await e.code.press('Delete');

  await type(page, info, 'img = new Ima');
  await expect(e.completions).toBeVisible();
  await expect(e.completions.getByRole('option').first()).toContainText('Image');
  await pause(page, info);
  await acceptCompletion(page);
  await expect.poll(() => scriptOf(e)).toBe('img = new Image()');
  await page.keyboard.press('End');

  await type(page, info, ';\nimg.');
  await expect(e.completions.getByRole('option').first()).toContainText('file');
  await expect(e.completions).toContainText('entrée filename');
  await pause(page, info);
  await type(page, info, 'fi');
  await acceptCompletion(page);
  await type(page, info, ' = "wood.jpg";\nsurface = new StandardSurface();\nsurface.base_c');
  await expect(e.completions.getByRole('option').first()).toContainText('base_color');
  await pause(page, info);
  await acceptCompletion(page);

  await type(page, info, ' = img.');
  await expect(e.completions.getByRole('option').first()).toContainText('out');
  await expect(e.completions.getByRole('option').first()).toContainText('sortie color3');
  await pause(page, info);
  await acceptCompletion(page);
  await type(page, info, ';');

  await expect.poll(() => scriptOf(e)).toBe('img = new Image();\nimg.file = "wood.jpg";\nsurface = new StandardSurface();\nsurface.base_color = img.out;');
  await expect(e.status).toContainText('Script valide : 2 nœuds');
  await pause(page, info, 2500);
});

test('les helpers modifient couleur, booléen, entier et flottant', async ({ page }, info) => {
  const e = await openEditor(page);

  await caretOn(e, 'blend.fg');
  await expect(e.helper).toContainText('blend.fg : color3');
  const color = e.helper.getByTestId('helper-color');
  await expect(color).toHaveValue('#cc591a');
  await pause(page, info);
  await color.fill('#00ff00');
  await expectCode(e, 'blend.fg = [0, 1, 0];');
  await pause(page, info);

  await caretOn(e, 'surface.thin_walled');
  await expect(e.helper).toContainText('surface.thin_walled : boolean');
  await e.helper.getByTestId('helper-boolean').check();
  await expectCode(e, 'surface.thin_walled = true;');
  await pause(page, info);

  await caretOn(e, 'noise.octaves');
  await expect(e.helper).toContainText('noise.octaves : integer');
  await e.helper.getByTestId('helper-number').fill('6');
  await expectCode(e, 'noise.octaves = 6;');
  await pause(page, info);

  await caretOn(e, 'surface.specular_roughness');
  await expect(e.helper).toContainText('surface.specular_roughness : float');
  await e.helper.getByTestId('helper-range').fill('0.75');
  await expectCode(e, 'surface.specular_roughness = 0.75;');
  await expect(e.status).toContainText('Script valide');
  await pause(page, info, 2500);
});

test('convertit le script en XML MaterialX et le XML en script', async ({ page }, info) => {
  const e = await openEditor(page);

  await e.panel.getByTestId('script-to-xml').click();
  await expect(e.xml).toHaveValue(/<fractal3d name="noise" type="float" nodedef="ND_fractal3d_float">/);
  await expect(e.xml).toHaveValue(/<input name="mix" type="float" nodename="noise" \/>/);
  await expect(e.xml).toHaveValue(/<standard_surface name="surface" type="surfaceshader">/);
  await expect(e.xml).toHaveValue(/<surfacematerial name="material" type="material">/);
  await pause(page, info, 3000);

  const xml = await e.xml.inputValue();
  await e.xml.fill(xml.replace('<input name="octaves" type="integer" value="4" />', '<input name="octaves" type="integer" value="7" />'));
  await e.panel.getByTestId('script-from-xml').click();
  await expect(e.status).toContainText('Script généré');
  await expectCode(e, 'noise.octaves = 7;');
  await expectCode(e, 'material = new Surfacematerial();');
  await expectCode(e, 'material.surfaceshader = surface.out;');
  await expect(e.highlight.locator('.tok-node')).toContainText(['Surfacematerial']);
  await pause(page, info, 3000);

  await e.xml.fill('<materialx version="1.39"><bogus name="x" type="float" /></materialx>');
  await e.panel.getByTestId('script-from-xml').click();
  await expect(e.status).toContainText('Unknown node type <bogus>');
  await pause(page, info);
});

test('convertit le matériau courant (avec nodegraph) en script sans changer le rendu', async ({ page }, info) => {
  test.setTimeout(300_000);
  await page.goto(`${SOURCE_SCENE}&openpbr=./scenes/mtlx-library/Examples/StandardSurface/standard_surface_brick_procedural.mtlx`);
  const webgpu = await page.evaluate(async () => Boolean(await navigator.gpu?.requestAdapter()));
  test.skip(!webgpu, 'WebGPU indisponible dans ce navigateur.');
  await expect(page.locator('#app')).toHaveClass(/ui-ready/, { timeout: 120_000 });
  await expect(page.locator('#busy-indicator')).toBeHidden({ timeout: 120_000 });
  await page.waitForTimeout(3000);
  const before = await page.locator('#view').screenshot();

  await page.locator('#open-script-editor').click();
  const e = editor(page);
  await expect(e.status).toContainText('Script valide', { timeout: 30_000 });
  await e.panel.getByTestId('script-from-material').click();
  await expect(e.status).toHaveText('Script généré depuis le matériau de l’objet sélectionné.');
  await expectCode(e, 'M_BrickPattern = new Surfacematerial();');
  await expectCode(e, 'node_convert_1.in = 3;');
  await expect(e.xml).toHaveValue(/<surfacematerial name="M_BrickPattern" type="material">/);
  await pause(page, info, 3000);

  await e.panel.getByTestId('script-apply').click();
  await expect(e.status).toHaveText('Matériau appliqué.', { timeout: 180_000 });
  await e.panel.getByTestId('script-close').click();
  await expect(page.locator('#busy-indicator')).toBeHidden({ timeout: 120_000 });
  await page.waitForTimeout(3000);
  const difference = await imageDifference(page, before, await page.locator('#view').screenshot());
  console.log(`rendu avant/après : écart moyen ${difference.mean.toFixed(4)}, max ${difference.max}`);
  expect(difference.mean).toBeLessThan(0.5);
});

test('le menu charge chaque script de validation, accepté par la validation en direct', async ({ page }, info) => {
  const e = await openEditor(page);
  const menu = e.panel.getByTestId('script-examples');
  const options = menu.locator('option:not([value=""])');
  await expect(options).toHaveCount(7);
  const labels = await options.allTextContents();
  expect(labels[0]).toBe('Priorité 1 : rendu progressif intelligent');
  for (const [index, label] of labels.entries()) {
    await menu.selectOption(String(index));
    await expectCode(e, `// ${label}`);
    // The scenes are not loaded while validating: checks are skipped and scene queries answer empty.
    await expect(e.status).toContainText('Script valide', { timeout: 60_000 });
    await expect(e.status).not.toHaveClass(/error/);
    await pause(page, info);
  }
});

test('pilote le viewer depuis un script : scène, rendu, matériau conditionnel', async ({ page }, info) => {
  test.setTimeout(300_000);
  await page.goto('/');
  const webgpu = await page.evaluate(async () => Boolean(await navigator.gpu?.requestAdapter()));
  test.skip(!webgpu, 'WebGPU indisponible dans ce navigateur.');
  await expect(page.locator('#app')).toHaveClass(/ui-ready/, { timeout: 120_000 });
  await expect(page.locator('#busy-indicator')).toBeHidden({ timeout: 120_000 });
  await page.locator('#open-script-editor').click();
  const e = editor(page);
  await expect(e.status).toContainText('Script valide', { timeout: 30_000 });
  await setScript(e, `await scene("${SOURCE_SCENE.replace('/?entry=', '')}");
render.backend = "pathtracing";
render.depth = 4;
n = new Fractal3d("float");
surface = new StandardSurface();
surface.base_color = n.out > 0 ? [0.9, 0.2, 0.1] : [0.1, 0.2, 0.9];
surface.specular_roughness = Math.abs(n.out) * 0.5 + 0.2;
await assign(objects()[0], surface);
await render(4);`);
  await expect(e.status).toContainText('5 commandes viewer', { timeout: 30_000 });
  await pause(page, info);
  await e.panel.getByTestId('script-apply').click();
  await expect(e.status).toHaveText('Script exécuté.', { timeout: 240_000 });
  await expect(e.xml).toHaveValue(/<ifgreater name="ifgreater" type="color3">/);
  await expect(e.xml).toHaveValue(/<absval name="absval" type="float">/);
  await expect(page.locator('#pathtracing-spp')).toBeVisible();
  await e.panel.getByTestId('script-close').click();
  await pause(page, info, 4000);
});

test('applique le matériau scripté à l’objet sélectionné', async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.goto(SOURCE_SCENE);
  const webgpu = await page.evaluate(async () => Boolean(await navigator.gpu?.requestAdapter()));
  test.skip(!webgpu, 'WebGPU indisponible dans ce navigateur.');
  await expect(page.locator('#app')).toHaveClass(/ui-ready/, { timeout: 120_000 });
  await expect(page.locator('#busy-indicator')).toBeHidden({ timeout: 120_000 });

  await page.locator('#open-script-editor').click();
  const e = editor(page);
  await expect(e.status).toContainText('Script valide', { timeout: 30_000 });
  await caretOn(e, 'blend.fg');
  await e.helper.getByTestId('helper-color').fill('#20c040');
  await pause(page, info);
  await e.panel.getByTestId('script-apply').click();
  await expect(e.status).toHaveText('Matériau appliqué.', { timeout: 180_000 });
  await expect(page.locator('#status')).toBeHidden();
  await e.panel.getByTestId('script-close').click();
  await pause(page, info, 5000);
  await info.attach('rendu', { body: await page.locator('#view').screenshot(), contentType: 'image/png' });
});
