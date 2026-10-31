// T055d: emitLayeredSurface (src/compiler/surface-wgsl.ts) emits a WGSL
// LayeredClosure struct and a generated mx_surface_layered(vary) -> LayeredClosure
// fill function whose fields are assigned from the T055c lowered input IR. These
// structural tests build a ResolvedGraph as plain data, resolve + emit, and assert
// on the generated module (struct present, fields assigned, dynamic inputs flow,
// no lighting binding, diagnostic on unsupported input).

import { describe, it, expect } from 'vitest';
import type {
  ResolvedGraph,
  ResolvedInput,
  ResolvedNode,
  ResolvedValueSource,
} from '../../src/materialx/graph.ts';
import { resolveSurface } from '../../src/materialx/surface-graph.ts';
import { emitLayeredSurface, emitSurfaceVariant } from '../../src/compiler/surface-wgsl.ts';
import type { Diagnostic } from '../../src/core/diagnostics.ts';

function value(name: string, type: string, raw: string, colorSpace?: string): ResolvedInput {
  const source: ResolvedValueSource = { kind: 'value', value: raw, type };
  return colorSpace !== undefined
    ? { name, type, source, colorSpace, provenance: { namePath: `/mat/${name}` } }
    : { name, type, source, provenance: { namePath: `/mat/${name}` } };
}

function conn(name: string, type: string, nodeId: string): ResolvedInput {
  return { name, type, source: { kind: 'connection', nodeId }, provenance: { namePath: `/mat/${name}` } };
}

function upstream(id: string, category: string, type: string, inputs: ResolvedInput[]): ResolvedNode {
  return { id, category, type, inputs, provenance: { namePath: `/mat/${id}` } };
}

function surfaceGraph(category: string, surfaceInputs: ResolvedInput[], upstreamNodes: ResolvedNode[] = []): ResolvedGraph {
  const surfaceId = 'SR';
  const surface: ResolvedNode = {
    id: surfaceId,
    category,
    type: 'surfaceshader',
    inputs: surfaceInputs,
    provenance: { namePath: `/mat/${surfaceId}` },
  };
  const nodes = new Map<string, ResolvedNode>([[surfaceId, surface]]);
  for (const n of upstreamNodes) nodes.set(n.id, n);
  return {
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: surfaceId, provenance: { namePath: `/mat/${surfaceId}` } }],
    nodes,
  };
}

function emit(graph: ResolvedGraph, sink?: (d: Diagnostic) => void) {
  const resolved = resolveSurface(graph, sink ? { onDiagnostic: sink } : {});
  expect(resolved).not.toBeNull();
  return emitLayeredSurface(graph, resolved!, sink);
}

