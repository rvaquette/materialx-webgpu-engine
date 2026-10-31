// Selectable USD scenes are relative to the app so builds also work under /dist/.
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

export const SCENE_CATALOG: readonly SceneCatalogEntry[] = [
  { label: 'Standard shader ball', entry: './scenes/standard-shader-ball/standard-shader-ball.usda' },
  { label: 'Simple shader ball', entry: './scenes/standard-shader-ball/openpbr-rva-standard-shader-ball.usda' },
  ...pathTracerScenes,
  ...(import.meta.env.DEV ? [{
    label: 'OpenPBR Shader Playground (local)',
    entry: './playground/ShdrPlygrnd_OpenPBR.usda',
    textureRoot: './playground/',
  }] : []),
];
