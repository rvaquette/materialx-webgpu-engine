import { describe, expect, it } from 'vitest';
import { ScriptLibrary, runScript } from '../../src/materialx/script-api.ts';
import { addScriptDownstream, addScriptUpstream, highlightScript, scriptCompletions, scriptHover, scriptLiteral, scriptVariables, setScriptInput } from '../../src/materialx/script-editor.ts';
import { layoutScriptGraph } from '../../src/materialx/script-graph-layout.ts';
import { decodeSharedScript, encodeSharedScript, sharedScriptOf } from '../../src/materialx/script-store.ts';

const LIBRARY = ScriptLibrary.fromXml([`<materialx version="1.39">
  <nodedef name="ND_image_color3" node="image">
    <input name="file" type="filename" value="" />
    <output name="out" type="color3" />
  </nodedef>
  <nodedef name="ND_mix_color3" node="mix" doc="Blends foreground and background colors.">
    <input name="fg" type="color3" value="0, 0, 0" doc="Foreground color." />
    <input name="mix" type="float" value="0" />
    <output name="out" type="color3" />
  </nodedef>
  <nodedef name="ND_mix_float" node="mix">
    <input name="fg" type="float" value="0" />
    <output name="out" type="float" />
  </nodedef>
</materialx>`]);

const CODE = 'const img = new Image();\nm = new Mix("float");\n';

describe('script editor language support', () => {
  it('resolves variables to the NodeDef selected by their constructor', () => {
    const variables = scriptVariables(CODE, LIBRARY);
    expect(variables.get('img')?.name).toBe('ND_image_color3');
    expect(variables.get('m')?.name).toBe('ND_mix_float');
  });

  it('colors node types, variables, inputs, outputs and unknown members', () => {
    const html = highlightScript(`${CODE}img.file = "a<b>.png"; // note\nm.fg = img.out; m.nope = 1; img.colorspace = "acescg";`, LIBRARY);
    expect(html).toContain('<span class="tok-var">img</span>.<span class="tok-input">colorspace</span>');
    expect(html).toContain('<span class="tok-keyword">new</span> <span class="tok-node">Image</span>()');
    expect(html).toContain('<span class="tok-var">img</span>.<span class="tok-input">file</span>');
    expect(html).toContain('<span class="tok-string">"a&lt;b&gt;.png"</span>');
    expect(html).toContain('<span class="tok-comment">// note</span>');
    expect(html).toContain('<span class="tok-var">img</span>.<span class="tok-output">out</span>');
    expect(html).toContain('<span class="tok-var">m</span>.<span class="tok-error">nope</span>');
  });

  it('colors and completes viewer functions, render settings and Math', () => {
    const html = highlightScript('await scene("a.usda");\nrender.backend = "raster";\nrender.speed = 1;', LIBRARY);
    expect(html).toContain('<span class="tok-builtin">scene</span>');
    expect(html).toContain('<span class="tok-builtin">render</span>.<span class="tok-input">backend</span>');
    expect(html).toContain('<span class="tok-builtin">render</span>.<span class="tok-error">speed</span>');
    expect(scriptCompletions('render.ba', '', LIBRARY)?.items).toEqual([
      { label: 'backend', detail: 'Moteur de rendu : "raster" | "pathtracing" | "disney"', insert: 'backend' },
    ]);
    expect(scriptCompletions('x = Math.si', '', LIBRARY)?.items[0]).toEqual({ label: 'sin', detail: 'nœud sin sur une sortie', insert: 'sin(' });
    expect(scriptCompletions('as', '', LIBRARY)).toEqual({
      from: 0, items: [{ label: 'assign', detail: 'await assign("/objet", surface) : affecte un matériau', insert: 'await assign("' }],
    });
    expect(scriptCompletions('x = img', '', LIBRARY)).toBeUndefined();
  });

  it('completes node classes, variants and ports', () => {
    expect(scriptCompletions('x = new Mi', CODE, LIBRARY)).toEqual({
      from: 8, items: [{ label: 'Mix', detail: 'mix → color3 | float', insert: 'Mix()', info: 'Blends foreground and background colors.' }],
    });
    expect(scriptCompletions('x = new Mix("fl', CODE, LIBRARY)?.items.map(item => item.label)).toEqual(['float', 'ND_mix_float']);
    const ports = scriptCompletions(`${CODE}img.`, CODE, LIBRARY)!;
    expect(ports.items.map(item => [item.label, item.detail])).toEqual([
      ['file', 'entrée filename = ""'], ['colorspace', 'attribut string'], ['out', 'sortie color3'],
    ]);
    expect(scriptCompletions(`${CODE}m.fg = img.`, CODE, LIBRARY)?.items[0]?.label).toBe('out');
    expect(scriptCompletions(`${CODE}unknown.`, CODE, LIBRARY)).toBeUndefined();
    const colorCode = 'm = new Mix();\n';
    expect(scriptCompletions(`${colorCode}m.f`, colorCode, LIBRARY)?.items[0]?.info).toBe('Foreground color.');
  });

  it('rewrites node inputs edited in the graph', () => {
    const code = 'img = new Image();\nimg.file = "https://a/b.png";\nm = new Mix();\nm.fg = [1, 0, 0]; // rouge\nm.mix = 0.5;\nsurface = 1;\n';
    expect(setScriptInput(code, 'm', 'fg', scriptLiteral([0, 1, 0]))).toContain('m.fg = [0, 1, 0]; // rouge');
    expect(setScriptInput(code, 'img', 'file', '"c.png"')).toContain('img.file = "c.png";\nm = new Mix();');
    expect(setScriptInput(code, 'm', 'bg', 'img.out', 3)).toContain('m.mix = 0.5;\nm.bg = img.out;\nsurface');
    expect(setScriptInput('x = 1;', 'n', 'octaves', '4')).toBe('x = 1;\nn.octaves = 4;');
    expect(setScriptInput(code, 'm', 'fg', undefined)).not.toContain('m.fg');
    expect(setScriptInput(code, 'm', 'fgx', undefined)).toBe(code);
    const upstream = addScriptUpstream(code, 'm', 'mix', { name: 'ND_mix_float', category: 'mix', className: 'Mix' }, 'out', 3);
    expect(upstream.variable).toBe('mix');
    expect(upstream.code).toContain('m.fg = [1, 0, 0]; // rouge\nmix = new Mix("ND_mix_float");\nm.mix = mix.out;');
    expect(addScriptUpstream(upstream.code, 'm', 'bg', { name: 'ND_image_color3', category: 'image', className: 'Image' }, 'out', 3).variable).toBe('image');
    expect(addScriptUpstream('img = new Image();', 'img', 'default', { name: 'ND_image_color3', category: 'image', className: 'Image' }, 'out', 1))
      .toEqual({ variable: 'image', code: 'img = new Image();\nimage = new Image("ND_image_color3");\nimg.default = image.out;' });
    expect(addScriptDownstream('img = new Image();\nimg.file = "a.png";\nx = 1;', 'img', 'out', { name: 'ND_mix_color3', category: 'mix', className: 'Mix' }, 'fg', 1))
      .toEqual({ variable: 'mix', code: 'img = new Image();\nimg.file = "a.png";\nmix = new Mix("ND_mix_color3");\nmix.fg = img.out;\nx = 1;' });
  });

  it('documents the word under the pointer', () => {
    const code = `${CODE}m.fg = img.out;\nrender.backend = "raster";\nx = Math.sin(1);\nawait scene("a.usda");`;
    const at = (text: string, offset = 1) => scriptHover(code, code.indexOf(text) + offset, LIBRARY);
    expect(at('Image')).toMatchObject({ title: 'new Image() : nœud image', lines: [expect.stringContaining('color3'), 'Variantes : ND_image_color3'] });
    expect(at('fg')).toMatchObject({ title: 'm.fg : entrée float', lines: ['Défaut : 0', 'NodeDef : ND_mix_float'] });
    expect(at('out;')).toMatchObject({ title: 'img.out : sortie color3' });
    expect(at('backend')).toMatchObject({ title: 'render.backend', lines: ['Moteur de rendu', 'Valeurs : "raster", "pathtracing", "disney"'] });
    expect(at('sin')).toMatchObject({ title: 'Math.sin' });
    expect(at('scene(')?.lines[0]).toMatch(/charge une scène/);
    expect(at('img =', 0)).toMatchObject({ from: code.indexOf('img ='), title: 'img : Image → color3' });
    expect(at('"a.usda"', 3)).toBeUndefined();
  });

  it('knows primitives: completions, properties and documentation', () => {
    const code = 'ball = new Sphere({ radius: 1 });\nball.radius = 0.5;\n';
    expect(scriptCompletions('x = new Sph', code, LIBRARY)?.items[0]).toMatchObject({ label: 'Sphere', insert: 'Sphere()' });
    expect(scriptVariables(code, LIBRARY).get('ball')?.inputs.map(port => port.name)).toEqual([
      'radius', 'resolution', 'translate', 'rotate', 'scale', 'visible', 'material', 'deform',
    ]);
    expect(scriptCompletions(`${code}ball.re`, code, LIBRARY)?.items.map(item => item.label)).toEqual(['resolution']);
    const at = (text: string, offset = 1) => scriptHover(code, code.indexOf(text) + offset, LIBRARY);
    expect(at('Sphere')).toMatchObject({ title: 'new Sphere() : primitive' });
    expect(at('radius =')).toMatchObject({ title: 'ball.radius : propriété float', lines: ['Rayon', 'Défaut : 0.5', 'Plage : 0 … +∞', 'Primitive : Sphere'] });
    expect(at('ball =', 0)).toMatchObject({ title: 'ball : Sphere' });
    expect(highlightScript(code, LIBRARY)).toContain('<span class="tok-node">Sphere</span>');
  });
});

