import { expect, test } from '@playwright/test';

test('opens a MaterialX node example in the script editor', async ({ page }) => {
  await page.goto('/?entry=./scenes/standard-shader-ball/standard-shader-ball.usda');
  await page.locator('#toggle-node-reference-panel').click();
  const reference = page.locator('.mx-node-reference');
  await expect(reference.locator('.mx-node-reference-page h2')).toContainText('standard_surface', { timeout: 30_000 });
  await expect(reference.locator('.mx-node-reference-preview')).toBeVisible();
  await expect(reference.getByRole('button', { name: 'Rendre l’aperçu' })).toBeVisible();
  await reference.getByRole('button', { name: 'Ouvrir dans l’éditeur' }).click();
  const editor = page.locator('#script-editor-panel');
  await expect(editor).toBeVisible();
  await expect(editor.locator('.cm-content')).toContainText('new StandardSurface()');
  await expect(editor.locator('.cm-content')).toContainText('previewSphere.material = previewMaterial;');
});
