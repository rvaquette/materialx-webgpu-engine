// Material script language support (highlighting, NodeDef-driven completions, hover
// documentation, value formatting) and the « Script » toolbar button. The CodeMirror editor
// itself (script-editor-view.ts) is loaded the first time the editor opens.

import {
  isColorspaceAttribute, MATERIALX_COLORSPACES, MATH_NODES, nodeType, RENDER_SETTINGS,
  type ScriptHost, type ScriptLibrary, type ScriptNodeDef, type ScriptPortDef, type ScriptValue,
} from './script-api.ts';
import type { ResolvedGraph } from './graph.ts';
import type { MaterialXScriptEditor } from './script-editor-view.ts';
import { sharedScriptOf } from './script-store.ts';
import { activityButton, panelVisible, rememberPanel } from '../ui/layout.ts';

/**
 * Pause and resume of running scripts shared with the viewer: pausing also stops the path
 * tracer's accumulation; `wait()` is the promise a paused script waits for.
 */
export interface ScriptRunControl {
  pause(): boolean;
  resume(): boolean;
  wait(): Promise<void> | undefined;
}

export interface ScriptEditorOptions {
  library: Promise<ScriptLibrary>;
  /** Apply the generated MaterialX document to the scene. */
  onApply?: (xml: string) => Promise<void> | void;
  /** Material of the selected object, as resolved by the engine. */
  currentMaterial?: () => Promise<{ graph: ResolvedGraph; name: string }> | { graph: ResolvedGraph; name: string };
  /** Viewer operations for `scene`, `render`, `assign` in scripts run with « Appliquer ». */
  host?: ScriptHost;
  /** `fileprefix` used for relative texture paths in applied documents. */
  filePrefix?: string;
  /** Initial script; by default the saved draft, else DEFAULT_SCRIPT. */
  initialScript?: string;
  /** Ready-made scripts offered in the « Scripts » menu, e.g. examples/scripts/*.js. */
  examples?: readonly { label: string; code: string }[];
  /** Where frames of « Rendu distant » are shown (docs/REMOTE_RENDER.md); without it the section is hidden. */
  remoteView?: HTMLElement | null;
  /** Pause/resume shared with the viewer; without it, pausing only holds the script. */
  runControl?: ScriptRunControl;
  /** Layout element the panel is docked in (as its last child); without it the panel floats over the page. */
  dock?: HTMLElement | null;
}

export const DEFAULT_SCRIPT = `// Matériau procédural : un bruit fractal mélange deux couleurs.
noise = new Fractal3d("float");
noise.octaves = 4;

blend = new Mix();
blend.fg = [0.8, 0.35, 0.1];
blend.bg = [0.1, 0.15, 0.4];
blend.mix = noise.out;

surface = new StandardSurface();
surface.base_color = blend.out;
surface.specular_roughness = 0.3;
surface.thin_walled = false;
`;

const IDENT = '[A-Za-z_$][\\w$]*';
const DECLARED_NODE = new RegExp(`(?:^|[;{}\\s])(?:(?:const|let|var)\\s+)?(${IDENT})\\s*=\\s*new\\s+(${IDENT})\\s*\\(\\s*(?:(["'])([^"'\\n]*)\\3)?`, 'g');
const TOKEN = new RegExp([
  String.raw`(\/\/[^\n]*|\/\*[\s\S]*?\*\/)`,
  String.raw`("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)`,
  String.raw`(\b\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+)`,
  String.raw`\b(new|const|let|var|true|false|for|if|else|function|return|of|in)\b`,
  `(${IDENT})\\.(${IDENT})`,
  `(${IDENT})`,
].join('|'), 'g');

export const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Variables bound to `new Node(...)` in `code`, resolved against the library. */
export function scriptVariables(code: string, library: ScriptLibrary): Map<string, ScriptNodeDef> {
  const variables = new Map<string, ScriptNodeDef>();
  for (const match of code.matchAll(DECLARED_NODE)) {
    const category = library.categoryOf(match[2]!);
    if (category === undefined) continue;
    try { variables.set(match[1]!, library.resolve(category, match[4] || undefined)); } catch { /* invalid variant */ }
  }
  return variables;
}