describe('emitLayeredSurface (T055d)', () => {
  it('retains fuzz for connected and editable weights even when their initial value is zero', () => {
    const graph = surfaceGraph('open_pbr_surface', [value('fuzz_weight', 'float', '0')]);
    const surface = resolveSurface(graph)!;
    expect(emitSurfaceVariant(graph, surface, 0).features?.fuzz).toBe(false);
    const inputs = new Map(surface.inputs);
    inputs.set('fuzz_weight', { ...inputs.get('fuzz_weight')!, parameter: 'editableFuzz' });
    const editable = emitSurfaceVariant(graph, { ...surface, inputs }, 0);
    expect(editable.features?.fuzz).toBe(true);
    expect(editable.fnCode).toContain('c.hasFuzz = 1u;');
    const connected = surfaceGraph('open_pbr_surface', [conn('fuzz_weight', 'float', 'weight')],
      [upstream('weight', 'constant', 'float', [value('value', 'float', '0')])]);
    expect(emitSurfaceVariant(connected, resolveSurface(connected)!, 0).features?.fuzz).toBe(true);
  });
  it.each([
    ['standard_surface', 'opacity', 'color3', '1,1,1', '0.5,1,1'],
    ['open_pbr_surface', 'geometry_opacity', 'float', '1', '0.5'],
    ['gltf_pbr', 'alpha', 'float', '1', '0.5'],
  ])('proves %s opacity only from constant, non-editable coverage', (family, name, type, opaque, alpha) => {
    const extra = family === 'gltf_pbr' ? [value('alpha_mode', 'integer', '2')] : [];
    expect(emit(surfaceGraph(family, [...extra, value(name, type, opaque)])).features?.opaque).toBe(true);
    expect(emit(surfaceGraph(family, [...extra, value(name, type, alpha)])).features?.opaque).toBe(false);
    const connected = surfaceGraph(family, [...extra, conn(name, type, 'opacity')],
      [upstream('opacity', 'constant', type, [value('value', type, opaque)])]);
    expect(emit(connected).features?.opaque).toBe(false);
    const graph = surfaceGraph(family, [...extra, value(name, type, opaque)]);
    const surface = resolveSurface(graph)!;
    const inputs = new Map(surface.inputs);
    inputs.set(name, { ...inputs.get(name)!, parameter: 'editableOpacity' });
    expect(emitSurfaceVariant(graph, { ...surface, inputs }, 0).features?.opaque).toBe(false);
  });
  it('preserves all potentially reachable lobes of an editable Disney metallic input', () => {
    const graph = surfaceGraph('disney_principled', [conn('metallic', 'float', 'metallic')],
      [upstream('metallic', 'constant', 'float', [value('value', 'float', '1')])]);
    const variant = emitSurfaceVariant(graph, resolveSurface(graph)!, 0);
    expect(variant.features?.lobeKinds).toContain(4);
    expect(variant.features?.lobeKinds).toContain(1);
    expect(variant.features?.lobeKinds).toContain(3);
    const constant = surfaceGraph('disney_principled', [value('metallic', 'float', '1')]);
    const surface = resolveSurface(constant)!;
    const inputs = new Map(surface.inputs);
    inputs.set('metallic', { ...inputs.get('metallic')!, parameter: 'editableMetallic' });
    expect(emitSurfaceVariant(constant, { ...surface, inputs }, 0).features?.lobeKinds).toContain(1);
  });
  it.each([
    ['gltf_pbr', 'dispersion', 'transmission'],
    ['standard_surface', 'transmission_dispersion', 'transmission'],
    ['open_pbr_surface', 'transmission_dispersion_scale', 'transmission_weight'],
  ])('retains connected %s dispersion in the transmission lobe', (family, name, transmission) => {
    const mod = emit(surfaceGraph(family, [conn(name, 'float', 'dispersion'), value(transmission, 'float', '1')],
      [upstream('dispersion', 'constant', 'float', [value('value', 'float', '0.35')])]));
    expect(mod.code).toContain('dispersion: f32');
    expect(mod.code).toMatch(/MxBsdfLobe\(MX_LOBE_DIELECTRIC_TRANSMISSION,[^\n]*e\d+[^\n]*\);/);
    expect(mod.code).toContain('0.35');
  });
  it('retains glTF alpha mode, alpha and connected cutoff in the opacity expression', () => {
    const mod = emit(surfaceGraph('gltf_pbr', [
      value('alpha_mode', 'integer', '1'),
      value('alpha', 'float', '0.35'),
      conn('alpha_cutoff', 'float', 'cutoff'),
    ], [upstream('cutoff', 'constant', 'float', [value('value', 'float', '0.6')])]));
    expect(mod.code).toMatch(/c\.opacity = select\(select\(clamp\(e\d+, 0\.0, 1\.0\), select\(0\.0, 1\.0, clamp\(e\d+, 0\.0, 1\.0\) >= e\d+\), e\d+ == 1\), 1\.0, e\d+ == 0\);/);
    expect(mod.code).toContain('0.35');
    expect(mod.code).toContain('0.6');
  });

  it.each([
    ['standard_surface', 'normal'],
    ['open_pbr_surface', 'geometry_normal'],
  ])('keeps the connected %s normal map in raster and path-tracer material functions', (family, normalName) => {
    const graph = surfaceGraph(family!, [conn(normalName!, 'vector3', 'normal')], [
      upstream('normal', 'normalmap', 'vector3', [conn('in', 'vector3', 'tex')]),
      upstream('tex', 'tiledimage', 'vector3', [
        value('file', 'filename', 'brick_normal.jpg'),
        value('uvtiling', 'vector2', '3, 3'),
      ]),
    ]);
    const resolved = resolveSurface(graph)!;
    const raster = emitLayeredSurface(graph, resolved);
    const pathtracer = emitSurfaceVariant(graph, resolved, 0);
    for (const code of [raster.code, pathtracer.fnCode]) {
      expect(code).toContain('c.hasShadingNormal = 1u;');
      expect(code).toMatch(/c\.shadingNormal = e\d+;/);
      expect(code).toContain('mx_normalmap(');
    }
    expect(raster.textures).toHaveLength(1);
    expect(pathtracer.textures).toHaveLength(1);
    expect(raster.code).toContain('textureSample(');
    expect(pathtracer.fnCode).toContain('textureSampleLevel(');
  });

  it('leaves unconnected geometric normals unchanged', () => {
    const mod = emit(surfaceGraph('standard_surface', []));
    expect(mod.code).not.toContain('c.hasShadingNormal = 1u;');
    expect(mod.code).not.toContain('c.shadingNormal =');
    expect(mod.textures).toHaveLength(0);
  });

  it('orients exposed opaque backfaces without reversing a solid glass interface', () => {
    const code = emit(surfaceGraph('gltf_pbr', [])).code;
    const start = code.indexOf('fn mx_closure_oriented_normal(');
    const end = code.indexOf('fn mx_closure_base_eval(', start);
    const helper = code.slice(start, end);
    expect(helper).toContain('if (dot(n, viewDir) >= 0.0) { return n; }');
    expect(helper).toContain('l.weight > 0.0 && l.kind == MX_LOBE_DIELECTRIC_TRANSMISSION && l.thin == 0.0');
    expect(helper).toContain('return -n;');
  });

  it('declares the LayeredClosure struct and the fill function', () => {
    const mod = emit(surfaceGraph('standard_surface', [value('base_color', 'color3', '0.8, 0.1, 0.1')]));
    expect(mod.entryPoint).toBe('mx_surface_layered');
    expect(mod.returnType).toBe('LayeredClosure');
    expect(mod.code).toContain('struct LayeredClosure {');
    expect(mod.code).toContain('struct MxBsdfLobe {');
    expect(mod.code).toContain('struct MxCoatLayer');
    expect(mod.code).toContain('struct MxThinFilmLayer');
    expect(mod.code).toContain('fn mx_surface_layered(vary: MxVaryings) -> LayeredClosure {');
    expect(mod.code).toContain('return c;');
  });

  it('emits the shared runtime closure library so the stack is one identical source (T056h)', () => {
    const mod = emit(surfaceGraph('standard_surface', [value('base_color', 'color3', '0.8, 0.1, 0.1')]));
    // The lobe triplets and the full-stack assembler ride in the surface module.
    expect(mod.code).toContain('fn mx_diffuse_eval(ctx: MxLobeCtx, wi: vec3f) -> MxBsdfEval');
    expect(mod.code).toContain('fn mx_closure_eval(c: LayeredClosure, wo: vec3f, wi: vec3f) -> MxBsdfEval');
    expect(mod.code).toContain('fn mx_closure_pdf(c: LayeredClosure, wo: vec3f, wi: vec3f) -> f32');
    expect(mod.code).toContain('fn mx_closure_sample(c: LayeredClosure, wo: vec3f, u: vec3f) -> MxBsdfSample');
    // The struct it operates on is emitted before the library.
    expect(mod.code.indexOf('struct LayeredClosure {')).toBeLessThan(mod.code.indexOf('fn mx_closure_eval'));
  });

  it('assigns the lobe array and every optional layer field when present', () => {
    const mod = emit(
      surfaceGraph('standard_surface', [
        value('base_color', 'color3', '0.5, 0.5, 0.5'),
        value('metalness', 'float', '0.5'),
        value('transmission', 'float', '0.2'),
        value('subsurface', 'float', '0.1'),
        value('coat', 'float', '0.4'),
        value('sheen', 'float', '0.3'),
        value('thin_film_thickness', 'float', '250'),
        value('emission', 'float', '2'),
      ]),
    );
    expect(mod.code).toContain('c.lobeCount = 6u;');
    expect(mod.code).toContain('c.lobes[0] = MxBsdfLobe(MX_LOBE_CONDUCTOR,');
    expect(mod.code).toContain('c.lobes[3] = MxBsdfLobe(MX_LOBE_BURLEY_DIFFUSE,');
    expect(mod.code).toContain('c.sheen = MxSheenLayer(');
    expect(mod.code).toContain('c.hasCoat = 1u;');
    expect(mod.code).toContain('c.coat = MxCoatLayer(');
    expect(mod.code).toContain('c.hasSheen = 1u;');
    expect(mod.code).toContain('c.hasThinFilm = 1u;');
    expect(mod.code).toContain('c.thinFilm = MxThinFilmLayer(');
    expect(mod.code).toContain('c.hasEmission = 1u;');
    expect(mod.code).toContain('c.opacity =');
  });

  it('omits optional layers that are absent', () => {
    const mod = emit(surfaceGraph('standard_surface', [value('base_color', 'color3', '0.5, 0.5, 0.5')]));
    expect(mod.code).not.toContain('c.hasCoat = 1u;');
    expect(mod.code).not.toContain('c.hasSheen = 1u;');
    expect(mod.code).not.toContain('c.hasThinFilm = 1u;');
    expect(mod.code).not.toContain('c.hasEmission = 1u;');
  });

  it('keeps OpenPBR fuzz as a top layer instead of adding it to the base lobe stack', () => {
    const mod = emit(surfaceGraph('open_pbr_surface', [
      value('base_color', 'color3', '0.02, 0.02, 0.02'),
      value('fuzz_weight', 'float', '1'),
      value('fuzz_color', 'color3', '0.4, 0.4, 0.4'),
      value('fuzz_roughness', 'float', '0.5'),
    ]));
    expect(mod.code).toContain('c.hasFuzz = 1u;');
    expect(mod.code).toContain('c.fuzz = MxFuzzLayer(');
    expect(mod.code).toContain('c.lobeCount = 2u;');
    expect(mod.code).toContain('fn mx_closure_eval_base(c: LayeredClosure, wo: vec3f, wi: vec3f) -> MxBsdfEval');
    expect(mod.code).toContain('let fuzz = mx_fuzz_eval(fuzzCtx, wi);');
    expect(mod.code).toContain('fuzz.value * fuzzW + base.value * (1.0 - coverage)');
    expect(mod.code).toContain('fuzz.pdf * coverage + base.pdf * (1.0 - coverage)');
  });

  it('flows a textured color input into a lobe field as a node sub-graph', () => {
    const mod = emit(
      surfaceGraph(
        'standard_surface',
        [conn('base_color', 'color3', 'tex'), value('metalness', 'float', '1')],
        [upstream('tex', 'image', 'color3', [value('file', 'filename', 'albedo.png', 'srgb_texture')])],
      ),
    );
    expect(mod.textures).toHaveLength(1);
    expect(mod.code).toContain('textureSample(tex_tex, samp_tex');
    // The conductor lobe colour references the lowered IR ref, not a baked constant.
    expect(mod.code).toMatch(/c\.lobes\[0\] = MxBsdfLobe\(MX_LOBE_CONDUCTOR, mx_metal, clamp\(e\d+, vec3f\(0\.0\), vec3f\(1\.0\)\),/);
  });

  it('bounds standard_surface base reflectance without clipping HDR emission', () => {
    const mod = emit(surfaceGraph('standard_surface', [
      value('base_color', 'color3', '5, -1, 0.5'),
      value('emission_color', 'color3', '10, 2, 0.5'),
      value('emission', 'float', '0.3'),
    ]));
    expect(mod.code).toMatch(/MX_LOBE_BURLEY_DIFFUSE,[^,\n]+, clamp\(e\d+, vec3f\(0\.0\), vec3f\(1\.0\)\),/);
    expect(mod.code).toMatch(/c\.emission = \(e\d+ \* e\d+\);/);
  });

  it('keeps weights dynamic when a scalar input is textured', () => {
    const mod = emit(
      surfaceGraph(
        'standard_surface',
        [conn('metalness', 'float', 'm')],
        [upstream('m', 'image', 'float', [value('file', 'filename', 'metal.png')])],
      ),
    );
    expect(mod.textures).toHaveLength(1);
    // metalness is not flattened: the weight clamps the lowered texture ref.
    expect(mod.code).toMatch(/let mx_metal = clamp\(e\d+, 0\.0, 1\.0\);/);
  });

  it('does not declare the lighting uniform (construction only)', () => {
    const mod = emit(surfaceGraph('standard_surface', [value('base_color', 'color3', '0.5, 0.5, 0.5')]));
    expect(mod.lighting).toBeUndefined();
    expect(mod.code).not.toContain('mxLighting');
  });

  it('dispatches per family (UsdPreviewSurface keeps its two non-metal base lobes)', () => {
    const mod = emit(surfaceGraph('UsdPreviewSurface', [value('diffuseColor', 'color3', '0.2, 0.2, 0.2')]));
    expect(mod.family).toBe('UsdPreviewSurface');
    expect(mod.code).toContain('c.lobeCount = 2u;');
    expect(mod.code).toContain('const MX_MAX_LOBES: u32 = 2u;');
  });

  it('routes transparent USD glass through transmission without alpha-discarding reflections', () => {
    const mod = emit(surfaceGraph('UsdPreviewSurface', [value('opacity', 'float', '0')]));
    expect(mod.features!.transmission).toBe(true);
    expect(mod.features!.lobeKinds).toContain(8);
    expect(mod.code).toContain('mx_diel * (1.0 - mx_diffuseShare)');
    expect(mod.code).toContain('select(1.0, 0.0, mx_threshold > 0.0 && mx_opacity < mx_threshold)');
    const masked = emit(surfaceGraph('UsdPreviewSurface', [
      value('opacity', 'float', '0'), value('opacityThreshold', 'float', '0.5'),
    ]));
    expect(masked.features!.transmission).toBe(false);
    expect(masked.features!.lobeKinds).not.toContain(8);
  });

  it('sizes the raster lobe array to the statically active lobes', () => {
    const mod = emit(surfaceGraph('open_pbr_surface', [value('base_color', 'color3', '0.5, 0.5, 0.5')]));
    expect(mod.code).toContain('const MX_MAX_LOBES: u32 = 2u;');
    expect(mod.code).toContain('c.lobes[0] = MxBsdfLobe(MX_LOBE_DIELECTRIC_REFLECTION,');
    expect(mod.code).toContain('c.lobes[1] = MxBsdfLobe(MX_LOBE_BURLEY_DIFFUSE,');
    expect(mod.code).not.toContain('MxBsdfLobe(MX_LOBE_CONDUCTOR,');
    const pt = emitSurfaceVariant(surfaceGraph('open_pbr_surface', []), resolveSurface(surfaceGraph('open_pbr_surface', []))!, 0);
    expect(pt.lobeCount).toBe(2);
    expect(pt.fnCode).toContain('c.lobeCount = 2u;');
  });

  it('diagnoses an unsupported upstream node and bakes a neutral constant', () => {
    const diags: Diagnostic[] = [];
    const mod = emit(
      surfaceGraph(
        'standard_surface',
        [conn('base_color', 'color3', 'n')],
        [upstream('n', 'custom_unsupported', 'color3', [value('x', 'float', '1')])],
      ),
      (d) => diags.push(d),
    );
    expect(diags.some((d) => d.level === 'warning' && d.message.includes('custom_unsupported'))).toBe(true);
    expect(mod.code).not.toContain('custom_unsupported');
    expect(mod.code).toContain('vec3f(0.0, 0.0, 0.0)');
  });
});

describe('emitSurfaceVariant opacity-only evaluator', () => {
  const image = (id: string, type: string, file: string) => upstream(id, 'image', type, [value('file', 'filename', file)]);
  const variant = (graph: ResolvedGraph, index = 0) => emitSurfaceVariant(graph, resolveSurface(graph)!, index);

  it('lowers only the textured glTF alpha and cutoff, excluding lobe inputs and their textures', () => {
    const v = variant(surfaceGraph('gltf_pbr', [
      value('alpha_mode', 'integer', '1'),
      conn('alpha', 'float', 'alphaTex'),
      value('alpha_cutoff', 'float', '0.37'),
      conn('base_color', 'color3', 'albedoTex'),
      conn('roughness', 'float', 'roughTex'),
    ], [image('alphaTex', 'float', 'alpha.png'), image('albedoTex', 'color3', 'albedo.png'), image('roughTex', 'float', 'rough.png')]), 3);
    const opacity = v.opacity!;
    expect(opacity.fnName).toBe('mx_surface_opacity_3');
    expect(opacity.fnCode.startsWith('fn mx_surface_opacity_3(vary: MxVaryings) -> f32 {')).toBe(true);
    expect(opacity.fnCode).toContain('m3_tex_alphaTex');
    expect(opacity.fnCode).toContain('0.37');
    expect(opacity.fnCode).toMatch(/return clamp\(select\(select\(clamp\(e\d+, 0\.0, 1\.0\), select\(0\.0, 1\.0, clamp\(e\d+, 0\.0, 1\.0\) >= e\d+\), e\d+ == 1\), 1\.0, e\d+ == 0\), 0\.0, 1\.0\);/);
    expect(opacity.readsVaryings).toBe(true);
    for (const excluded of ['m3_tex_albedoTex', 'm3_tex_roughTex', 'MxBsdfLobe', 'LayeredClosure', 'mx_metal']) {
      expect(opacity.fnCode).not.toContain(excluded);
      if (excluded.startsWith('m3_tex')) expect(v.fnCode).toContain(excluded);
    }
    // The opacity rule text is identical to the closure fill function's assignment.
    const rule = /return clamp\((.*), 0\.0, 1\.0\);/.exec(opacity.fnCode)![1]!;
    expect(v.fnCode).toContain(`c.opacity = ${rule};`);
  });

  it('keeps an editable opacity parameter dynamic without reading varyings', () => {
    const graph = surfaceGraph('open_pbr_surface', [value('geometry_opacity', 'float', '1'), conn('base_color', 'color3', 'albedoTex')],
      [image('albedoTex', 'color3', 'albedo.png')]);
    const surface = resolveSurface(graph)!;
    const inputs = new Map(surface.inputs);
    inputs.set('geometry_opacity', { ...inputs.get('geometry_opacity')!, parameter: 'editableOpacity' });
    const v = emitSurfaceVariant(graph, { ...surface, inputs }, 2);
    expect(v.features?.opaque).toBe(false);
    expect(v.opacity!.fnCode).toContain('u.m2_editableOpacity');
    expect(v.opacity!.fnCode).not.toContain('albedoTex');
    expect(v.opacity!.readsVaryings).toBe(false);
  });

  it('averages a textured standard_surface opacity colour', () => {
    const v = variant(surfaceGraph('standard_surface', [conn('opacity', 'color3', 'opacityTex'), conn('base_color', 'color3', 'albedoTex')],
      [image('opacityTex', 'color3', 'opacity.png'), image('albedoTex', 'color3', 'albedo.png')]));
    expect(v.opacity!.fnCode).toMatch(/return clamp\(\(\(e\d+\)\.x \+ \(e\d+\)\.y \+ \(e\d+\)\.z\) \/ 3\.0, 0\.0, 1\.0\);/);
    expect(v.opacity!.fnCode).toContain('m0_tex_opacityTex');
    expect(v.opacity!.fnCode).not.toContain('albedoTex');
  });

  it('emits only the UsdPreviewSurface threshold helpers it needs', () => {
    const v = variant(surfaceGraph('UsdPreviewSurface', [
      conn('opacity', 'float', 'opacityTex'), value('opacityThreshold', 'float', '0.5'), value('metallic', 'float', '0.25'),
    ], [image('opacityTex', 'float', 'opacity.png')]));
    const code = v.opacity!.fnCode;
    expect(code).toMatch(/let mx_opacity = clamp\(e\d+, 0\.0, 1\.0\);/);
    expect(code).toContain('let mx_threshold = ');
    expect(code).toContain('return clamp(select(1.0, 0.0, mx_threshold > 0.0 && mx_opacity < mx_threshold), 0.0, 1.0);');
    expect(code).not.toContain('mx_metal');
    expect(code).not.toContain('mx_diffuseShare');
  });

  it('short-circuits proven opaque coverage, even with a connected glTF alpha in OPAQUE mode', () => {
    const v = variant(surfaceGraph('gltf_pbr', [value('alpha_mode', 'integer', '0'), conn('alpha', 'float', 'alphaTex')],
      [image('alphaTex', 'float', 'alpha.png')]));
    expect(v.features?.opaque).toBe(true);
    expect(v.opacity!.fnCode).toBe('fn mx_surface_opacity_0(vary: MxVaryings) -> f32 {\n  return clamp(1.0, 0.0, 1.0);\n}');
    expect(v.opacity!.readsVaryings).toBe(false);
    const blend = variant(surfaceGraph('gltf_pbr', [value('alpha_mode', 'integer', '2'), value('alpha', 'float', '0.5')]));
    expect(blend.features?.opaque).toBe(false);
    expect(blend.opacity!.fnCode).toContain('0.5');
    expect(blend.opacity!.fnCode).not.toContain('return clamp(1.0, 0.0, 1.0);');
  });
});
