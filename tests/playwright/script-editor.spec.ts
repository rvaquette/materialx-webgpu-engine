import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

// Run `npm run test:playwright:demo` to watch these tests in a slowed-down browser.

const SOURCE_SCENE = '/?entry=./scenes/standard-shader-ball/standard-shader-ball.usda';

interface Editor {
  panel: Locator;
  code: Locator;
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
    code: panel.getByTestId('script-code'),
    highlight: panel.getByTestId('script-highlight'),
    completions: panel.getByTestId('script-completions'),
    helper: panel.getByTestId('script-value-helper'),
    status: panel.getByTestId('script-status'),
    xml: panel.getByTestId('script-xml'),
  };
}

const demo = (info: TestInfo): boolean => info.project.name === 'demo';

/** Give the viewer of a demo run time to read the screen. */
async function pause(page: Page, info: TestInfo, ms = 1500): Promise<void> {
  if (demo(info)) await page.waitForTimeout(ms);
}

async function type(page: Page, info: TestInfo, text: string): Promise<void> {
  await page.keyboard.type(text, { delay: demo(info) ? 70 : 0 });
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
  await expect(e.code).toHaveValue(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

/** Put the caret at the end of the first line containing `text`. */
async function caretOn(e: Editor, text: string): Promise<void> {
  await e.code.evaluate((element, needle) => {
    const area = element as HTMLTextAreaElement;
    const start = area.value.indexOf(needle);
    const end = area.value.indexOf('\n', start);
    area.focus();
    area.setSelectionRange(end, end);
  }, text);
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

test('IntelliSense propose les nœuds et leurs entrées/sorties issues des NodeDefs', async ({ page }, info) => {
  const e = await openEditor(page);
  await e.code.press('Control+A');
  await e.code.press('Delete');

  await type(page, info, 'img = new Ima');
  await expect(e.completions).toBeVisible();
  await expect(e.completions.getByTestId('script-completion').first()).toContainText('Image');
  await pause(page, info);
  await page.keyboard.press('Enter');
  await expect(e.code).toHaveValue('img = new Image()');
  await page.keyboard.press('End');

  await type(page, info, ';\nimg.');
  await expect(e.completions.getByTestId('script-completion').first()).toContainText('file');
  await expect(e.completions).toContainText('entrée filename');
  await pause(page, info);
  await type(page, info, 'fi');
  await page.keyboard.press('Enter');
  await type(page, info, ' = "wood.jpg";\nsurface = new StandardSurface();\nsurface.base_c');
  await expect(e.completions.getByTestId('script-completion').first()).toContainText('base_color');
  await pause(page, info);
  await page.keyboard.press('Enter');

  await type(page, info, ' = img.');
  await expect(e.completions.getByTestId('script-completion').first()).toContainText('out');
  await expect(e.completions.getByTestId('script-completion').first()).toContainText('sortie color3');
  await pause(page, info);
  await page.keyboard.press('Enter');
  await type(page, info, ';');

  await expect(e.code).toHaveValue('img = new Image();\nimg.file = "wood.jpg";\nsurface = new StandardSurface();\nsurface.base_color = img.out;');
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