/** A colored span of a script: comment, string, number, keyword, node, var, builtin, input, output, member or error. */
export interface ScriptToken {
  from: number;
  to: number;
  kind: string;
}

/** Tokens of `code`; known nodes, inputs and outputs get their own kinds. */
export function scriptTokens(code: string, library: ScriptLibrary | undefined): ScriptToken[] {
  const variables = library ? scriptVariables(code, library) : new Map<string, ScriptNodeDef>();
  const tokens: ScriptToken[] = [];
  const push = (from: number, text: string, kind: string | undefined): void => {
    if (kind) tokens.push({ from, to: from + text.length, kind });
  };
  const identifierKind = (name: string): string | undefined => {
    if (variables.has(name)) return 'var';
    if (library?.categoryOf(name) !== undefined) return 'node';
    if (SCRIPT_FUNCTIONS[name]) return 'builtin';
    return undefined;
  };
  for (const match of code.matchAll(TOKEN)) {
    const start = match.index;
    const [text, comment, string, number, keyword, owner, member, name] = match;
    if (comment) push(start, text, 'comment');
    else if (string) push(start, text, 'string');
    else if (number) push(start, text, 'number');
    else if (keyword) push(start, text, 'keyword');
    else if (owner && member) {
      const def = variables.get(owner);
      const kind = owner === 'render' && !def ? (member in RENDER_SETTINGS ? 'input' : 'error')
        : !def ? 'member'
          : def.inputs.some(port => port.name === member) || isColorspaceAttribute(def, member) ? 'input'
            : def.outputs.some(port => port.name === member) ? 'output' : 'error';
      push(start, owner, identifierKind(owner));
      push(start + owner.length + 1, member, kind);
    } else push(start, name!, identifierKind(name!));
  }
  return tokens;
}

/** Highlighted HTML for `code`; known nodes, inputs and outputs get their own classes. */
export function highlightScript(code: string, library: ScriptLibrary | undefined): string {
  let html = '';
  let last = 0;
  for (const token of scriptTokens(code, library)) {
    html += `${escapeHtml(code.slice(last, token.from))}<span class="tok-${token.kind}">${escapeHtml(code.slice(token.from, token.to))}</span>`;
    last = token.to;
  }
  return `${html}${escapeHtml(code.slice(last))}\n`;
}

export interface ScriptHover {
  from: number;
  to: number;
  title: string;
  lines: string[];
}

function portLines(port: ScriptPortDef): string[] {
  return [
    ...(port.doc ? [port.doc] : []),
    ...(port.default !== undefined ? [`Défaut : ${formatValue(port.default)}`] : []),
    ...(port.min !== undefined || port.max !== undefined ? [`Plage : ${port.min ?? '−∞'} … ${port.max ?? '+∞'}`] : []),
    ...(port.enum?.length ? [`Valeurs : ${port.enum.join(', ')}`] : []),
  ];
}

