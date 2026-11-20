import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fromXml, runScript, ScriptError, ScriptLibrary, SCRIPT_LIBRARY_FILES, toScript, toXml,
} from '../../src/materialx/script-api.ts';

const LIBRARY = ScriptLibrary.fromXml([`<?xml version="1.0"?>
<materialx version="1.39">
  <nodedef name="ND_image_color3" node="image">
    <input name="file" type="filename" value="" />
    <input name="default" type="color3" value="0, 0, 0" />
    <input name="filtertype" type="string" value="linear" enum="closest,linear,cubic" />
    <output name="out" type="color3" />
  </nodedef>
  <nodedef name="ND_mix_float" node="mix">
    <input name="fg" type="float" value="0" />
    <input name="bg" type="float" value="0" />
    <input name="mix" type="float" value="0" uisoftmin="0" uisoftmax="1" />
    <output name="out" type="float" />
  </nodedef>
  <nodedef name="ND_mix_color3_color3" node="mix">
    <input name="fg" type="color3" value="0, 0, 0" />
    <input name="bg" type="color3" value="0, 0, 0" />
    <input name="mix" type="color3" value="0, 0, 0" />
    <output name="out" type="color3" />
  </nodedef>
  <nodedef name="ND_mix_color3" node="mix">
    <input name="fg" type="color3" value="0, 0, 0" />
    <input name="bg" type="color3" value="0, 0, 0" />
    <input name="mix" type="float" value="0" />
    <output name="out" type="color3" />
  </nodedef>
  <nodedef name="ND_noise3d_float" node="noise3d">
    <input name="amplitude" type="float" value="1" />
    <input name="octaves" type="integer" value="3" />
    <output name="out" type="float" />
  </nodedef>
  <nodedef name="ND_separate3_color3" node="separate3">
    <input name="in" type="color3" value="0, 0, 0" />
    <output name="outr" type="float" />
    <output name="outg" type="float" />
    <output name="outb" type="float" />
  </nodedef>
  <nodedef name="ND_standard_surface_surfaceshader_100" node="standard_surface" version="1.0.0">
    <input name="base" type="float" value="1" />
    <input name="base_color" type="color3" value="0.8, 0.8, 0.8" />
    <output name="out" type="surfaceshader" />
  </nodedef>
  <nodedef name="ND_standard_surface_surfaceshader" node="standard_surface" version="1.0.1" isdefaultversion="true"
           inherit="ND_standard_surface_surfaceshader_100">
    <input name="thin_walled" type="boolean" value="false" />
    <output name="out" type="surfaceshader" />
  </nodedef>
  <nodedef name="ND_surfacematerial" node="surfacematerial">
    <input name="surfaceshader" type="surfaceshader" value="" />
    <output name="out" type="material" />
  </nodedef>
</materialx>`]);

describe('material script library', () => {
  it('resolves nodes and their ports from NodeDefs', () => {
    expect(LIBRARY.classNames).toEqual(['Image', 'Mix', 'Noise3d', 'Separate3', 'StandardSurface', 'Surfacematerial']);
    const surface = LIBRARY.resolve('standard_surface');
    expect(surface.name).toBe('ND_standard_surface_surfaceshader');
    expect(surface.inputs.map(input => input.name)).toEqual(['base', 'base_color', 'thin_walled']);
    expect(LIBRARY.variants('standard_surface')).toHaveLength(1);
    expect(LIBRARY.resolve('image').inputs.find(input => input.name === 'filtertype')?.enum).toEqual(['closest', 'linear', 'cubic']);
    expect(LIBRARY.resolve('mix', 'float').inputs.find(input => input.name === 'mix')).toMatchObject({ min: 0, max: 1 });
  });

  it('prefers the color3 variant with the plainest NodeDef name', () => {
    expect(LIBRARY.resolve('mix').name).toBe('ND_mix_color3');
    expect(LIBRARY.resolve('mix', 'float').name).toBe('ND_mix_float');
    expect(LIBRARY.resolve('mix', 'ND_mix_color3_color3').name).toBe('ND_mix_color3_color3');
    expect(() => LIBRARY.resolve('mix', 'vector4')).toThrow(/Types: color3, float/);
  });
});

