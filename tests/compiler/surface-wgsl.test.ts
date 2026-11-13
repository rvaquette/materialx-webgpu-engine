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
import { surfaceGraphToLayered } from '../../src/compiler/surface-lower.ts';
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
  const sssGraph = (options: ResolvedInput[]) => surfaceGraph('surface', [conn('bsdf', 'BSDF', 'skin')], [
    upstream('skin', 'LamaSSS', 'BSDF', [
      value('sssRadius', 'color3', '1,2,3'), ...options,
    ]),
  ]);

  it.each([0, 1, 2, 3])('carries Lama SSS transport %s consistently to CPU and GPU', (mode) => {
    const graph = sssGraph([value('sssMode', 'integer', String(mode)), value('albedoInversionMethod', 'integer', '1')]);
    const closure = surfaceGraphToLayered(resolveSurface(graph)!, graph);
    expect(closure.lobes[0]?.subsurfaceTransport).toBe(mode);
    expect(emit(graph).code).toContain(`${mode}.0, (`);
    if (mode >= 2) expect(emit(graph).code).not.toContain('c.hasInterior = select(');
  });
  it('lowers all documented equivalent SSS controls without dropping them', () => {
    const graph = sssGraph([
      value('sssMode', 'integer', '0'), value('albedoInversionMethod', 'integer', '0'),
      value('sssBleed', 'float', '0.5'), value('sssFollowTopology', 'float', '0.75'),
      value('sssSubset', 'string', 'skin'), value('sssContinuationRays', 'integer', '1'), value('mode', 'integer', '2'),
    ]);
    const closure = surfaceGraphToLayered(resolveSurface(graph)!, graph);
    expect(closure.lobes[0]).toMatchObject({ subsurfaceTransport: 0, subsurfaceInversion: 0,
      subsurfaceBleed: 0.5, subsurfaceFollowTopology: 0.75, subsurfaceContinuation: true, subsurfaceMode: 2 });
    expect(closure.lobes[0]?.subsurfaceSubset).toBeGreaterThan(0);
    const module = emit(graph);
    expect(module.code).toContain('mx_lama_controls_alpha(');
    expect(module.code).toContain('mx_lama_controls_sigma_t(');
  });

  it('uses stable exact group keys and rejects connected subset labels', () => {
    const subsetKey = (label: string) => {
      const graph = sssGraph([value('sssSubset', 'string', label)]);
      return surfaceGraphToLayered(resolveSurface(graph)!, graph).lobes[0]!.subsurfaceSubset!;
    };
    expect(subsetKey('')).toBe(0);
    const skin = subsetKey('skin');
    expect(subsetKey('skin')).toBe(skin);
    expect(subsetKey('other')).not.toBe(skin);
    expect(Math.fround(skin)).toBe(skin);
    const graph = sssGraph([conn('sssSubset', 'string', 'label')]);
    expect(() => emit(graph)).toThrow(/dynamic sssSubset/);
    expect(() => surfaceGraphToLayered(resolveSurface(graph)!, graph)).toThrow(/dynamic sssSubset/);
  });

  it.each(['LamaDielectric', 'LamaSheen'])('composes %s above spatial Burley in both CPU and WGSL', (category) => {
    const graph = sssGraph([value('sssMode', 'integer', '2'), value('albedoInversionMethod', 'integer', '1')]);
    graph.nodes.set('top', upstream('top', category, 'BSDF', [
      value('fresnelMode', 'integer', '1'), value('IOR', 'float', '1.5'), value('roughness', 'float', '0.2'),
    ]));
    graph.nodes.set('layer', upstream('layer', 'LamaLayer', 'BSDF', [
      conn('materialTop', 'BSDF', 'top'), conn('materialBase', 'BSDF', 'skin'), value('topMix', 'float', '0.6'),
    ]));
    graph.nodes.get('SR')!.inputs = [conn('bsdf', 'BSDF', 'layer')];
    const module = emit(graph);
    const closure = surfaceGraphToLayered(resolveSurface(graph)!, graph);
    expect(closure.lobes.find(lobe => lobe.kind === 'subsurface')?.subsurfaceTransport).toBe(2);
    if (category === 'LamaDielectric') {
      expect(module.features?.coat).toBe(true);
      expect(closure.coat?.weight).toBeCloseTo(0.6);
    } else {
      expect(module.features?.lobeKinds).toContain(6);
      expect(closure.sheen?.weight).toBeCloseTo(0.6);
    }
  });

  it('ignores Davis-only Bleed for other RenderMan SSS modes', () => {
    const graph = sssGraph([value('sssMode', 'integer', '1'), value('sssBleed', 'float', '0.8')]);
    expect(surfaceGraphToLayered(resolveSurface(graph)!, graph).lobes[0]).toMatchObject({ subsurfaceTransport: 1, subsurfaceBleed: 0 });
    expect(emit(graph).code).toBe(emit(sssGraph([value('sssMode', 'integer', '1'), value('sssBleed', 'float', '0')])).code);
  });

  it('accepts explicit reflection with direct illumination for exponential SSS', () => {
    const graph = sssGraph([value('sssMode', 'integer', '1'), value('albedoInversionMethod', 'integer', '1'),
      value('mode', 'integer', '2')]);
    expect(emit(graph).code).toContain('mx_lama_sss_medium(');
    expect(surfaceGraphToLayered(resolveSurface(graph)!, graph).lobes[0]?.subsurfaceTransport).toBe(1);
  });

  it('accepts dielectric interfaces and anisotropy for documented Burley equivalents', () => {
    const graph = sssGraph([value('sssMode', 'integer', '2'), value('albedoInversionMethod', 'integer', '0'),
      value('sssIOR', 'float', '1.5'), value('sssAnisotropy', 'float', '0.35')]);
    const closure = surfaceGraphToLayered(resolveSurface(graph)!, graph);
    expect(closure.lobes[0]).toMatchObject({ subsurfaceTransport: 2, ior: 1.5, anisotropy: 0.35 });
    expect(emit(graph).code).toContain('mx_fresnel_dielectric');
  });

  it.each([
    ['sssMode', 'integer', '4'], ['albedoInversionMethod', 'integer', '2'],
    ['sssBleed', 'float', '1.5'], ['sssFollowTopology', 'float', '1.5'],
    ['sssSubset', 'string', 'skin*'], ['sssContinuationRays', 'integer', '2'], ['mode', 'integer', '3'],
  ])('rejects unsupported Lama %s rather than substituting another model', (name, type, raw) => {
    const options = [value('sssMode', 'integer', '1'), value('albedoInversionMethod', 'integer', '1')]
      .filter(option => option.name !== name);
    const graph = sssGraph([...options, value(name, type, raw)]);
    expect(() => emit(graph)).toThrow(/unsupported/);
    expect(() => surfaceGraphToLayered(resolveSurface(graph)!, graph)).toThrow(/unsupported/);
  });

  it('lowers connected Lama BSDF parameters through the normal texture/IR path', () => {
    const graph = surfaceGraph('LamaDiffuse', [
      conn('color', 'color3', 'albedo'), value('roughness', 'float', '0.35'),
    ], [
      upstream('albedo', 'image', 'color3', [value('file', 'filename', 'lama-albedo.png')]),
    ]);
    graph.nodes.get('SR')!.nodeDef = {
      name: 'ND_lama_diffuse', nodeString: 'LamaDiffuse', type: 'BSDF',
      implementation: { kind: 'nodegraph', name: 'NG_lama_diffuse' },
      inputs: [
        { name: 'color', type: 'color3', value: '0.18, 0.18, 0.18' },
        { name: 'roughness', type: 'float', value: '0.0' },
        { name: 'normal', type: 'vector3', geomprop: 'Nworld' },
      ],
    };
    const module = emit(graph);
    expect(module.textures).toHaveLength(1);
    expect(module.samplers).toHaveLength(1);
    expect(module.code).toContain('textureSample(');
    expect(module.code).toContain('MxBsdfLobe(MX_LOBE_OREN_NAYAR_DIFFUSE');
    expect(module.code).toMatch(/MxBsdfLobe\(MX_LOBE_OREN_NAYAR_DIFFUSE, 1\.0, e\d+,/);
  });

  it.each([
    ['LamaTranslucent', 'color', 'color3', 2],
    ['LamaTranslucent', 'roughness', 'float', 2],
    ['LamaConductor', 'reflectivity', 'color3', 4],
    ['LamaDielectric', 'reflectionTint', 'color3', 3],
    ['LamaGeneralizedSchlick', 'reflectivity', 'color3', 5],
    ['LamaSheen', 'color', 'color3', 6],
    ['LamaSheen', 'roughness', 'float', 6],
    ['LamaSSS', 'color', 'color3', 7],
    ['LamaIridescence', 'relativeFilmThickness', 'float', 3],
  ] as const)('keeps connected %s inputs dynamic', (nodeString, inputName, inputType, lobeKind) => {
    const graph = surfaceGraph(nodeString, [conn(inputName, inputType, 'parameter')], [
      upstream('parameter', 'image', inputType, [value('file', 'filename', 'lama-parameter.png')]),
    ]);
    graph.nodes.get('SR')!.nodeDef = {
      name: `ND_${nodeString}`, nodeString, type: 'BSDF',
      implementation: { kind: 'nodegraph', name: `NG_${nodeString}` },
      inputs: [{ name: inputName, type: inputType, value: inputType === 'float' ? '0.5' : '1, 1, 1' }],
    };
    const module = emit(graph);
    expect(module.textures).toHaveLength(1);
    expect(module.samplers).toHaveLength(1);
    expect(module.code).toContain('textureSample(');
    expect(module.features?.lobeKinds).toContain(lobeKind);
  });

  it('pairs LamaGeneralizedSchlick with the dielectric interface and warns on unsupported controls', () => {
    const diags: Diagnostic[] = [];
    const graph = surfaceGraph('surface', [conn('bsdf', 'BSDF', 'schlick')], [
      upstream('schlick', 'LamaGeneralizedSchlick', 'BSDF', [
        value('fresnelMode', 'integer', '1'), value('IOR', 'vector3', '1.5, 1.5, 1.5'), value('exteriorIOR', 'float', '1.33'),
        value('absorptionColor', 'color3', '0.5, 0.7, 0.9'), value('tailMix', 'float', '0.2'),
        value('energyCompensation', 'float', '1'),
      ]),
    ]);
    const module = emit(graph, (d) => diags.push(d));
    const lobes = module.code.match(/c\.lobes\[\d+\] = MxBsdfLobe\([^\n]*/g) ?? [];
    expect(lobes.filter(line => line.includes('MX_LOBE_GENERALIZED_SCHLICK'))).toHaveLength(2);
    expect(lobes.filter(line => line.includes('MX_LOBE_DIELECTRIC_TRANSMISSION'))).toHaveLength(2);
    expect(lobes.every(line => line.includes(', -1.0, '))).toBe(true);
    expect(module.code).toContain('1.33');
    expect(module.code).toContain('-log(clamp(');
    expect(module.features?.transmission ?? true).toBe(true);
    expect(diags.some(d => d.level === 'warning' && d.message.includes("LamaGeneralizedSchlick 'energyCompensation'"))).toBe(true);
  });

  it('lowers LamaMix recursively while preserving connected child textures', () => {
    const graph = surfaceGraph('surface', [conn('bsdf', 'BSDF', 'mix')], [
      upstream('mix', 'LamaMix', 'BSDF', [
        conn('material1', 'BSDF', 'diffuseA'), conn('material2', 'BSDF', 'diffuseB'), value('mix', 'float', '0.25'),
      ]),
      upstream('diffuseA', 'LamaDiffuse', 'BSDF', [
        conn('color', 'color3', 'albedo'), value('roughness', 'float', '0.2'),
      ]),
      upstream('diffuseB', 'LamaDiffuse', 'BSDF', [
        value('color', 'color3', '0.1, 0.2, 0.3'), value('roughness', 'float', '0.4'),
      ]),
      upstream('albedo', 'image', 'color3', [value('file', 'filename', 'lama-mix-albedo.png')]),
    ]);
    const module = emit(graph);
    expect(module.textures).toHaveLength(1);
    expect(module.code.match(/c\.lobes\[\d+\] = MxBsdfLobe\(MX_LOBE_OREN_NAYAR_DIFFUSE/g)).toHaveLength(2);
    expect(module.code).toContain('textureSample(');
    expect(module.code).toContain('0.25');
    expect(module.code).toContain('(1.0 - clamp(');
  });

  it('lowers LamaLayer with a dielectric top as a coat over its base closure', () => {
    const graph = surfaceGraph('surface', [conn('bsdf', 'BSDF', 'layer')], [
      upstream('layer', 'LamaLayer', 'BSDF', [
        conn('materialTop', 'BSDF', 'glass'), conn('materialBase', 'BSDF', 'base'), value('topMix', 'float', '0.6'),
      ]),
      upstream('glass', 'LamaDielectric', 'BSDF', [
        value('fresnelMode', 'integer', '1'), value('IOR', 'float', '1.5'), value('roughness', 'float', '0.08'),
      ]),
      upstream('base', 'LamaDiffuse', 'BSDF', [value('color', 'color3', '0.3, 0.2, 0.1')]),
    ]);
    const module = emit(graph);
    expect(module.code).toContain('c.coat = MxCoatLayer(');
    expect(module.code).toContain('c.lobes[0] = MxBsdfLobe(MX_LOBE_OREN_NAYAR_DIFFUSE');
    expect(module.code).not.toContain('c.lobes[2] =');
    expect(module.features?.coat).toBe(true);
  });

  it('emits the selected LamaLayer coating mode and top-medium absorption', () => {
    const graph = surfaceGraph('surface', [conn('bsdf', 'BSDF', 'layer')], [
      upstream('layer', 'LamaLayer', 'BSDF', [
        conn('materialTop', 'BSDF', 'glass'), conn('materialBase', 'BSDF', 'base'), value('topMix', 'float', '1'),
      ]),
      upstream('glass', 'LamaDielectric', 'BSDF', [
        value('fresnelMode', 'integer', '1'), value('IOR', 'float', '1.5'), value('roughness', 'float', '0.2'),
        value('absorptionColor', 'color3', '0.8, 0.6, 0.4'), value('absorptionRadius', 'float', '2'),
      ]),
      upstream('base', 'LamaDiffuse', 'BSDF', [value('color', 'color3', '0.3, 0.2, 0.1')]),
    ]);
    graph.nodes.get('layer')!.lamaLayer = { mode: 'rough_coating', topThickness: 2 };
    const module = emit(graph);
    const closure = surfaceGraphToLayered(resolveSurface(graph)!, graph);
    expect(closure.coat).toMatchObject({ mode: 'rough_coating', topThickness: 2 });
    expect(closure.coat?.absorption?.[0]).toBeCloseTo(-Math.log(0.8) / 2, 6);
    expect(closure.coat?.absorption?.[1]).toBeCloseTo(-Math.log(0.6) / 2, 6);
    expect(closure.coat?.absorption?.[2]).toBeCloseTo(-Math.log(0.4) / 2, 6);
    expect(module.code).toContain('MxCoatLayer(');
    expect(module.code).toContain(', 2u, 2.0, select(vec3f(0.0),');
  });

  it('selects LamaSurface front/back closures and applies its presence mask', () => {
    const graph = surfaceGraph('surface', [conn('bsdf', 'BSDF', 'front')], [
      upstream('front', 'LamaDiffuse', 'BSDF', [value('color', 'color3', '0.8, 0.1, 0.1')]),
      upstream('back', 'LamaSheen', 'BSDF', [value('color', 'color3', '0.1, 0.2, 0.8')]),
    ]);
    graph.lamaSurface = {
      presence: { name: 'presence', type: 'float', source: { kind: 'value', value: '0.35', type: 'float' }, provenance: { namePath: '/mat/presence' } },
      backNodeId: 'back',
    };
    const module = emit(graph);
    expect(module.code).toContain('var cFront: LayeredClosure;');
    expect(module.code).toContain('var cBack: LayeredClosure;');
    expect(module.code).toContain('dot(vary.normal, vary.viewDir) >= 0.0');
    expect(module.code).toContain('cFront.opacity = clamp(');
    expect(module.code).toContain('cBack.opacity = clamp(');
    expect(module.features?.lobeKinds).toContain(0);
    expect(module.features?.lobeKinds).toContain(6);
    expect(module.features?.opaque).toBe(false);
  });

  it('emits interior medium coefficients for Lama dielectric and SSS closures', () => {
    const dielectricGraph = surfaceGraph('surface', [conn('bsdf', 'BSDF', 'glass')], [
      upstream('glass', 'LamaDielectric', 'BSDF', [
        value('absorptionColor', 'color3', '0.5, 0.8, 1'), value('absorptionRadius', 'float', '2'),
        value('scatterColor', 'color3', '0.1, 0.2, 0.3'), value('scatterAnisotropy', 'float', '0.4'),
      ]),
    ]);
    const dielectric = emit(dielectricGraph);
    expect(dielectric.code).toContain('fn mx_lama_sss_medium(');
    expect(dielectric.code).toContain('c.hasInterior = select(0u, 1u,');
    expect(dielectric.code).toContain('c.interiorSigmaA =');
    expect(dielectric.code).toContain('c.interiorSigmaS =');
    expect(dielectric.code).toContain('c.interiorG = clamp(');
    expect(dielectric.code).toContain('= 0.4;');

    const sssGraph = surfaceGraph('surface', [conn('bsdf', 'BSDF', 'skin')], [
      upstream('skin', 'LamaSSS', 'BSDF', [
        value('sssMode', 'integer', '1'), value('albedoInversionMethod', 'integer', '1'),
        value('color', 'color3', '0.7, 0.3, 0.2'), value('sssRadius', 'color3', '2, 1, 0.5'),
        value('sssScale', 'float', '3'), value('sssUnitLength', 'float', '0.01'),
      ]),
    ]);
    const sss = emit(sssGraph);
    expect(sss.code).toContain('mx_lama_sss_medium(');
    expect(sss.code).toContain('c.hasInterior = select(0u, 1u, any(');

    const zeroRadiusGraph = surfaceGraph('LamaSSS', [
      value('color', 'color3', '0.7, 0.3, 0.2'), value('sssRadius', 'color3', '0, 0, 0'),
    ]);
    const zeroRadius = emit(zeroRadiusGraph);
    expect(zeroRadius.code).toContain('c.hasInterior = select(0u, 1u, any(');
  });

  it('uses Lama anisotropyDirection to rotate the local tangent frame', () => {
    const graph = surfaceGraph('surface', [conn('bsdf', 'BSDF', 'metal')], [
      upstream('metal', 'LamaConductor', 'BSDF', [
        value('anisotropy', 'float', '0.6'), value('anisotropyDirection', 'vector3', '0, 1, 0'),
      ]),
    ]);
    graph.nodes.get('metal')!.nodeDef = {
      name: 'ND_lama_conductor', nodeString: 'LamaConductor', type: 'BSDF',
      implementation: { kind: 'nodegraph', name: 'IMPL_lama_conductor' },
      inputs: [
        { name: 'anisotropy', type: 'float', value: '0.0' },
        { name: 'anisotropyDirection', type: 'vector3', geomprop: 'Tworld' },
        { name: 'anisotropyRotation', type: 'float', value: '0.0' },
        { name: 'normal', type: 'vector3', geomprop: 'Nworld' },
      ],
    };
    const module = emit(graph);
    expect(module.code).toContain('c.hasShadingTangent = 1u;');
    expect(module.code).toContain('c.shadingTangent = vary.tangent;');
    expect(module.code).toContain('atan2(');
  });

  it('emits conductor controls authored beyond a MaterialX nodedef', () => {
    const graph = surfaceGraph('surface', [conn('bsdf', 'BSDF', 'metal')], [
      upstream('metal', 'LamaConductor', 'BSDF', [
        value('tailMix', 'float', '0.3'), value('tailLength', 'float', '0.6'),
        value('exteriorIOR', 'float', '1.33'), value('energyCompensation', 'float', '1'),
        value('anisotropy', 'float', '-0.7'),
      ]),
    ]);
    graph.nodes.get('metal')!.nodeDef = {
      name: 'ND_lama_conductor', nodeString: 'LamaConductor', type: 'BSDF',
      implementation: { kind: 'nodegraph', name: 'IMPL_lama_conductor' },
      inputs: [{ name: 'roughness', type: 'float', value: '0.2' }],
    };
    const module = emit(graph);
    expect(module.code).toContain('c.lobeCount = 2u;');
    expect(module.code).toContain('min(abs(');
    expect(module.code).toContain('select(0.0, 0.25,');
    expect(module.code).toContain('= 1.33;');
    expect(module.code).toContain('mx_conductor_average_albedo');
  });

  it('emits a connected LamaDiffuse as a layered Oren-Nayar lobe', () => {
    const graph = surfaceGraph('surface', [conn('bsdf', 'BSDF', 'diffuse')], [
      upstream('diffuse', 'LamaDiffuse', 'BSDF', [
        value('color', 'color3', '0.2, 0.3, 0.4'),
        value('roughness', 'float', '0.6'),
      ]),
    ]);
    const module = emit(graph);
    expect(module.family).toBe('surface');
    expect(module.features?.lobeKinds).toContain(0);
    expect(module.code).toContain('MX_LOBE_OREN_NAYAR_DIFFUSE');
    expect(module.code).toContain('vec3f(0.2, 0.3, 0.4)');
    expect(module.code).toContain('0.6');
  });

  it('emits LamaSheen and LamaEmission on the generic surface terminal', () => {
    const graph = surfaceGraph('surface', [
      conn('bsdf', 'BSDF', 'sheen'), conn('edf', 'EDF', 'emission'),
    ], [
      upstream('sheen', 'LamaSheen', 'BSDF', [
        value('color', 'color3', '0.7, 0.8, 0.9'), value('roughness', 'float', '0.4'),
      ]),
      upstream('emission', 'LamaEmission', 'EDF', [value('color', 'color3', '2, 1, 0.5')]),
    ]);
    const module = emit(graph);
    expect(module.features?.lobeKinds).toContain(6);
    expect(module.code).toContain('vec3f(0.7, 0.8, 0.9)');
    expect(module.code).toContain('pow(0.1 + 0.9 * clamp(');
    expect(module.code).toContain('c.hasEmission = 1u;');
    expect(module.code).toContain('vec3f(2.0, 1.0, 0.5)');
  });

  it('keeps both LamaSheen image inputs connected through roughness remapping', () => {
    const graph = surfaceGraph('surface', [conn('bsdf', 'BSDF', 'sheen')], [
      upstream('sheen', 'LamaSheen', 'BSDF', [
        conn('color', 'color3', 'colorMap'), conn('roughness', 'float', 'roughnessMap'),
      ]),
      upstream('colorMap', 'image', 'color3', [value('file', 'filename', 'sheen-color.png')]),
      upstream('roughnessMap', 'image', 'float', [value('file', 'filename', 'sheen-roughness.png')]),
    ]);
    const module = emit(graph);
    expect(module.textures).toHaveLength(2);
    expect(module.code).toMatch(/MxBsdfLobe\(MX_LOBE_SHEEN, 1\.0, e\d+, e\d+, pow\(0\.1 \+ 0\.9 \* clamp\(e\d+, 0\.0, 1\.0\), 2\.0\)/);
    expect(module.code).toContain('textureSample(');
  });

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
    expect(helper).toContain('l.weight > 0.0 && l.kind == MX_LOBE_DIELECTRIC_TRANSMISSION && l.thin <= 0.0');
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

  it('compiles LamaIridescence Target Hue as a live thin-film color input', () => {
    const graph = surfaceGraph('surface', [conn('bsdf', 'BSDF', 'iridescence')], [
      upstream('iridescence', 'LamaIridescence', 'BSDF', [
        value('targetHue', 'color3', '0.1, 0.8, 0.4'),
        value('incidentAngleScale', 'float', '2'),
        value('incidentAngleOffset', 'float', '-15'),
      ]),
    ]);
    const module = emit(graph);
    expect(module.code).toContain('mx_rotate_rgb_hue');
    expect(module.code).toContain('mx_thin_film_fresnel');
    expect(module.code).toContain('MxThinFilmLayer(');
    expect(module.code).toContain('MX_LOBE_DIELECTRIC_TRANSMISSION');
    expect(module.code).toContain('mx_transmission_thin_film_eval');
    expect(module.code).toContain('vec3f(0.1, 0.8, 0.4)');
    expect(module.features?.thinFilm).toBe(true);
    expect(module.code).toContain('mx_remap_thin_film_cosine(cosVH, film.incidentAngleScale, film.incidentAngleOffset)');
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

  it.each([false, true])('declares Lama presence expressions independently (textured=%s)', (textured) => {
    const graph = surfaceGraph('surface', [conn('bsdf', 'BSDF', 'diffuse')], [
      upstream('diffuse', 'LamaDiffuse', 'BSDF', [value('color', 'color3', '0.7, 0.2, 0.1')]),
      image('presenceTex', 'float', 'presence.png'),
    ]);
    graph.lamaSurface = { presence: textured
      ? conn('presence', 'float', 'presenceTex')
      : value('presence', 'float', '0.35') };
    const result = variant(graph, 2);
    const code = result.opacity!.fnCode;
    const references = [...code.matchAll(/\be\d+\b/g)].map(match => match[0]);
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) expect(code).toContain(`let ${reference} =`);
    expect(code).not.toContain('MxBsdfLobe');
    expect(result.opacity!.readsVaryings).toBe(textured);
    if (textured) {
      expect(code).toContain('m2_tex_presenceTex');
      expect(code).toContain('textureSampleLevel(');
    } else {
      expect(code).toContain('0.35');
    }
  });

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