/** Documentation of the word at `position`: node classes, node inputs/outputs, viewer functions, render settings, Math. */
export function scriptHover(code: string, position: number, library: ScriptLibrary): ScriptHover | undefined {
  let from = position;
  let to = position;
  while (from > 0 && /[\w$]/.test(code[from - 1]!)) from--;
  while (to < code.length && /[\w$]/.test(code[to]!)) to++;
  const word = code.slice(from, to);
  if (!word || /^\d/.test(word)) return undefined;
  const owner = code[from - 1] === '.' ? /([A-Za-z_$][\w$]*)$/.exec(code.slice(0, from - 1))?.[1] : undefined;
  const variables = scriptVariables(code, library);
  if (owner) {
    const def = variables.get(owner);
    if (!def && owner === 'render') {
      const setting = RENDER_SETTINGS[word];
      return setting && { from, to, title: `render.${word}`, lines: [setting.doc,
        ...(setting.values ? [`Valeurs : ${setting.values.map(value => JSON.stringify(value)).join(', ')}`] : []),
        ...(setting.min !== undefined || setting.max !== undefined ? [`Plage : ${setting.min ?? '−∞'} … ${setting.max ?? '+∞'}`] : [])] };
    }
    if (!def && owner === 'Math') {
      const category = MATH_NODES[word];
      if (!category) return undefined;
      return { from, to, title: `Math.${word}`, lines: [`Sur une sortie de nœud : nœud MaterialX ${category}.`, 'Sur des nombres : calcul JavaScript.'] };
    }
    if (!def) return undefined;
    if (isColorspaceAttribute(def, word)) {
      return { from, to, title: `${owner}.colorspace : attribut`, lines: [`Espace colorimétrique : ${MATERIALX_COLORSPACES.join(', ')}`] };
    }
    const input = def.inputs.find(port => port.name === word);
    if (input) return { from, to, title: `${owner}.${word} : entrée ${input.type}`, lines: [...portLines(input), `NodeDef : ${def.name}`] };
    const output = def.outputs.find(port => port.name === word);
    if (output) return { from, to, title: `${owner}.${word} : sortie ${output.type}`, lines: [`NodeDef : ${def.name}`] };
    return { from, to, title: `${owner}.${word}`, lines: [`${def.name} n’a ni entrée ni sortie « ${word} ».`] };
  }
  const def = variables.get(word);
  if (def) {
    return { from, to, title: `${word} : ${def.className} → ${nodeType(def)}`, lines: [
      ...(def.doc ? [def.doc] : []), `NodeDef : ${def.name}`,
      `Entrées : ${def.inputs.map(port => port.name).join(', ') || 'aucune'}`,
      `Sorties : ${def.outputs.map(port => `${port.name} (${port.type})`).join(', ')}`,
    ] };
  }
  const category = library.categoryOf(word);
  if (category !== undefined) {
    const variants = library.variants(category);
    const types = [...new Set(variants.map(nodeType))];
    return { from, to, title: `new ${word}() : nœud ${category}`, lines: [
      ...(variants[0]?.doc ? [variants[0].doc] : []),
      `Sorties : ${types.join(' | ')} (défaut : ${nodeType(library.resolve(category))})`,
      `Variantes : ${variants.slice(0, 8).map(variant => variant.name).join(', ')}${variants.length > 8 ? ` … (${variants.length})` : ''}`,
    ] };
  }
  const builtin = SCRIPT_FUNCTIONS[word];
  return builtin && { from, to, title: word, lines: [builtin.detail] };
}

export interface Completion {
  label: string;
  detail: string;
  insert: string;
}

