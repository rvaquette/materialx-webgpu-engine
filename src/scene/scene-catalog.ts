// Selectable scenes are relative to the app so builds also work under /dist/.
export interface SceneCatalogEntry {
  label: string;
  entry: string;
  textureRoot?: string;
}

const pathTracerScenes = Object.keys(import.meta.glob('/scenes/pathtracer/*.usda', { query: '?raw', import: 'default' }))
  .sort()
  .map((path): SceneCatalogEntry => ({
    label: `Pathtracer - ${path.slice('/scenes/pathtracer/'.length).replace(/\.usda$/, '').replace(/_/g, ' ')}`,
    entry: `.${path}`,
  }));

const lamaLayerLabels: Readonly<Record<string, string>> = {
  'lama_layer_verdigris.usda': 'Lama - LamaLayer Verdigris (aged brass)',
  'lama_layer_gold_fresnel_blend.usda': 'LamaLayer Gold - Fresnel Blend',
  'lama_layer_gold_smooth_coating.usda': 'LamaLayer Gold - Smooth Coating',
  'lama_layer_gold_rough_coating.usda': 'LamaLayer Gold - Rough Coating',
  'lama_layer_gold_auto.usda': 'LamaLayer Gold - Auto',
};

const lamaScenes = Object.keys(import.meta.glob('/scenes/pathtracer/lama/*.usda', { query: '?raw', import: 'default' }))
  .sort()
  .map((path): SceneCatalogEntry => {
    const filename = path.slice('/scenes/pathtracer/lama/'.length);
    return {
      label: lamaLayerLabels[filename] ?? `Lama - ${filename.replace(/\.usda$/, '').replace(/_/g, ' ')}`,
      entry: `.${path}`,
    };
  });

const gltfScenes = Object.keys(import.meta.glob('/scenes/pathtracer/*.{gltf,glb}', { query: '?url', import: 'default' }))
  .sort()
  .map((path): SceneCatalogEntry => ({
    label: `Pathtracer - ${path.slice('/scenes/pathtracer/'.length).replace(/_/g, ' ')}`,
    entry: `.${path}`,
  }));

const compiledScenes = Object.keys(import.meta.glob('/scenes/**/scene.json', { query: '?url', import: 'default' }))
  .sort()
  .map((path): SceneCatalogEntry => {
    const name = path.slice('/scenes/'.length, -'/scene.json'.length).split('/').at(-1) ?? 'Unknown';
    return { label: `Compiled - ${name}`, entry: `.${path}` };
  });

const openPbrScenes = Object.keys(import.meta.glob('/scenes/OpenPBRShaderPlayground/*_grp/*_grp.usda', { query: '?raw', import: 'default' }))
  .sort()
  .map((path): SceneCatalogEntry => {
    const name = path.match(/\/([^/]+)_grp\/\1_grp\.usda$/)?.[1] ?? 'Unknown';
    return {
      label: `OpenPBR Shader Playground - ${name.replace(/([A-Z])/g, ' $1').trim()}`,
      entry: `.${path}`,
    };
  });

export const SCENE_CATALOG: readonly SceneCatalogEntry[] = [
  { label: 'Simple shader ball', entry: './scenes/standard-shader-ball/openpbr-rva-standard-shader-ball.usda' },
  { label: 'Standard shader ball', entry: './scenes/standard-shader-ball/standard-shader-ball.usda' },
  ...pathTracerScenes,
  ...lamaScenes,
  ...gltfScenes,
  ...compiledScenes,
  { label: 'OpenPBR Shader Playground - Selection (9 groups)', entry: './scenes/OpenPBRShaderPlayground/playground_selection.usda' },
  { label: 'OpenPBR Shader Playground - Selection 2 (8 groups)', entry: './scenes/OpenPBRShaderPlayground/playground_selection_2.usda' },
  ...openPbrScenes,
  ...(import.meta.env.DEV ? [{
    label: 'OpenPBR Shader Playground (local)',
    entry: './playground/ShdrPlygrnd_OpenPBR.usda',
    textureRoot: './playground/',
  }] : []),
];
