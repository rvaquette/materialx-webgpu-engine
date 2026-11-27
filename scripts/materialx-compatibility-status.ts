import type { ScriptNodeDef } from '../src/materialx/script-api.ts';

type Status = 'partial' | 'approximated' | 'unsupported' | 'extension' | 'unknown';
type Backends = Readonly<Record<'raster' | 'materialxPathTracing' | 'disney' | 'cpuBake', Status>>;

interface CompatibilityCase {
  readonly backends: Backends;
  readonly condition: string;
  readonly evidence: readonly string[];
}

export const COMPATIBILITY_CASES = {
  unknown: {
    backends: { raster: 'unknown', materialxPathTracing: 'unknown', disney: 'unknown', cpuBake: 'unknown' },
    condition: 'No per-variant conclusion: inspect the graph, inputs, type, context and diagnostics.',
    evidence: [],
  },
  engine: {
    backends: { raster: 'extension', materialxPathTracing: 'extension', disney: 'extension', cpuBake: 'extension' },
    condition: 'Engine extension, not a support claim: availability depends on the operation, backend, inputs and graph; see the extension table.',
    evidence: ['src/materialx/engine-shaders.ts', 'docs/SCRIPT_REFERENCE.md'],
  },
  engineEnvironment: {
    backends: { raster: 'partial', materialxPathTracing: 'partial', disney: 'unknown', cpuBake: 'partial' },
    condition: 'Engine extension: literal settings are baked to an environment map; Disney use is not established, and the map is not a portable shader implementation.',
    evidence: ['src/materialx/engine-shaders.ts', 'docs/SCRIPT_REFERENCE.md'],
  },
  engineImage: {
    backends: { raster: 'partial', materialxPathTracing: 'partial', disney: 'partial', cpuBake: 'unsupported' },
    condition: 'Engine extension: screen-space image effects use literal settings; the image operation is not a bakeable MaterialX value graph.',
    evidence: ['src/materialx/engine-shaders.ts', 'docs/SCRIPT_REFERENCE.md'],
  },
  engineLens: {
    backends: { raster: 'partial', materialxPathTracing: 'partial', disney: 'partial', cpuBake: 'unsupported' },
    condition: 'Engine extension: screen effects work on all three renderers; camera projection and aperture require MaterialX path tracing and are rejected by raster and Disney.',
    evidence: ['src/materialx/engine-shaders.ts', 'docs/SCRIPT_REFERENCE.md'],
  },
  engineAov: {
    backends: { raster: 'unsupported', materialxPathTracing: 'partial', disney: 'unsupported', cpuBake: 'unsupported' },
    condition: 'Engine extension: MaterialX path-tracing AOV with a restricted set of sources; not a bakeable MaterialX value graph.',
    evidence: ['src/materialx/engine-shaders.ts', 'docs/SCRIPT_REFERENCE.md'],
  },
  engineLightFilter: {
    backends: { raster: 'unsupported', materialxPathTracing: 'partial', disney: 'unsupported', cpuBake: 'unsupported' },
    condition: 'Engine extension: limited procedural gobo patterns on a path-traced spot light only.',
    evidence: ['src/materialx/engine-shaders.ts', 'docs/SCRIPT_REFERENCE.md'],
  },
  engineScatter: {
    backends: { raster: 'partial', materialxPathTracing: 'partial', disney: 'partial', cpuBake: 'partial' },
    condition: 'Engine extension: generated instances can render in each backend; CPU placement supports only the documented density graph subset.',
    evidence: ['src/materialx/engine-shaders.ts', 'docs/SCRIPT_REFERENCE.md'],
  },
  engineSurfacePreset: {
    backends: { raster: 'partial', materialxPathTracing: 'partial', disney: 'unknown', cpuBake: 'partial' },
    condition: 'Engine preset: surface and displacement graph can be expanded; CPU baking and Disney depend on terminals and input graphs.',
    evidence: ['src/materialx/engine-presets.ts', 'docs/MATERIALX_COMPATIBILITY.md'],
  },
  engineVolumePreset: {
    backends: { raster: 'approximated', materialxPathTracing: 'approximated', disney: 'unsupported', cpuBake: 'partial' },
    condition: 'Engine volume preset: CPU-baked finite field and distinct raster/path transport; Disney rejects volumes.',
    evidence: ['src/materialx/engine-presets.ts', 'src/render/volume-field.ts', 'src/render/pathtracing/disney-scene.ts'],
  },
  engineVolumeTerminal: {
    backends: { raster: 'partial', materialxPathTracing: 'partial', disney: 'unsupported', cpuBake: 'unsupported' },
    condition: 'Engine volume-material terminal: volume rendering depends on the connected shader, Disney rejects the terminal, and the terminal is not a numeric baking output.',
    evidence: ['src/materialx/engine-shaders.ts', 'src/render/pathtracing/disney-scene.ts'],
  },
  standardSurface: {
    backends: { raster: 'partial', materialxPathTracing: 'partial', disney: 'approximated', cpuBake: 'partial' },
    condition: 'As a root surface only; Disney accepts a restricted subset, and CPU baking extracts selected maps rather than evaluating a closure.',
    evidence: ['src/materialx/surface-graph.ts', 'src/render/pathtracing/disney-standard-material.ts', 'tests/render/pathtracing/disney-standard-material.test.ts', 'docs/BAKING_EXPORT.md'],
  },
  disneySurface: {
    backends: { raster: 'partial', materialxPathTracing: 'partial', disney: 'approximated', cpuBake: 'partial' },
    condition: 'As a root surface only; Disney conversion requires literal or default inputs and approximates the model. CPU baking extracts selected maps.',
    evidence: ['src/materialx/surface-graph.ts', 'src/render/pathtracing/disney-material.ts', 'tests/render/pathtracing/disney-material.test.ts', 'docs/BAKING_EXPORT.md'],
  },
  otherSurface: {
    backends: { raster: 'partial', materialxPathTracing: 'partial', disney: 'unsupported', cpuBake: 'partial' },
    condition: 'As a root surface only; Disney rejects these root families. CPU baking extracts selected maps, not a closure.',
    evidence: ['src/materialx/surface-graph.ts', 'src/render/pathtracing/disney-scene.ts', 'docs/BAKING_EXPORT.md'],
  },
  floatMath: {
    backends: { raster: 'partial', materialxPathTracing: 'partial', disney: 'unknown', cpuBake: 'partial' },
    condition: 'Float output in a surface-value graph; selected literal-input cases are lowered and CPU-evaluated. Other inputs, contexts and numerical equivalence are not established.',
    evidence: ['src/compiler/surface-ir.ts', 'tests/compiler/surface-ir.test.ts'],
  },
  split: {
    backends: { raster: 'approximated', materialxPathTracing: 'approximated', disney: 'unknown', cpuBake: 'approximated' },
    condition: 'Numeric output in a surface-value graph: hard boundary instead of the reference GLSL antialiasing. Types and contexts beyond the tested cases require verification.',
    evidence: ['src/compiler/surface-ir.ts', 'tests/compiler/surface-ir.test.ts', 'libraries/stdlib/genglsl/mx_splitlr_float.glsl'],
  },
  geometryPropertyUv: {
    backends: { raster: 'partial', materialxPathTracing: 'partial', disney: 'unknown', cpuBake: 'partial' },
    condition: 'Surface value with explicit geomprop st or UV0 and vector2 output; other properties fall back with a warning.',
    evidence: ['src/compiler/surface-ir.ts', 'tests/compiler/surface-ir.test.ts'],
  },
  geometryPropertyFloat: {
    backends: { raster: 'partial', materialxPathTracing: 'partial', disney: 'unsupported', cpuBake: 'unknown' },
    condition: 'Float named volume fields are accepted in volume context; ordinary surface use falls back to the default with a warning. Disney rejects volume terminals.',
    evidence: ['src/compiler/surface-ir.ts', 'tests/compiler/surface-ir.test.ts', 'src/render/pathtracing/disney-scene.ts'],
  },
  geometryPropertyOther: {
    backends: { raster: 'unsupported', materialxPathTracing: 'unsupported', disney: 'unknown', cpuBake: 'unsupported' },
    condition: 'In surface-value lowering this output type is replaced by the declared default with a warning; other contexts may behave differently.',
    evidence: ['src/compiler/surface-ir.ts', 'tests/compiler/surface-ir.test.ts'],
  },
  imageTexture: {
    backends: { raster: 'partial', materialxPathTracing: 'partial', disney: 'partial', cpuBake: 'partial' },
    condition: 'Surface-value image with a resolved texture; Disney only accepts documented color3 image graphs and uses nearest periodic sampling. Other variants and settings require verification.',
    evidence: ['src/compiler/surface-ir.ts', 'src/render/pathtracing/disney-texture-graphs.ts', 'tests/compiler/surface-ir.test.ts', 'docs/BAKING_EXPORT.md'],
  },
  otherTexture: {
    backends: { raster: 'partial', materialxPathTracing: 'partial', disney: 'unknown', cpuBake: 'partial' },
    condition: 'Supported surface-value texture lowering requires resolved resources and supported inputs; direct CPU preview rejects vector2, vector4 and color4 outputs, though these can occur inside other bakeable graphs. Disney accepts only specific image graphs. Other contexts require verification.',
    evidence: ['src/compiler/surface-ir.ts', 'tests/compiler/surface-ir.test.ts', 'docs/BAKING_EXPORT.md'],
  },
  separate: {
    backends: { raster: 'partial', materialxPathTracing: 'partial', disney: 'unknown', cpuBake: 'partial' },
    condition: 'A named channel output in a surface-value graph; invalid or missing channel output produces a warning and zero. Disney only matches a specific separate3 graph.',
    evidence: ['src/compiler/surface-ir.ts', 'tests/compiler/surface-ir.test.ts', 'src/render/pathtracing/disney-texture-graphs.ts'],
  },
  flake: {
    backends: { raster: 'partial', materialxPathTracing: 'partial', disney: 'unknown', cpuBake: 'partial' },
    condition: 'In surface-value graphs, named id, rand, presence and flakenormal outputs are evaluated; unsupported outputs and zero or invalid size are diagnosed.',
    evidence: ['src/compiler/surface-ir.ts', 'tests/compiler/surface-ir.test.ts', 'tests/compiler/surface-wgsl.test.ts'],
  },
  artisticIor: {
    backends: { raster: 'partial', materialxPathTracing: 'partial', disney: 'unknown', cpuBake: 'partial' },
    condition: 'Named ior and extinction outputs in a surface-value graph; support is conditional on the surrounding graph and input values.',
    evidence: ['src/compiler/surface-ir.ts', 'tests/compiler/surface-ir.test.ts', 'src/compiler/ir-eval.ts'],
  },
  gltfColorImage: {
    backends: { raster: 'partial', materialxPathTracing: 'partial', disney: 'unknown', cpuBake: 'partial' },
    condition: 'Named color or alpha output in a surface-value graph with resolved resources; no general claim for all glTF image graphs.',
    evidence: ['src/compiler/surface-ir.ts', 'tests/compiler/surface-ir.test.ts'],
  },
  hairRoughness: {
    backends: { raster: 'unknown', materialxPathTracing: 'unknown', disney: 'unknown', cpuBake: 'approximated' },
    condition: 'In direct surface-value lowering the CPU interpreter uses one simplified pair for all named outputs and ignores scale_TT and scale_TRT; result shape and GPU behavior require verification.',
    evidence: ['src/compiler/surface-ir.ts', 'src/compiler/ir-eval.ts', 'tests/compiler/surface-ir.test.ts', 'libraries/pbrlib/genglsl/mx_chiang_hair_bsdf.glsl'],
  },
  unloweredMulti: {
    backends: { raster: 'unsupported', materialxPathTracing: 'unsupported', disney: 'unknown', cpuBake: 'unsupported' },
    condition: 'An unflattened named output reaching surface-value lowering becomes a neutral constant with a warning; resolved nodegraphs and USD import paths can behave differently.',
    evidence: ['src/compiler/surface-ir.ts', 'tests/compiler/surface-ir.test.ts', 'src/usd/preview-surface.ts'],
  },
  triplanar: {
    backends: { raster: 'partial', materialxPathTracing: 'partial', disney: 'unsupported', cpuBake: 'partial' },
    condition: 'In a surface-value graph for the tested output shapes; cubic filtering is approximated by linear. Direct CPU preview rejects vector2, vector4 and color4 outputs, though these can occur inside other bakeable graphs. Disney texture conversion only matches its documented image patterns.',
    evidence: ['src/compiler/surface-ir.ts', 'tests/compiler/surface-ir.test.ts', 'src/render/pathtracing/disney-texture-graphs.ts'],
  },
  unloweredValue: {
    backends: { raster: 'unsupported', materialxPathTracing: 'unsupported', disney: 'unknown', cpuBake: 'unsupported' },
    condition: 'When this numeric node reaches surface-value lowering unflattened, it is replaced by a neutral constant with a warning. A resolved implementation nodegraph may behave differently.',
    evidence: ['src/compiler/surface-ir.ts', 'tests/compiler/surface-ir.test.ts'],
  },
  cpuProbe: {
    backends: { raster: 'unknown', materialxPathTracing: 'unknown', disney: 'unknown', cpuBake: 'partial' },
    condition: 'A single unconnected value node evaluated by the CPU IR interpreter using script-recognized literal defaults and fixed varyings. Not a reference comparison or a guarantee of bakeable output; other inputs and graphs may fail.',
    evidence: ['scripts/materialx-compatibility-cpu.ts', 'tests/materialx/materialx-compatibility.test.ts', 'src/compiler/ir-eval.ts'],
  },
  cpuProbeDisneyRejected: {
    backends: { raster: 'unknown', materialxPathTracing: 'unknown', disney: 'unsupported', cpuBake: 'partial' },
    condition: 'CPU: one unconnected value node with recorded literal defaults and fixed varyings; not a reference comparison or baking guarantee. Disney: a synthetic node with recorded NodeDef defaults and no authored inputs, connected directly to standard_surface base (float) or base_color (color3), without editor parameters, is rejected; other graphs and constant-folded parameters may differ.',
    evidence: ['scripts/materialx-compatibility-cpu.ts', 'scripts/materialx-compatibility-disney.ts', 'src/render/pathtracing/disney-standard-material.ts', 'tests/materialx/materialx-compatibility.test.ts'],
  },
  cpuUnimplemented: {
    backends: { raster: 'unknown', materialxPathTracing: 'unknown', disney: 'unknown', cpuBake: 'unsupported' },
    condition: 'An unflattened value node reached the CPU IR interpreter and its operator had no evaluator. An expanded nodegraph or other context may differ.',
    evidence: ['scripts/materialx-compatibility-cpu.ts', 'src/compiler/ir-eval.ts'],
  },
  cpuUnimplementedDisneyRejected: {
    backends: { raster: 'unknown', materialxPathTracing: 'unknown', disney: 'unsupported', cpuBake: 'unsupported' },
    condition: 'The exact unconnected CPU value probe reached an operator without an evaluator. A synthetic node with recorded NodeDef defaults and no authored inputs, connected directly to standard_surface base (float) or base_color (color3) without editor parameters, is rejected by Disney. Expanded graphs and other contexts may differ.',
    evidence: ['scripts/materialx-compatibility-cpu.ts', 'scripts/materialx-compatibility-disney.ts', 'src/compiler/ir-eval.ts', 'src/render/pathtracing/disney-standard-material.ts'],
  },
  cpuProbeFailure: {
    backends: { raster: 'unknown', materialxPathTracing: 'unknown', disney: 'unknown', cpuBake: 'unsupported' },
    condition: 'The exact unconnected CPU probe using the recorded defaults and fixed varyings failed or produced an invalid shape or non-finite value; inspect cpuProbe.message. Other input values and contexts may behave differently.',
    evidence: ['scripts/materialx-compatibility-cpu.ts', 'src/compiler/ir-eval.ts'],
  },
  cpuProbeFailureDisneyRejected: {
    backends: { raster: 'unknown', materialxPathTracing: 'unknown', disney: 'unsupported', cpuBake: 'unsupported' },
    condition: 'The exact unconnected CPU probe using the recorded defaults and fixed varyings failed or produced an invalid shape or non-finite value; inspect cpuProbe.message. A synthetic node with recorded NodeDef defaults and no authored inputs, connected directly to standard_surface base (float) or base_color (color3) without editor parameters, is rejected by Disney. Other contexts may differ.',
    evidence: ['scripts/materialx-compatibility-cpu.ts', 'scripts/materialx-compatibility-disney.ts', 'src/compiler/ir-eval.ts', 'src/render/pathtracing/disney-standard-material.ts'],
  },
  nonNumericOutput: {
    backends: { raster: 'unknown', materialxPathTracing: 'unknown', disney: 'unknown', cpuBake: 'unsupported' },
    condition: 'A standalone string, filename, closure, shader or material output is not a numeric CPU preview; surface-parameter baking and other contexts are separate.',
    evidence: ['src/materialx/bake.ts', 'src/compiler/ir-eval.ts', 'docs/BAKING_EXPORT.md'],
  },
} as const satisfies Record<string, CompatibilityCase>;