/** Completions at the end of `prefix`: node classes after `new`, variants, or ports after `variable.`. */
export function scriptCompletions(prefix: string, code: string, library: ScriptLibrary): { from: number; items: Completion[] } | undefined {
  const rank = (items: Completion[], word: string): Completion[] => {
    const lower = word.toLowerCase();
    return items
      .filter(item => item.label.toLowerCase().includes(lower))
      .sort((a, b) => Number(!a.label.toLowerCase().startsWith(lower)) - Number(!b.label.toLowerCase().startsWith(lower)));
  };
  const variant = new RegExp(`new\\s+(${IDENT})\\(\\s*(["'])(\\w*)$`).exec(prefix);
  if (variant) {
    const category = library.categoryOf(variant[1]!);
    if (category === undefined) return undefined;
    const variants = library.variants(category);
    const types = [...new Set(variants.map(nodeType))].map(type => ({ label: type, detail: 'type de sortie', insert: type }));
    const names = variants.map(def => ({ label: def.name, detail: def.inputs.map(port => `${port.name}: ${port.type}`).join(', '), insert: def.name }));
    return { from: prefix.length - variant[3]!.length, items: rank([...types, ...names], variant[3]!) };
  }
  const created = new RegExp(`\\bnew\\s+(${IDENT})?$`).exec(prefix);
  if (created) {
    const word = created[1] ?? '';
    const items = library.classNames.map((className) => {
      const variants = library.variants(library.categoryOf(className)!);
      const types = [...new Set(variants.map(nodeType))];
      return { label: className, detail: `${variants[0]!.category} → ${types.join(' | ')}`, insert: `${className}()` };
    });
    return { from: prefix.length - word.length, items: rank(items, word).slice(0, 200) };
  }
  const member = new RegExp(`(${IDENT})\\.([\\w$]*)$`).exec(prefix);
  if (member?.[1] === 'render' && !scriptVariables(code, library).has('render')) {
    const items = Object.entries(RENDER_SETTINGS).map(([name, setting]) => ({
      label: name,
      detail: `${setting.doc}${setting.values ? ` : ${setting.values.map(value => JSON.stringify(value)).join(' | ')}` : ''}`,
      insert: name,
    }));
    return { from: prefix.length - member[2]!.length, items: rank(items, member[2]!) };
  }
  if (member?.[1] === 'Math') {
    const items = Object.entries(MATH_NODES).map(([name, category]) => ({ label: name, detail: `nœud ${category} sur une sortie`, insert: `${name}(` }));
    return { from: prefix.length - member[2]!.length, items: rank(items, member[2]!) };
  }
  if (member) {
    const def = scriptVariables(code, library).get(member[1]!);
    if (!def) return undefined;
    const port = (kind: string) => (p: ScriptPortDef): Completion => ({
      label: p.name,
      detail: `${kind} ${p.type}${p.default !== undefined ? ` = ${formatValue(p.default)}` : ''}`,
      insert: p.name,
    });
    const inputs = def.inputs.map(port('entrée'));
    if (isColorspaceAttribute(def, 'colorspace')) inputs.push({ label: 'colorspace', detail: 'attribut string', insert: 'colorspace' });
    const outputs = def.outputs.filter(p => !def.inputs.some(input => input.name === p.name)).map(port('sortie'));
    const rhs = /=\s*$/.test(prefix.slice(0, member.index));
    return { from: prefix.length - member[2]!.length, items: rank(rhs ? [...outputs, ...inputs] : [...inputs, ...outputs], member[2]!) };
  }
  const word = /(?:^|[^\w$.])([A-Za-z]{2,})$/.exec(prefix)?.[1];
  if (word) {
    const items = Object.entries(SCRIPT_FUNCTIONS)
      .filter(([name]) => name.startsWith(word))
      .map(([name, { detail, insert }]) => ({ label: name, detail, insert }));
    if (items.length) return { from: prefix.length - word.length, items };
  }
  return undefined;
}

/** Viewer functions available in scripts, with their completion text. */
export const SCRIPT_FUNCTIONS: Readonly<Record<string, { detail: string; insert: string }>> = {
  scene: { detail: 'await scene("scenes/….usda") : charge une scène', insert: 'await scene("' },
  objects: { detail: 'objects() : chemins des objets de la scène', insert: 'objects()' },
  render: { detail: 'render.backend = … ; await render(64) : relance le rendu', insert: 'render' },
  assign: { detail: 'await assign("/objet", surface) : affecte un matériau', insert: 'await assign("' },
  load: { detail: 'await load("….mtlx") : charge un matériau dans le script', insert: 'await load("' },
  material: { detail: 'material("/objet") : matériau courant d’un objet, modifiable', insert: 'material("' },
  node: { detail: 'node("nom") : nœud du script par son nom', insert: 'node("' },
  save: { detail: 'await save("rendu.png" | "aov.pfm" | "diagnostics.json") ou save("mat.mtlx", surface) : enregistre', insert: 'await save("' },
  log: { detail: 'log(…) : affiche un message', insert: 'log(' },
  check: { detail: 'check(condition, "message") : vérification (ignorée pendant la validation)', insert: 'check(' },
  stats: { detail: 'stats() : échantillons, bruit, débit, arrêt, repli, mémoire GPU', insert: 'stats()' },
  converge: { detail: 'await converge(600) : attend l’arrêt (convergence ou budget de temps)', insert: 'await converge(' },
  capture: { detail: 'await capture("flou.png", { samples: 64, shutter: [0, 4] }) : rendu path tracing enregistré', insert: 'await capture("' },
  diagnostics: { detail: 'diagnostics() : journal des diagnostics { level, code, message }', insert: 'diagnostics()' },
  capabilities: { detail: 'capabilities() : adaptateur, limites et backends pris en charge', insert: 'capabilities()' },
  timeline: { detail: 'timeline() : { start, end, fps } d’une scène animée', insert: 'timeline()' },
  time: { detail: 'time() : code temporel courant', insert: 'time()' },
  setTime: { detail: 'await setTime(t) : évalue la scène animée à t', insert: 'await setTime(' },
  transform: { detail: 'transform({ translate, rotate, scale }) : matrice 4×4 (degrés)', insert: 'transform({ ' },
  setTransform: { detail: 'setTransform("/objet", matrice) : déplace un objet (sans matrice : restaure)', insert: 'setTransform("' },
  setVisibility: { detail: 'setVisibility("/objet", false) : masque ou affiche un objet', insert: 'setVisibility("' },
  lights: { detail: 'lights() : lumières { path, type }', insert: 'lights()' },
  setLight: { detail: 'setLight("/lumière", { intensity, exposure, color, transform })', insert: 'setLight("' },
  setCamera: { detail: 'setCamera({ eye, target, fov }) : place la caméra (fov en degrés)', insert: 'setCamera({ eye: [' },
  variants: { detail: 'variants() : variant sets { path, set, variants, selection }', insert: 'variants()' },
  setVariant: { detail: 'await setVariant("/prim", "set", "variante")', insert: 'await setVariant("' },
  materialParameters: { detail: 'materialParameters("/objet") : paramètres { id, label, type, value }', insert: 'materialParameters("' },
  setMaterialParameters: { detail: 'await setMaterialParameters("/objet", { id: valeur })', insert: 'await setMaterialParameters("' },
};