describe('runScript', () => {
  it('names nodes after variables and records values and connections', () => {
    const graph = runScript(`
      img = new Image();
      img.file = "wood.jpg";
      const s = new StandardSurface();
      s.base_color = img.out;
      s.base = 0.5;
      s.thin_walled = true;
    `, LIBRARY);
    expect(graph.nodes.map(node => [node.name, node.def.name])).toEqual([
      ['img', 'ND_image_color3'], ['s', 'ND_standard_surface_surfaceshader'],
    ]);
    const [img, s] = graph.nodes;
    expect(img!.inputs.get('file')).toEqual({ value: 'wood.jpg' });
    expect(s!.inputs.get('base_color')).toEqual({ node: img, output: 'out' });
    expect(s!.inputs.get('thin_walled')).toEqual({ value: true });
  });

  it('broadcasts numbers to colors and accepts a node as its single output', () => {
    const graph = runScript('m = new Mix(); m.fg = 0.25; n = new Mix(); n.bg = m;', LIBRARY);
    expect(graph.nodes[0]!.inputs.get('fg')).toEqual({ value: [0.25, 0.25, 0.25] });
    expect(graph.nodes[1]!.inputs.get('bg')).toEqual({ node: graph.nodes[0], output: 'out' });
  });

  it('selects variants and named outputs of multi-output nodes', () => {
    const graph = runScript('c = new Separate3(); m = new Mix("float"); m.fg = c.outg;', LIBRARY);
    expect(graph.nodes[1]!.inputs.get('fg')).toEqual({ node: graph.nodes[0], output: 'outg' });
  });

  it('gives unique names to unnamed and reassigned nodes', () => {
    const graph = runScript('n = new Image(); n = new Image(); new Noise3d();', LIBRARY);
    expect(graph.nodes.map(node => node.name)).toEqual(['n', 'n_2', 'noise3d']);
  });

  it('reports unknown nodes, inputs and type mismatches', () => {
    expect(() => runScript('x = new Bogus();', LIBRARY)).toThrow(/Bogus is not defined/);
    expect(() => runScript('i = new Image(); i.fil = "a";', LIBRARY)).toThrow(/no input "fil".*Inputs: file, default/);
    expect(() => runScript('n = new Noise3d(); n.octaves = 1.5;', LIBRARY)).toThrow(/n\.octaves expects a integer/);
    expect(() => runScript('n = new Noise3d(); s = new StandardSurface(); s.base_color = n.out;', LIBRARY))
      .toThrow(/s\.base_color expects color3 but n\.out is float/);
    expect(() => runScript('s = new StandardSurface(); s.out = 1;', LIBRARY)).toThrow(/output and cannot be assigned/);
    expect(() => runScript('s = new StandardSurface(', LIBRARY)).toThrow(/Syntax error/);
  });

  it('keeps JavaScript available for computed values', () => {
    const graph = runScript('m = new Mix("float"); for (let i = 0; i < 3; i++) m.mix = Math.min(1, i * 0.4);', LIBRARY);
    expect(graph.nodes[0]!.inputs.get('mix')).toEqual({ value: 0.8 });
  });

  it('throws ScriptError instances', () => {
    expect(() => runScript('undefinedVariable.x = 1;', LIBRARY)).toThrow(ScriptError);
  });
});