export type CompatibilityCaseId = keyof typeof COMPATIBILITY_CASES;

export function compatibilityCase(
  definition: Pick<ScriptNodeDef, 'category' | 'outputs'>,
  origin: string,
  cpuProbe?: { status: string; message?: string },
  disneyProbe?: { status: string },
): CompatibilityCaseId {
  if (origin === 'engine') {
    switch (definition.category) {
      case 'environment_shader': return 'engineEnvironment';
      case 'image_shader': return 'engineImage';
      case 'lens_shader': return 'engineLens';
      case 'aov_shader':
      case 'custom_aov_shader': return 'engineAov';
      case 'light_filter_shader': return 'engineLightFilter';
      case 'scatter_shader': return 'engineScatter';
      case 'water':
      case 'water_caustics':
      case 'lava':
      case 'ice':
      case 'mud':
      case 'wet_sand': return 'engineSurfacePreset';
      case 'fire':
      case 'smoke':
      case 'clouds': return 'engineVolumePreset';
      case 'surfacematerial': return 'engineVolumeTerminal';
      default: return 'engine';
    }
  }
  if (definition.outputs.length > 1) {
    if (['separate2', 'separate3', 'separate4'].includes(definition.category)) return 'separate';
    if (['flake2d', 'flake3d'].includes(definition.category)) return 'flake';
    if (definition.category === 'artistic_ior') return 'artisticIor';
    if (definition.category === 'gltf_colorimage') return 'gltfColorImage';
    if (definition.category === 'chiang_hair_roughness') return 'hairRoughness';
    if (['gltf_anisotropy_image', 'UsdUVTexture'].includes(definition.category)) return 'unloweredMulti';
  }
  if (definition.outputs.length !== 1) return 'unknown';
  const type = definition.outputs[0]?.type;
  if (definition.category === 'geompropvalue') {
    if (type === 'vector2') return 'geometryPropertyUv';
    if (type === 'float') return 'geometryPropertyFloat';
    return 'geometryPropertyOther';
  }
  if (definition.category === 'image') return type === 'color3' ? 'imageTexture' : 'otherTexture';
  if (['tiledimage', 'hextiledimage', 'gltf_image', 'gltf_normalmap', 'gltf_iridescence_thickness', 'hextilednormalmap', 'latlongimage'].includes(definition.category)) return 'otherTexture';
  if (definition.category === 'triplanarprojection'
      && type !== undefined && ['float', 'color3', 'color4', 'vector2', 'vector3', 'vector4'].includes(type)) return 'triplanar';
  if (type !== undefined && ['float', 'integer', 'boolean', 'color3', 'color4', 'vector2', 'vector3', 'vector4'].includes(type)
      && ['UsdPrimvarReader', 'UsdTransform2d', 'glossiness_anisotropy'].includes(definition.category)) return 'unloweredValue';
  if (type === 'surfaceshader') {
    if (definition.category === 'standard_surface') return 'standardSurface';
    if (definition.category === 'disney_principled') return 'disneySurface';
    if (['surface', 'open_pbr_surface', 'gltf_pbr', 'UsdPreviewSurface'].includes(definition.category)) return 'otherSurface';
  }
  if (type !== undefined && ['float', 'color3', 'color4', 'vector2', 'vector3', 'vector4'].includes(type)
      && ['splitlr', 'splittb'].includes(definition.category)) return 'split';
  if (type === 'float') {
    if (['sqrt', 'ln', 'exp', 'power', 'safepower'].includes(definition.category)) return 'floatMath';
  }
  if (type !== undefined && ['string', 'filename', 'BSDF', 'EDF', 'VDF', 'surfaceshader', 'volumeshader', 'displacementshader', 'lightshader', 'material'].includes(type)) return 'nonNumericOutput';
  if (cpuProbe?.status === 'evaluated') return disneyProbe?.status === 'rejected' ? 'cpuProbeDisneyRejected' : 'cpuProbe';
  if (cpuProbe?.status === 'error' && cpuProbe.message?.startsWith('IrEvalError: no CPU evaluation for node ')) {
    return disneyProbe?.status === 'rejected' ? 'cpuUnimplementedDisneyRejected' : 'cpuUnimplemented';
  }
  if (cpuProbe?.status === 'error') return disneyProbe?.status === 'rejected' ? 'cpuProbeFailureDisneyRejected' : 'cpuProbeFailure';
  return 'unknown';
}
