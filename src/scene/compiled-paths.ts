// Layout of precompiled assets, shared by the app catalogs and scripts/compile-scenes.mjs
// (kept free of TypeScript-only runtime syntax so Node can import it directly).
//   scenes/<dir>/<name>.usda          -> scenes/compiled/<dir>/<name>.usda (wrapper layer)
//                                        scenes/compiled/<dir>/<name>/scene.json + payloads
//   scenes/<dir>/<name>.gltf          -> scenes/compiled/<dir>/<name>_gltf.usda, .../<name>_gltf/
//   scenes/mtlx-library/<dir>/<m>.mtlx -> scenes/compiled/mtlx-library/<dir>/<m>/material.json

export const COMPILED_ROOT = 'scenes/compiled';

function sceneRelative(source: string): string {
  const relative = source.replace(/\\/g, '/').replace(/^\.?\//, '');
  if (!relative.startsWith('scenes/') || relative.startsWith(`${COMPILED_ROOT}/`) || relative.split('/').includes('..')) {
    throw new Error(`Compiled sources must live under scenes/ (outside ${COMPILED_ROOT}): ${source}`);
  }
  return relative.slice('scenes/'.length);
}

/** Path below scenes/compiled identifying a source scene's compiled assets. */
export function compiledSceneStem(source: string): string {
  const match = /^(.+)\.(usda|usdc|usd|gltf|glb)$/i.exec(sceneRelative(source));
  if (!match) throw new Error(`Unsupported scene source: ${source}`);
  const extension = match[2]!.toLowerCase();
  return extension.startsWith('usd') ? match[1]! : `${match[1]}_${extension}`;
}

export function compiledWrapperPath(source: string): string {
  return `${COMPILED_ROOT}/${compiledSceneStem(source)}.usda`;
}

export function compiledSceneDirectory(source: string): string {
  return `${COMPILED_ROOT}/${compiledSceneStem(source)}`;
}

export function compiledMaterialDirectory(source: string): string {
  const match = /^(mtlx-library\/.+)\.mtlx$/i.exec(sceneRelative(source));
  if (!match) throw new Error(`Unsupported material source: ${source}`);
  return `${COMPILED_ROOT}/${match[1]}`;
}

/** USDA layer whose customLayerData points at the compiled scene and shader binaries. */
export function compiledWrapperLayer(source: string): string {
  const stem = compiledSceneStem(source);
  const name = stem.split('/').at(-1)!;
  const sourcePath = `${'../'.repeat(stem.split('/').length)}${sceneRelative(source)}`;
  const isUsd = /\.usd[ac]?$/i.test(source);
  return [
    '#usda 1.0',
    '(',
    '    customLayerData = {',
    `        string "materialx:compiledScene" = "./${name}/scene.json"`,
    `        string "materialx:compiledShaders" = "./${name}/shaders.wgsl.zst"`,
    `        string "materialx:source" = "${sourcePath}"`,
    '    }',
    ...(isUsd ? [`    subLayers = [@${sourcePath}@]`] : []),
    ')',
    '',
  ].join('\n');
}
