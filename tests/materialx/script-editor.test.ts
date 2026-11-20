import { describe, expect, it } from 'vitest';
import { ScriptLibrary } from '../../src/materialx/script-api.ts';
import { highlightScript, scriptCompletions, scriptVariables } from '../../src/materialx/script-editor.ts';

const LIBRARY = ScriptLibrary.fromXml([`<materialx version="1.39">
  <nodedef name="ND_image_color3" node="image">
    <input name="file" type="filename" value="" />
    <output name="out" type="color3" />
  </nodedef>
  <nodedef name="ND_mix_color3" node="mix">
    <input name="fg" type="color3" value="0, 0, 0" />
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

  it('completes node classes, variants and ports', () => {
    expect(scriptCompletions('x = new Mi', CODE, LIBRARY)).toEqual({
      from: 8, items: [{ label: 'Mix', detail: 'mix → color3 | float', insert: 'Mix()' }],
    });
    expect(scriptCompletions('x = new Mix("fl', CODE, LIBRARY)?.items.map(item => item.label)).toEqual(['float', 'ND_mix_float']);
    const ports = scriptCompletions(`${CODE}img.`, CODE, LIBRARY)!;
    expect(ports.items.map(item => [item.label, item.detail])).toEqual([
      ['file', 'entrée filename = ""'], ['colorspace', 'attribut string'], ['out', 'sortie color3'],
    ]);
    expect(scriptCompletions(`${CODE}m.fg = img.`, CODE, LIBRARY)?.items[0]?.label).toBe('out');
    expect(scriptCompletions(`${CODE}unknown.`, CODE, LIBRARY)).toBeUndefined();
  });
});