function formatNumber(value: number): string {
  return String(Number(value.toFixed(4)));
}

export function formatValue(value: ScriptValue): string {
  if (Array.isArray(value)) return `[${value.map(formatNumber).join(', ')}]`;
  if (typeof value === 'number') return formatNumber(value);
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

export function parseLiteral(text: string): unknown {
  try { return JSON.parse(text.trim().replace(/^'(.*)'$/, '"$1"')); } catch { return undefined; }
}

export const toHex = (rgb: readonly number[]): string =>
  `#${rgb.slice(0, 3).map(c => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')}`;
export const fromHex = (hex: string): number[] =>
  [1, 3, 5].map(i => Number((parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)));

/** `node.input = value` line: indent/declaration, node, input, ` = `, value, trailing ; and comment. */
export const ASSIGNMENT = new RegExp(`^(\\s*(?:(?:const|let|var)\\s+)?)?\\s*(${IDENT})\\.(${IDENT})(\\s*=\\s*)([^;\\n]*?)(\\s*;?\\s*(?:\\/\\/.*)?)$`);


export interface ScriptEditorAttachment {
  /** The editor, created (and its CodeMirror code loaded) on first use. */
  readonly editor: Promise<MaterialXScriptEditor>;
  toggle(visible?: boolean): Promise<void>;
}

/**
 * Add the « Script » button to the activity bar (`toolbar`) and the F2 shortcut. The panel docks in
 * `options.dock` and reopens if it was open on the last visit. A `#script=…` page address (share
 * link) opens the editor with that script, which is never run automatically.
 */
export function attachScriptEditor(toolbar: HTMLElement | null, options: ScriptEditorOptions): ScriptEditorAttachment {
  let editor: Promise<MaterialXScriptEditor> | undefined;
  const button = activityButton(document.createElement('button'), 'code', 'Éditeur de script MaterialX (F2)', 'Script');
  button.type = 'button';
  button.id = 'open-script-editor';
  button.setAttribute('aria-expanded', 'false');
  const attachment: ScriptEditorAttachment = {
    get editor() {
      editor ??= import('./script-editor-view.ts').then(({ MaterialXScriptEditor: Editor }) => {
        const created = new Editor(options);
        created.element.hidden = true;
        created.element.addEventListener('script-editor-close', () => void attachment.toggle(false));
        (options.dock ?? document.body).append(created.element);
        return created;
      });
      return editor;
    },
    async toggle(visible) {
      const panel = (await attachment.editor).element;
      panel.hidden = !(visible ?? panel.hidden);
      button.setAttribute('aria-expanded', String(!panel.hidden));
      rememberPanel('script', !panel.hidden);
      if (!panel.hidden) (await attachment.editor).focus();
    },
  };
  button.addEventListener('click', () => void attachment.toggle());
  toolbar?.append(button);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'F2') {
      event.preventDefault();
      void attachment.toggle();
    }
  });
  void sharedScriptOf().then(async (code) => {
    if (code === undefined) {
      if (panelVisible('script', false)) await attachment.toggle(true);
      return;
    }
    // The link is consumed: a reload keeps the editor's draft instead of reopening the link.
    history.replaceState(history.state, '', location.pathname + location.search);
    const opened = await attachment.editor;
    opened.loadShared(code);
    await attachment.toggle(true);
  }, async (error: unknown) => {
    const opened = await attachment.editor;
    opened.report(error);
    await attachment.toggle(true);
  });
  return attachment;
}
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `code` with `node.input = expression;`: the input's last assignment is rewritten (keeping its
 * indentation and comment), or a line is added after the node's last assignment (else after
 * `nodeLine`, the line creating it, else at the end). Without `expression`, its assignments are removed.
 */