describe('XML conversion', () => {
  const SCRIPT = `img = new Image();
img.file = "wood.jpg";

c = new Separate3();
c.in = img.out;

m = new Mix("float");
m.fg = c.outr;
m.mix = 0.5;

s = new StandardSurface();
s.base_color = img.out;
s.base = m.out;
s.thin_walled = true;
`;

  it('writes MaterialX with an automatic surfacematerial', () => {
    const xml = toXml(runScript(SCRIPT, LIBRARY), LIBRARY, { filePrefix: 'http://host/textures/' });
    expect(xml).toContain('<materialx version="1.39" fileprefix="http://host/textures/">');
    expect(xml).toContain('<image name="img" type="color3">');
    expect(xml).toContain('<input name="file" type="filename" value="wood.jpg" />');
    expect(xml).toContain('<separate3 name="c" type="multioutput" nodedef="ND_separate3_color3">');
    expect(xml).toContain('<mix name="m" type="float" nodedef="ND_mix_float">');
    expect(xml).toContain('<input name="fg" type="float" nodename="c" output="outr" />');
    expect(xml).toContain('<input name="thin_walled" type="boolean" value="true" />');
    expect(xml).toContain('<surfacematerial name="material" type="material">');
    expect(xml).toContain('<input name="surfaceshader" type="surfaceshader" nodename="s" />');
  });

  it('round-trips script → XML → script', () => {
    const xml = toXml(runScript(SCRIPT, LIBRARY), LIBRARY);
    const script = toScript(fromXml(xml, LIBRARY), LIBRARY);
    expect(script).toBe(`${SCRIPT}
material = new Surfacematerial();
material.surfaceshader = s.out;
`);
    expect(toXml(runScript(script, LIBRARY), LIBRARY)).toBe(xml);
  });

  it('infers NodeDefs from node and input types and orders sources first', () => {
    const graph = fromXml(`<materialx version="1.39">
      <mix name="blend" type="color3">
        <input name="fg" type="color3" nodename="tex" />
        <input name="mix" type="color3" value="0.5, 0.5, 0.5" />
      </mix>
      <image name="tex" type="color3"><input name="file" type="filename" value="a &amp; b.png" /></image>
    </materialx>`, LIBRARY);
    expect(graph.nodes[0]!.def.name).toBe('ND_mix_color3_color3');
    expect(toScript(graph, LIBRARY)).toBe(`tex = new Image();
tex.file = "a & b.png";

blend = new Mix("ND_mix_color3_color3");
blend.fg = tex.out;
blend.mix = [0.5, 0.5, 0.5];
`);
  });

  it('renames nodes that collide with JavaScript keywords or node classes', () => {
    const graph = fromXml('<materialx><image name="new" type="color3" /><image name="Mix" type="color3" /></materialx>', LIBRARY);
    expect(toScript(graph, LIBRARY)).toBe('new_ = new Image();\n\nMix_ = new Image();\n');
  });

  it('rejects unsupported documents', () => {
    expect(() => fromXml('<foo />', LIBRARY)).toThrow(/<materialx> root is missing/);
    expect(() => fromXml('<materialx><nodegraph name="g" /></materialx>', LIBRARY)).toThrow(/nodegraph> is not supported/);
    expect(() => fromXml('<materialx><image name="i" type="color3"><input name="x" type="float" value="1" /></image></materialx>', LIBRARY))
      .toThrow(/No image NodeDef matches/);
    expect(() => fromXml('<materialx><mix name="m" type="float"><input name="fg" type="float" nodename="nope" /></mix></materialx>', LIBRARY))
      .toThrow(/unknown node "nope"/);
  });
});

const LIBRARY_ROOT = process.env['MX_LIB_ROOT'] ?? 'D:/WebGL2/MaterialX/MaterialX-rva/libraries';

describe.skipIf(!existsSync(join(LIBRARY_ROOT, 'stdlib', 'stdlib_defs.mtlx')))('installed MaterialX libraries', () => {
  it('scripts a standard_surface material from the real NodeDefs', () => {
    const library = ScriptLibrary.fromXml(SCRIPT_LIBRARY_FILES.map(file => readFileSync(join(LIBRARY_ROOT, file), 'utf8')));
    expect(library.resolve('standard_surface').inputs.length).toBeGreaterThan(30);
    expect(library.resolve('open_pbr_surface').inputs.some(input => input.name === 'base_color')).toBe(true);
    // Lower-case variables may share a node category name (pbrlib defines `surface`).
    const graph = runScript(`
      n = new Fractal3d("float");
      n.octaves = 4;
      m = new Mix();
      m.fg = [0.8, 0.2, 0.1];
      m.bg = [0.1, 0.1, 0.4];
      m.mix = n.out;
      surface = new StandardSurface();
      surface.base_color = m.out;
      surface.specular_roughness = 0.3;
    `, library);
    expect(fromXml(toXml(graph, library), library).nodes.map(node => node.def.name)).toEqual([
      'ND_fractal3d_float', 'ND_mix_color3', 'ND_standard_surface_surfaceshader', 'ND_surfacematerial',
    ]);
  });
});