describe('script editor panels and sharing', () => {
  it('lays the graph out from sources to the material', async () => {
    const run = await runScript('img = new Image();\nf = new Mix("float");\nm = new Mix();\nm.fg = img.out;\nm.mix = f.out;', LIBRARY);
    const layout = layoutScriptGraph(run.nodes);
    expect(layout.boxes.map(box => [box.node.name, box.level, box.node.line])).toEqual([['img', 0, 1], ['f', 0, 2], ['m', 1, 3]]);
    expect(layout.boxes[1]!.y).toBeGreaterThan(layout.boxes[0]!.y);
    expect(layout.links.map(link => `${link.from.node.name}.${link.output}->${link.to.node.name}.${link.input} ${link.slot}/${link.slots}`))
      .toEqual(['img.out->m.fg 0/2', 'f.out->m.mix 1/2']);
    expect(layout.width).toBeGreaterThan(layout.boxes[2]!.x);
  });

  it('round-trips scripts through share links and rejects corrupt ones', async () => {
    const code = `// accents é ✓\n${'surface.base_color = [0.8, 0.2, 0.1];\n'.repeat(50)}`;
    const value = await encodeSharedScript(code);
    expect(value).toMatch(/^[\w-]+$/);
    expect(value.length).toBeLessThan(code.length / 4);
    expect(await decodeSharedScript(value)).toBe(code);
    expect(await sharedScriptOf(`#other=1&script=${value}`)).toBe(code);
    expect(await sharedScriptOf('#other=1')).toBeUndefined();
    await expect(decodeSharedScript('not-a-deflate-stream')).rejects.toThrow('Lien de script invalide.');
  });
});