export function setScriptInput(code: string, node: string, input: string, expression: string | undefined, nodeLine?: number): string {
  const lines = code.split('\n');
  const assignment = new RegExp(`^(\\s*)${escapeRegExp(node)}\\.${escapeRegExp(input)}\\s*=(?!=).*?(?:;\\s*(\\/\\/.*))?\\s*;?\\s*$`);
  const indices = lines.flatMap((line, index) => assignment.test(line) ? [index] : []);
  if (expression === undefined) return lines.filter((_, index) => !indices.includes(index)).join('\n');
  const last = indices.at(-1);
  if (last !== undefined) {
    const match = assignment.exec(lines[last]!)!;
    lines[last] = `${match[1]}${node}.${input} = ${expression};${match[2] ? ` ${match[2]}` : ''}`;
    return lines.join('\n');
  }
  const member = new RegExp(`^\\s*${escapeRegExp(node)}\\.[\\w$]+\\s*=(?!=)`);
  let after = nodeLine !== undefined && nodeLine >= 1 && nodeLine <= lines.length ? nodeLine - 1 : -1;
  lines.forEach((line, index) => { if (member.test(line)) after = Math.max(after, index); });
  const statement = `${after >= 0 ? /^\s*/.exec(lines[after]!)![0] : ''}${node}.${input} = ${expression};`;
  if (after < 0) {
    if (lines.at(-1) === '') lines.splice(lines.length - 1, 0, statement);
    else lines.push(statement);
  } else lines.splice(after + 1, 0, statement);
  return lines.join('\n');
}

/** Script expression of a literal value (`[0.8, 0.2, 0.1]`, `0.5`, `true`, `"text"`). */
export function scriptLiteral(value: ScriptValue): string {
  return formatValue(value);
}
/**
 * `code` with a new `variable = new ClassName("nodedef");` feeding `node.input` from its `output`,
 * inserted just before the assignment. Returns the new code and the variable.
 */
export function addScriptUpstream(
  code: string, node: string, input: string, def: Pick<ScriptNodeDef, 'name' | 'category' | 'className'>, output: string, nodeLine?: number,
): { code: string; variable: string } {
  const base = def.category.replace(/[^\w$]/g, '_').replace(/^(\d)/, '_$1');
  let variable = base;
  for (let i = 2; new RegExp(`(^|[^\\w$.])${escapeRegExp(variable)}(?![\\w$])`).test(code); i++) variable = `${base}${i}`;
  const linked = setScriptInput(code, node, input, `${variable}.${output}`, nodeLine);
  const lines = linked.split('\n');
  const assignment = new RegExp(`^(\\s*)${escapeRegExp(node)}\\.${escapeRegExp(input)}\\s*=\\s*${escapeRegExp(variable)}\\.`);
  const index = lines.findIndex(line => assignment.test(line));
  const indent = index >= 0 ? assignment.exec(lines[index]!)![1] : '';
  lines.splice(index >= 0 ? index : lines.length, 0, `${indent}${variable} = new ${def.className}(${JSON.stringify(def.name)});`);
  return { code: lines.join('\n'), variable };
}