// Selectable USD scenes are relative to the app so builds also work under /dist/.
export interface SceneCatalogEntry {
  label: string;
  entry: string;
  textureRoot?: string;
}

export const SCENE_CATALOG: readonly SceneCatalogEntry[] = [
  { label: 'Standard shader ball', entry: './scenes/standard-shader-ball/standard-shader-ball.usda' },
  { label: 'Simple shader ball', entry: './scenes/standard-shader-ball/openpbr-rva-standard-shader-ball.usda' },
  { label: 'Disney gold', entry: './scenes/test_material_disney_gold/test_material_disney_gold.usda' },
  { label: 'Brick procedural', entry: './scenes/test_material_brick_procedural/test_material_brick_procedural.usda' },
  { label: 'Brick + metal mix', entry: './scenes/test_material_brick_metal_mix/test_material_brick_metal_mix.usda' },
  { label: 'Metal brushed', entry: './scenes/test_material_metal_brushed/test_material_metal_brushed.usda' },
  { label: 'Velvet', entry: './scenes/test_material_velvet/test_material_velvet.usda' },
  ...(import.meta.env.DEV ? [{
    label: 'OpenPBR Shader Playground (local)',
    entry: './playground/ShdrPlygrnd_OpenPBR.usda',
    textureRoot: './playground/',
  }] : []),
];
