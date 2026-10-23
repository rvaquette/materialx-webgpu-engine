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
import { emitLayeredSurface } from '../../src/compiler/surface-wgsl.ts';
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
        value('coat', 'float', '0.4'),
        value('sheen', 'float', '0.3'),
        value('thin_film_thickness', 'float', '250'),
        value('emission', 'float', '2'),
      ]),
    );
    expect(mod.code).toContain('c.lobeCount = 5u;');
    expect(mod.code).toContain('c.lobes[0] = MxBsdfLobe(MX_LOBE_CONDUCTOR,');
    expect(mod.code).toContain('c.lobes[3] = MxBsdfLobe(MX_LOBE_BURLEY_DIFFUSE,');
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

  it('flows a textured color input into a lobe field as a node sub-graph', () => {
    const mod = emit(
      surfaceGraph(
        'standard_surface',
        [conn('base_color', 'color3', 'tex')],
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
    expect(mod.code).toContain('clamp(vec3f(5.0, -1.0, 0.5), vec3f(0.0), vec3f(1.0))');
    expect(mod.code).toContain('c.emission = (vec3f(10.0, 2.0, 0.5) * 0.3);');
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

  it('dispatches per family (UsdPreviewSurface has three base lobes)', () => {
    const mod = emit(surfaceGraph('UsdPreviewSurface', [value('diffuseColor', 'color3', '0.2, 0.2, 0.2')]));
    expect(mod.family).toBe('UsdPreviewSurface');
    expect(mod.code).toContain('c.lobeCount = 3u;');
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
