import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  fromResolvedGraph, fromXml, inlineIncludes, runScript, ScriptError, ScriptLibrary, SCRIPT_LIBRARY_FILES, toScript,
  toXml, transformScript, type ScriptHost,
} from '../../src/materialx/script-api.ts';
import type { ResolvedGraph, ResolvedNode } from '../../src/materialx/graph.ts';

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
    <input name="displacementshader" type="displacementshader" value="" />
    <output name="out" type="material" />
  </nodedef>
</materialx>`]);

describe('material script library', () => {
  it('resolves nodes and their ports from NodeDefs', async () => {
    expect(LIBRARY.classNames).toEqual(['Image', 'Mix', 'Noise3d', 'Separate3', 'StandardSurface', 'Surfacematerial']);
    const surface = LIBRARY.resolve('standard_surface');
    expect(surface.name).toBe('ND_standard_surface_surfaceshader');
    expect(surface.inputs.map(input => input.name)).toEqual(['base', 'base_color', 'thin_walled']);
    expect(LIBRARY.variants('standard_surface')).toHaveLength(1);
    expect(LIBRARY.resolve('image').inputs.find(input => input.name === 'filtertype')?.enum).toEqual(['closest', 'linear', 'cubic']);
    expect(LIBRARY.resolve('mix', 'float').inputs.find(input => input.name === 'mix')).toMatchObject({ min: 0, max: 1 });
  });

  it('prefers the color3 variant with the plainest NodeDef name', async () => {
    expect(LIBRARY.resolve('mix').name).toBe('ND_mix_color3');
    expect(LIBRARY.resolve('mix', 'float').name).toBe('ND_mix_float');
    expect(LIBRARY.resolve('mix', 'ND_mix_color3_color3').name).toBe('ND_mix_color3_color3');
    expect(() => LIBRARY.resolve('mix', 'vector4')).toThrow(/Types: color3, float/);
  });
});

describe('runScript', () => {
  it('names nodes after variables and records values and connections', async () => {
    const graph = await runScript(`
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

  it('broadcasts numbers to colors and accepts a node as its single output', async () => {
    const graph = await runScript('m = new Mix(); m.fg = 0.25; n = new Mix(); n.bg = m;', LIBRARY);
    expect(graph.nodes[0]!.inputs.get('fg')).toEqual({ value: [0.25, 0.25, 0.25] });
    expect(graph.nodes[1]!.inputs.get('bg')).toEqual({ node: graph.nodes[0], output: 'out' });
  });

  it('selects variants and named outputs of multi-output nodes', async () => {
    const graph = await runScript('c = new Separate3(); m = new Mix("float"); m.fg = c.outg;', LIBRARY);
    expect(graph.nodes[1]!.inputs.get('fg')).toEqual({ node: graph.nodes[0], output: 'outg' });
  });

  it('gives unique names to unnamed and reassigned nodes', async () => {
    const graph = await runScript('n = new Image(); n = new Image(); new Noise3d();', LIBRARY);
    expect(graph.nodes.map(node => node.name)).toEqual(['n', 'n_2', 'noise3d']);
  });

  it('reports unknown nodes, inputs and type mismatches', async () => {
    await expect(runScript('x = new Bogus();', LIBRARY)).rejects.toThrow(/Bogus is not defined/);
    await expect(runScript('i = new Image(); i.fil = "a";', LIBRARY)).rejects.toThrow(/no input "fil".*Inputs: file, default/);
    await expect(runScript('n = new Noise3d(); n.octaves = 1.5;', LIBRARY)).rejects.toThrow(/n\.octaves expects a integer/);
    await expect(runScript('n = new Noise3d(); s = new StandardSurface(); s.base_color = n.out;', LIBRARY))
      .rejects.toThrow(/s\.base_color expects color3 but n\.out is float/);
    await expect(runScript('s = new StandardSurface(); s.out = 1;', LIBRARY)).rejects.toThrow(/output and cannot be assigned/);
    await expect(runScript('s = new StandardSurface(', LIBRARY)).rejects.toThrow(/Syntax error/);
  });

  it('keeps JavaScript available for computed values', async () => {
    const graph = await runScript('m = new Mix("float"); for (let i = 0; i < 3; i++) m.mix = Math.min(1, i * 0.4);', LIBRARY);
    expect(graph.nodes[0]!.inputs.get('mix')).toEqual({ value: 0.8 });
  });

  it('throws ScriptError instances', async () => {
    await expect(runScript('undefinedVariable.x = 1;', LIBRARY)).rejects.toThrow(ScriptError);
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

  it('writes MaterialX with an automatic surfacematerial', async () => {
    const xml = toXml(await runScript(SCRIPT, LIBRARY), LIBRARY, { filePrefix: 'http://host/textures/' });
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

  it('round-trips script → XML → script', async () => {
    const xml = toXml(await runScript(SCRIPT, LIBRARY), LIBRARY);
    const script = toScript(fromXml(xml, LIBRARY), LIBRARY);
    expect(script).toBe(`${SCRIPT}
material = new Surfacematerial();
material.surfaceshader = s.out;
`);
    expect(toXml(await runScript(script, LIBRARY), LIBRARY)).toBe(xml);
  });

  it('infers NodeDefs from node and input types and orders sources first', async () => {
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

  it('renames nodes that collide with JavaScript keywords or node classes', async () => {
    const graph = fromXml('<materialx><image name="new" type="color3" /><image name="Mix" type="color3" /></materialx>', LIBRARY);
    expect(toScript(graph, LIBRARY)).toBe('new_ = new Image();\n\nMix_ = new Image();\n');
  });

  it('flattens node graphs, resolving outputs, interface inputs, file prefixes and color spaces', async () => {
    const graph = fromXml(`<materialx version="1.39" fileprefix="textures/">
      <noise3d name="weight" type="float"><input name="amplitude" type="float" value="0.5" /></noise3d>
      <image name="img" type="color3"><input name="file" type="filename" value="/abs/base.png" /></image>
      <nodegraph name="NG" fileprefix="wood/">
        <input name="tint" type="color3" value="0.5" />
        <input name="amount" type="float" nodename="weight" />
        <image name="img" type="color3">
          <input name="file" type="filename" value="albedo.png" colorspace="srgb_texture" />
        </image>
        <mix name="blend" type="color3">
          <input name="fg" type="color3" nodename="img" />
          <input name="bg" type="color3" interfacename="tint" />
          <input name="mix" type="float" interfacename="amount" />
        </mix>
        <output name="color" type="color3" nodename="blend" />
      </nodegraph>
      <standard_surface name="surface" type="surfaceshader" nodedef="ND_standard_surface_surfaceshader_100">
        <input name="base_color" type="color3" nodegraph="NG" output="color" />
      </standard_surface>
      <surfacematerial name="mat" type="material">
        <input name="surfaceshader" type="surfaceshader" nodename="surface" />
        <input name="displacementshader" type="displacementshader" value="" />
      </surfacematerial>
      <look name="default"><materialassign name="assign" material="mat" geom="/World" /></look>
    </materialx>`, LIBRARY);
    expect(toScript(graph, LIBRARY)).toBe(`weight = new Noise3d();
weight.amplitude = 0.5;

img = new Image();
img.file = "/abs/base.png";

NG_img = new Image();
NG_img.colorspace = "srgb_texture";
NG_img.file = "wood/albedo.png";

blend = new Mix();
blend.fg = NG_img.out;
blend.bg = [0.5, 0.5, 0.5];
blend.mix = weight.out;

surface = new StandardSurface("ND_standard_surface_surfaceshader_100");
surface.base_color = blend.out;

mat = new Surfacematerial();
mat.surfaceshader = surface.out;
`);
    const xml = toXml(graph, LIBRARY);
    expect(xml).toContain('<input name="file" type="filename" value="wood/albedo.png" colorspace="srgb_texture" />');
    expect(xml).toContain('<standard_surface name="surface" type="surfaceshader" nodedef="ND_standard_surface_surfaceshader_100">');
  });

  it('expands nodes of document NodeDefs into the nodes of their nodegraph implementation', async () => {
    const graph = fromXml(`<materialx version="1.39">
      <nodedef name="ND_tinted" node="tinted">
        <input name="tint" type="color3" value="0.2, 0.4, 0.6" />
        <input name="amount" type="float" value="1 2" />
        <input name="source" type="color3" />
        <output name="out" type="color3" />
        <output name="red" type="float" />
      </nodedef>
      <nodegraph name="NG_tinted" nodedef="ND_tinted">
        <mix name="blend" type="color3">
          <input name="fg" type="color3" interfacename="tint" />
          <input name="bg" type="color3" interfacename="source" />
          <input name="mix" type="float" interfacename="amount" />
        </mix>
        <separate3 name="split" type="multioutput">
          <input name="in" type="color3" nodename="blend" />
          <output name="outr" type="float" />
        </separate3>
        <output name="out" type="color3" nodename="blend" />
        <output name="red" type="float" nodename="split" output="outr" />
      </nodegraph>
      <image name="tex" type="color3"><input name="file" type="filename" value="a.png" /></image>
      <tinted name="first" type="multioutput">
        <input name="source" type="color3" nodename="tex" />
      </tinted>
      <tinted name="second" type="multioutput">
        <input name="tint" type="color3" value="1, 0, 0" />
      </tinted>
      <standard_surface name="surface" type="surfaceshader">
        <input name="base_color" type="color3" nodename="first" output="out" />
        <input name="base" type="float" nodename="second" output="red" />
      </standard_surface>
    </materialx>`, LIBRARY);
    expect(toScript(graph, LIBRARY)).toBe(`tex = new Image();
tex.file = "a.png";

blend = new Mix();
blend.fg = [0.2, 0.4, 0.6];
blend.bg = tex.out;

split = new Separate3();
split.in = blend.out;

second_blend = new Mix();
second_blend.fg = [1, 0, 0];

second_split = new Separate3();
second_split.in = second_blend.out;

surface = new StandardSurface();
surface.base_color = blend.out;
surface.base = second_split.outr;
`);
    expect(graph.nodes.map(node => node.name)).toEqual(['tex', 'blend', 'split', 'second_blend', 'second_split', 'surface']);
    expect(() => fromXml(`<materialx><nodedef name="ND_loop" node="loop"><output name="out" type="float" /></nodedef>
      <nodegraph name="NG_loop" nodedef="ND_loop"><loop name="again" type="float" /><output name="out" type="float" nodename="again" /></nodegraph>
      <loop name="l" type="float" /></materialx>`, LIBRARY)).toThrow(/implemented recursively/);
    expect(() => fromXml('<materialx><nodedef name="ND_ext" node="ext"><output name="out" type="float" /></nodedef><ext name="e" type="float" /></materialx>', LIBRARY))
      .toThrow(/has no nodegraph implementation/);
  });

  it('inlines xi:include documents once, keeping their textures relative to their own folder', async () => {
    const files: Record<string, string> = {
      'https://host/page/lib/a.mtlx': `<materialx fileprefix="tex/" xmlns:xi="http://www.w3.org/2001/XInclude">
        <xi:include href="../shared/b.mtlx" />
        <image name="ia" type="color3"><input name="file" type="filename" value="a.png" /></image>
      </materialx>`,
      'https://host/page/shared/b.mtlx': `<materialx>
        <nodegraph name="NG" fileprefix="maps/">
          <image name="ib" type="color3"><input name="file" type="filename" value="b.png" /></image>
          <output name="out" type="color3" nodename="ib" />
        </nodegraph>
        <image name="ic" type="color3"><input name="file" type="filename" value="c.png" /></image>
      </materialx>`,
    };
    const fetched: string[] = [];
    const fetchText = async (url: string): Promise<string> => { fetched.push(url); return files[url]!; };
    const xml = await inlineIncludes(`<materialx xmlns:xi="http://www.w3.org/2001/XInclude">
      <xi:include href="lib/a.mtlx" />
      <xi:include href="shared/b.mtlx" />
      <image name="root" type="color3"><input name="file" type="filename" value="r.png" /></image>
    </materialx>`, 'https://host/page/index.html', fetchText);
    expect(fetched).toEqual(['https://host/page/lib/a.mtlx', 'https://host/page/shared/b.mtlx']);
    expect(xml).not.toContain('xi:include');
    const graph = fromXml(xml, LIBRARY);
    expect(graph.nodes.map(node => [node.name, node.inputs.get('file')])).toEqual([
      ['ib', { value: 'https://host/page/shared/maps/b.png' }],
      ['ic', { value: 'https://host/page/shared/c.png' }],
      ['ia', { value: 'https://host/page/lib/tex/a.png' }],
      ['root', { value: 'r.png' }],
    ]);
    await expect(inlineIncludes('<materialx><image name="i" type="color3" /></materialx>', 'https://host/', fetchText))
      .resolves.toBe('<materialx><image name="i" type="color3" /></materialx>');
    expect(() => fromXml('<materialx><xi:include href="x.mtlx" /></materialx>', LIBRARY)).toThrow(/must be inlined/);
  });

  it('sets the color space attribute from scripts and keeps it on nodes without file inputs', async () => {
    const graph = await runScript('i = new Image(); i.colorspace = "srgb_texture"; m = new Mix(); m.colorspace = "acescg";', LIBRARY);
    expect(graph.nodes.map(node => node.colorspace)).toEqual(['srgb_texture', 'acescg']);
    const xml = toXml(graph, LIBRARY);
    expect(xml).toContain('<image name="i" type="color3" colorspace="srgb_texture" />');
    await expect(runScript('i = new Image(); i.colorspace = 1;', LIBRARY)).rejects.toThrow(/colorspace expects a color space name/);
  });

  it('rejects unsupported documents', async () => {
    expect(() => fromXml('<foo />', LIBRARY)).toThrow(/<materialx> root is missing/);
    expect(() => fromXml('<materialx><nodegraph name="g" /><image name="i" type="color3"><input name="default" type="color3" nodegraph="g" /></image></materialx>', LIBRARY))
      .toThrow(/unknown output "g\."/);
    expect(() => fromXml('<materialx><image name="i" type="color3"><input name="x" type="float" value="1" /></image></materialx>', LIBRARY))
      .toThrow(/No image NodeDef matches/);
    expect(() => fromXml('<materialx><mix name="m" type="float"><input name="fg" type="float" nodename="nope" /></mix></materialx>', LIBRARY))
      .toThrow(/unknown node "nope"/);
  });
});

describe('expressions', () => {
  const nodedef = (name: string, node: string, inputs: string, output: string): string =>
    `<nodedef name="${name}" node="${node}">${inputs}<output name="out" type="${output}" /></nodedef>`;
  const input = (name: string, type: string): string => `<input name="${name}" type="${type}" />`;
  const binary = (node: string, a: string, b: string, out: string, suffix = ''): string =>
    nodedef(`ND_${node}_${out}${suffix}`, node, input('in1', a) + input('in2', b), out);
  const EXPRESSIONS = ScriptLibrary.fromXml([`<materialx>
    ${nodedef('ND_noise3d_float', 'noise3d', input('amplitude', 'float'), 'float')}
    ${nodedef('ND_noise3d_color3', 'noise3d', input('amplitude', 'vector3'), 'color3')}
    ${binary('multiply', 'float', 'float', 'float')}${binary('multiply', 'color3', 'color3', 'color3')}
    ${binary('multiply', 'color3', 'float', 'color3', 'FA')}
    ${binary('add', 'float', 'float', 'float')}${binary('add', 'color3', 'color3', 'color3')}
    ${binary('subtract', 'float', 'float', 'float')}${binary('subtract', 'color3', 'color3', 'color3')}
    ${nodedef('ND_sin_float', 'sin', input('in', 'float'), 'float')}
    ${nodedef('ND_convert_float_color3', 'convert', input('in', 'float'), 'color3')}
    ${nodedef('ND_ifgreater_float', 'ifgreater', input('value1', 'float') + input('value2', 'float') + input('in1', 'float') + input('in2', 'float'), 'float')}
    ${nodedef('ND_ifgreater_color3', 'ifgreater', input('value1', 'float') + input('value2', 'float') + input('in1', 'color3') + input('in2', 'color3'), 'color3')}
    ${nodedef('ND_ifgreater_boolean', 'ifgreater', input('value1', 'float') + input('value2', 'float'), 'boolean')}
    ${nodedef('ND_ifgreatereq_float', 'ifgreatereq', input('value1', 'float') + input('value2', 'float') + input('in1', 'float') + input('in2', 'float'), 'float')}
    ${nodedef('ND_ifequal_color3B', 'ifequal', input('value1', 'boolean') + input('value2', 'boolean') + input('in1', 'color3') + input('in2', 'color3'), 'color3')}
    ${nodedef('ND_logical_and', 'and', input('in1', 'boolean') + input('in2', 'boolean'), 'boolean')}
    ${nodedef('ND_logical_not', 'not', input('in', 'boolean'), 'boolean')}
    ${nodedef('ND_standard_surface_surfaceshader', 'standard_surface', input('base', 'float') + input('base_color', 'color3'), 'surfaceshader')}
    ${nodedef('ND_surfacematerial', 'surfacematerial', input('surfaceshader', 'surfaceshader'), 'material')}
    ${nodedef('ND_image_color3', 'image', input('file', 'filename'), 'color3')}
  </materialx>`]);
  const script = async (code: string): Promise<string> => toScript(await runScript(code, EXPRESSIONS), EXPRESSIONS);

  it('builds math nodes from operators and Math functions on node outputs', async () => {
    expect(await script(`n = new Noise3d("float");
const m = n.out * 2 + 0.5;
tint = [1, 0.5, 0] * n.out;
wave = Math.sin(n.out) - 1;
neg = -n.out;
color = new Noise3d();
sum = color + n.out;
plain = new Noise3d("float");
plain.amplitude = 2 * 3 + Math.max(1, 2) - 10 % 4;`)).toBe(`n = new Noise3d("float");

multiply = new Multiply("float");
multiply.in1 = n.out;
multiply.in2 = 2;

m = new Add("float");
m.in1 = multiply.out;
m.in2 = 0.5;

tint = new Multiply("ND_multiply_color3FA");
tint.in1 = [1, 0.5, 0];
tint.in2 = n.out;

sin = new Sin();
sin.in = n.out;

wave = new Subtract("float");
wave.in1 = sin.out;
wave.in2 = 1;

neg = new Multiply("float");
neg.in1 = n.out;
neg.in2 = -1;

color = new Noise3d();

convert = new Convert();
convert.in = n.out;

sum = new Add();
sum.in1 = color.out;
sum.in2 = convert.out;

plain = new Noise3d("float");
plain.amplitude = 6;
`);
    await expect(runScript('n = new Noise3d("float"); x = n.out * new StandardSurface();', EXPRESSIONS))
      .rejects.toThrow(/No multiply NodeDef combines float and surfaceshader/);
  });

  it('turns conditional expressions on node outputs into ifgreater, ifgreatereq, ifequal and logic nodes', async () => {
    expect(await script(`n = new Noise3d("float");
red = n.out > 0.5 ? [1, 0, 0] : [0, 0, 1];
low = n.out <= 0.2 ? 1 : n.out;
inside = n.out > 0.3 && !(n.out > 0.8);
band = inside ? [1, 1, 1] : [0, 0, 0];
lazy = 2 > 1 ? new Noise3d("float") : new Image();`)).toBe(`n = new Noise3d("float");

red = new Ifgreater();
red.value1 = n.out;
red.value2 = 0.5;
red.in1 = [1, 0, 0];
red.in2 = [0, 0, 1];

low = new Ifgreatereq();
low.value1 = 0.2;
low.value2 = n.out;
low.in1 = 1;
low.in2 = n.out;

ifgreater = new Ifgreater("boolean");
ifgreater.value1 = n.out;
ifgreater.value2 = 0.3;

ifgreater_2 = new Ifgreater("boolean");
ifgreater_2.value1 = n.out;
ifgreater_2.value2 = 0.8;

not = new Not();
not.in = ifgreater_2.out;

inside = new And();
inside.in1 = ifgreater.out;
inside.in2 = not.out;

band = new Ifequal();
band.value1 = inside.out;
band.value2 = true;
band.in1 = [1, 1, 1];
band.in2 = [0, 0, 0];

lazy = new Noise3d("float");
`);
    await expect(runScript('n = new Noise3d("float");\nif (n.out > 0.5) {}', EXPRESSIONS)).rejects.toThrow(/evaluated per pixel/);
    await expect(runScript('n = new Noise3d("float");\nwhile (n.out) {}', EXPRESSIONS)).rejects.toThrow(/evaluated per pixel/);
  });

  it('keeps source lines for runtime errors and leaves awaited branches alone', async () => {
    await expect(runScript('n = new Noise3d("float");\nm = n.out * 2;\nm.bogus = 1;', EXPRESSIONS))
      .rejects.toMatchObject({ line: 3, message: expect.stringMatching(/m\.out is a node output: "bogus" must be set on m itself/) });
    expect(transformScript('x = ok ? await f() : 1;\ny = a ? b : c;')).toBe(
      'x = ok ? await f() : 1;\ny = __mx.cond(a, () => (b), () => (c));');
    expect(transformScript('for (let i = 0; i < 3; i++) { const k = i; }\nlet unset;')).toBe(
      'for (let i = 0; __mx.test(__mx.cmp("<", i, 3)); i++) { k = i; }\nlet unset;');
  });

  it('drives the viewer through the host, in order, and only validates without one', async () => {
    const calls: unknown[][] = [];
    const host: ScriptHost = {
      loadScene: async (entry) => { calls.push(['scene', entry]); },
      objects: () => ['/World/Ball', '/World/Ground'],
      renderSettings: () => ({ backend: 'raster' }),
      setRenderSetting: async (name, value) => { calls.push(['set', name, value]); },
      assignMaterial: async (object, material) => { calls.push(['assign', object, material]); },
      render: async (samples) => { calls.push(['render', samples]); return samples ?? 1; },
    };
    const code = `await scene("./scenes/ball.usda");
before = render.backend;
render.backend = "pathtracing";
render.depth = 8;
s = new StandardSurface();
s.base = render.depth / 16;
for (const object of objects()) if (object.endsWith("Ball")) await assign(object, s);
await assign("/World/Ground", "materials/floor.mtlx");
samples = await render(16);`;
    const run = await runScript(code, EXPRESSIONS, { host, baseUrl: 'https://host/app/', filePrefix: 'https://host/app/' });
    expect(run.viewerCommands).toBe(6);
    expect(calls.map(call => call[0] === 'assign' && typeof call[2] === 'object' && 'xml' in (call[2] as object) ? ['assign', call[1], 'xml'] : call)).toEqual([
      ['scene', './scenes/ball.usda'], ['set', 'backend', 'pathtracing'], ['set', 'depth', 8],
      ['assign', '/World/Ball', 'xml'], ['assign', '/World/Ground', { url: 'https://host/app/materials/floor.mtlx' }], ['render', 16],
    ]);
    const xml = (calls[3]![2] as { xml: string }).xml;
    expect(xml).toContain('<materialx version="1.39" fileprefix="https://host/app/">');
    expect(xml).toContain('<input name="base" type="float" value="0.5" />');
    expect(xml).toContain('<surfacematerial name="material" type="material">');

    calls.length = 0;
    // Without a host, objects() is empty: only the ground assignment is requested.
    expect((await runScript(code, EXPRESSIONS)).viewerCommands).toBe(5);
    expect(calls).toEqual([]);
    await expect(runScript('render.backend = "vulkan";', EXPRESSIONS)).rejects.toThrow(/render.backend expects "raster", "pathtracing", "disney"/);
    await expect(runScript('render.speed = 1;', EXPRESSIONS)).rejects.toThrow(/Unknown render setting "speed"/);
    await expect(runScript('await render(0);', EXPRESSIONS)).rejects.toThrow(/positive integer/);
    await expect(runScript('await assign("/x", 3);', EXPRESSIONS)).rejects.toThrow(/surface shader, a material node or a .mtlx path/);
    await expect(runScript('scene = 1;', EXPRESSIONS)).rejects.toThrow(/reserved/);
  });

  it('loads MaterialX documents as editable script nodes with absolute texture paths', async () => {
    const fetchText = async (url: string): Promise<string> => {
      expect(url).toBe('https://host/app/lib/wood.mtlx');
      return `<materialx>
        <image name="tex" type="color3"><input name="file" type="filename" value="wood.png" /></image>
        <standard_surface name="surface" type="surfaceshader"><input name="base_color" type="color3" nodename="tex" /></standard_surface>
        <surfacematerial name="Wood" type="material"><input name="surfaceshader" type="surfaceshader" nodename="surface" /></surfacematerial>
      </materialx>`;
    };
    const run = await runScript(`surface = new StandardSurface();
wood = await load("lib/wood.mtlx");
wood.surfaceshader = surface;`, EXPRESSIONS, { baseUrl: 'https://host/app/', fetchText });
    expect(toScript(run, EXPRESSIONS)).toBe(`surface = new StandardSurface();

tex = new Image();
tex.file = "https://host/app/lib/wood.png";

surface_2 = new StandardSurface();
surface_2.base_color = tex.out;

Wood = new Surfacematerial();
Wood.surfaceshader = surface.out;
`);
  });
});

describe('fromResolvedGraph', () => {
  const provenance = { namePath: '/' };
  const resolved: ResolvedGraph = {
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 's', provenance }],
    nodes: new Map<string, ResolvedNode>([
      ['NG/img', {
        id: 'NG/img', category: 'image', type: 'color3', provenance,
        nodeDef: { name: 'ND_engine_image_color3', nodeString: 'image', type: 'color3', implementation: { kind: 'unresolved' } },
        inputs: [{
          name: 'file', type: 'filename', colorSpace: 'srgb_texture', provenance,
          source: { kind: 'value', type: 'filename', value: 'http://host/wood.png' },
        }],
      }],
      ['s', {
        id: 's', category: 'standard_surface', type: 'surfaceshader', provenance,
        inputs: [
          { name: 'base_color', type: 'color3', source: { kind: 'connection', nodeId: 'NG/img' }, provenance },
          { name: 'base', type: 'float', source: { kind: 'value', type: 'float', value: '0.7' }, provenance },
          { name: 'thin_walled', type: 'boolean', defaulted: true, source: { kind: 'value', type: 'boolean', value: 'false' }, provenance },
          { name: 'normal', type: 'vector3', source: { kind: 'default', type: 'vector3' }, provenance },
        ],
      }],
    ]),
  };

  it('scripts the engine material graph with its current values and a named surfacematerial', async () => {
    expect(toScript(fromResolvedGraph(resolved, LIBRARY, 'Wood'), LIBRARY)).toBe(`img = new Image();
img.colorspace = "srgb_texture";
img.file = "http://host/wood.png";

s = new StandardSurface();
s.base_color = img.out;
s.base = 0.7;

Wood = new Surfacematerial();
Wood.surfaceshader = s.out;
`);
  });

  it('rejects LamaSurface wrappers', async () => {
    expect(() => fromResolvedGraph({ ...resolved, lamaSurface: {} }, LIBRARY)).toThrow(/LamaSurface/);
  });
});

const LIBRARY_ROOT = process.env['MX_LIB_ROOT'] ?? 'D:/WebGL2/MaterialX/MaterialX-rva/libraries';

describe.skipIf(!existsSync(join(LIBRARY_ROOT, 'stdlib', 'stdlib_defs.mtlx')))('installed MaterialX libraries', () => {
  it('scripts a standard_surface material from the real NodeDefs', async () => {
    const library = ScriptLibrary.fromXml(SCRIPT_LIBRARY_FILES.map(file => readFileSync(join(LIBRARY_ROOT, file), 'utf8')));
    expect(library.resolve('standard_surface').inputs.length).toBeGreaterThan(30);
    expect(library.resolve('open_pbr_surface').inputs.some(input => input.name === 'base_color')).toBe(true);
    // Lower-case variables may share a node category name (pbrlib defines `surface`).
    const graph = await runScript(`
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
