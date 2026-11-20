// Material script editor: syntax highlighting, NodeDef-driven completions, value
// helpers for the input under the caret, and script ⇄ MaterialX XML conversion.

import {
  acceptsValue, fromResolvedGraph, fromXml, inlineIncludes, isColorspaceAttribute, MATERIALX_COLORSPACES, nodeType, runScript,
  ScriptError, toScript, toXml, type ScriptHost, type ScriptLibrary, type ScriptNodeDef, type ScriptPortDef, type ScriptRun,
  type ScriptValue,
} from './script-api.ts';
import type { ResolvedGraph } from './graph.ts';

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
  initialScript?: string;
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

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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

/** Highlighted HTML for `code`; known nodes, inputs and outputs get their own classes. */
export function highlightScript(code: string, library: ScriptLibrary | undefined): string {
  const variables = library ? scriptVariables(code, library) : new Map<string, ScriptNodeDef>();
  const span = (kind: string, text: string): string => `<span class="tok-${kind}">${escapeHtml(text)}</span>`;
  const identifier = (name: string): string => {
    if (variables.has(name)) return span('var', name);
    if (library?.categoryOf(name) !== undefined) return span('node', name);
    return escapeHtml(name);
  };
  let html = '';
  let last = 0;
  for (const match of code.matchAll(TOKEN)) {
    html += escapeHtml(code.slice(last, match.index));
    last = match.index + match[0].length;
    const [text, comment, string, number, keyword, owner, member, name] = match;
    if (comment) html += span('comment', text);
    else if (string) html += span('string', text);
    else if (number) html += span('number', text);
    else if (keyword) html += span('keyword', text);
    else if (owner && member) {
      const def = variables.get(owner);
      const kind = !def ? 'member'
        : def.inputs.some(port => port.name === member) || isColorspaceAttribute(def, member) ? 'input'
          : def.outputs.some(port => port.name === member) ? 'output' : 'error';
      html += `${identifier(owner)}.${span(kind, member)}`;
    } else html += identifier(name!);
  }
  return `${html}${escapeHtml(code.slice(last))}\n`;
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
  return undefined;
}

function formatNumber(value: number): string {
  return String(Number(value.toFixed(4)));
}

function formatValue(value: ScriptValue): string {
  if (Array.isArray(value)) return `[${value.map(formatNumber).join(', ')}]`;
  if (typeof value === 'number') return formatNumber(value);
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function parseLiteral(text: string): unknown {
  try { return JSON.parse(text.trim().replace(/^'(.*)'$/, '"$1"')); } catch { return undefined; }
}

const toHex = (rgb: readonly number[]): string =>
  `#${rgb.slice(0, 3).map(c => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (hex: string): number[] =>
  [1, 3, 5].map(i => Number((parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)));

const ASSIGNMENT = new RegExp(`^(\\s*(?:(?:const|let|var)\\s+)?)?\\s*(${IDENT})\\.(${IDENT})(\\s*=\\s*)([^;\\n]*?)(\\s*;?\\s*(?:\\/\\/.*)?)$`);

const STYLE = `
#script-editor-panel { position: fixed; top: 0; right: 0; bottom: 0; width: min(560px, 100vw); z-index: 1000;
  display: flex; flex-direction: column; gap: 6px; padding: 8px; box-sizing: border-box; background: #1e1e1e; color: #ddd;
  font: 13px system-ui, sans-serif; box-shadow: -4px 0 16px rgba(0, 0, 0, 0.5); }
#script-editor-panel[hidden] { display: none; }
#script-editor-panel header { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
#script-editor-panel header strong { flex: 1; }
#script-editor-panel button { background: #333; color: #eee; border: 1px solid #555; border-radius: 4px; padding: 4px 8px; cursor: pointer; }
#script-editor-panel button:hover { background: #444; }
#script-editor-panel button.primary { background: #0e639c; border-color: #1177bb; }
.mx-code { position: relative; flex: 3; min-height: 160px; border: 1px solid #444; border-radius: 4px; overflow: hidden; }
.mx-code pre, .mx-code textarea { position: absolute; inset: 0; margin: 0; padding: 8px; box-sizing: border-box; border: 0;
  font: 13px/18px Consolas, 'Courier New', monospace; tab-size: 2; white-space: pre; overflow: auto; }
.mx-code pre { pointer-events: none; color: #d4d4d4; background: #1e1e1e; }
.mx-code textarea { resize: none; color: transparent; background: transparent; caret-color: #fff; outline: none; }
.mx-code textarea::selection { background: rgba(38, 79, 120, 0.8); color: transparent; }
.tok-comment { color: #6a9955; } .tok-string { color: #ce9178; } .tok-number { color: #b5cea8; }
.tok-keyword { color: #569cd6; } .tok-node { color: #4ec9b0; } .tok-var { color: #9cdcfe; }
.tok-input { color: #dcdcaa; } .tok-output { color: #c586c0; } .tok-member { color: #d4d4d4; }
.tok-error { color: #f48771; text-decoration: wavy underline; }
.mx-completions { position: absolute; z-index: 2; margin: 0; padding: 2px 0; list-style: none; max-height: 220px; min-width: 260px;
  overflow: auto; background: #252526; border: 1px solid #454545; font: 12px Consolas, monospace; }
.mx-completions li { display: flex; gap: 12px; justify-content: space-between; padding: 2px 8px; cursor: pointer; white-space: nowrap; }
.mx-completions li span { color: #888; overflow: hidden; text-overflow: ellipsis; max-width: 320px; }
.mx-completions li[aria-selected="true"] { background: #04395e; }
.mx-helper { display: flex; gap: 8px; align-items: center; min-height: 28px; padding: 2px 6px; border-radius: 4px; background: #252526; }
.mx-helper[hidden] { display: none; }
.mx-helper code { color: #dcdcaa; }
.mx-helper input[type="number"] { width: 72px; }
.mx-helper input[type="range"] { flex: 1; }
.mx-status { min-height: 18px; max-height: 4.5em; overflow: auto; flex-shrink: 0; color: #89d185; white-space: pre-wrap; }
.mx-status.error { color: #f48771; }
.mx-xml { flex: 2; min-height: 100px; resize: none; padding: 8px; border: 1px solid #444; border-radius: 4px;
  background: #1a1a1a; color: #ce9178; font: 12px/16px Consolas, monospace; white-space: pre; }
`;

export class MaterialXScriptEditor {
  readonly element: HTMLElement;
  #library: ScriptLibrary | undefined;
  readonly #options: ScriptEditorOptions;
  readonly #code: HTMLTextAreaElement;
  readonly #highlight: HTMLPreElement;
  readonly #completions: HTMLUListElement;
  readonly #helper: HTMLElement;
  readonly #status: HTMLElement;
  readonly #xml: HTMLTextAreaElement;
  #items: Completion[] = [];
  #from = 0;
  #selected = 0;
  #validateTimer: ReturnType<typeof setTimeout> | undefined;
  #validation = 0;
  readonly #documents = new Map<string, Promise<string>>();
  #helperLine = -1;

  constructor(options: ScriptEditorOptions) {
    this.#options = options;
    if (!document.getElementById('mx-script-style')) {
      const style = document.createElement('style');
      style.id = 'mx-script-style';
      style.textContent = STYLE;
      document.head.append(style);
    }
    this.element = document.createElement('aside');
    this.element.id = 'script-editor-panel';
    this.element.setAttribute('aria-label', 'Éditeur de script MaterialX');
    this.element.innerHTML = `
      <header>
        <strong>Script MaterialX</strong>
        <button type="button" class="primary" data-action="apply" data-testid="script-apply" title="Ctrl+Entrée">Appliquer</button>
        <button type="button" data-action="from-material" data-testid="script-from-material"
          title="Convertir le matériau de l’objet sélectionné en script">Matériau → Script</button>
        <button type="button" data-action="to-xml" data-testid="script-to-xml">Script → XML</button>
        <button type="button" data-action="from-xml" data-testid="script-from-xml">XML → Script</button>
        <button type="button" data-action="export" data-testid="script-export">Exporter .mtlx</button>
        <button type="button" data-action="close" data-testid="script-close" aria-label="Fermer" title="Échap">✕</button>
      </header>
      <div class="mx-code">
        <pre aria-hidden="true" data-testid="script-highlight"></pre>
        <textarea spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Script" data-testid="script-code"></textarea>
        <ul class="mx-completions" role="listbox" data-testid="script-completions" hidden></ul>
      </div>
      <div class="mx-helper" data-testid="script-value-helper" hidden></div>
      <div class="mx-status" role="status" data-testid="script-status"></div>
      <textarea class="mx-xml" spellcheck="false" aria-label="Document MaterialX" data-testid="script-xml"
        placeholder="Document MaterialX : « Script → XML » pour le générer, ou collez un document puis « XML → Script »."></textarea>`;
    this.#code = this.element.querySelector('[data-testid="script-code"]')!;
    this.#highlight = this.element.querySelector('[data-testid="script-highlight"]')!;
    this.#completions = this.element.querySelector('[data-testid="script-completions"]')!;
    this.#helper = this.element.querySelector('[data-testid="script-value-helper"]')!;
    this.#status = this.element.querySelector('[data-testid="script-status"]')!;
    this.#xml = this.element.querySelector('[data-testid="script-xml"]')!;
    this.#code.value = options.initialScript ?? DEFAULT_SCRIPT;
    this.#bind();
    this.#render();
    this.#setStatus('Chargement des NodeDefs MaterialX...');
    options.library.then((library) => {
      this.#library = library;
      this.#render();
      void this.#validate();
    }, (error: unknown) => this.#setStatus(`Bibliothèque MaterialX indisponible : ${error instanceof Error ? error.message : String(error)}`, true));
  }

  get script(): string {
    return this.#code.value;
  }

  set script(code: string) {
    this.#code.value = code;
    this.#changed();
  }

  focus(): void {
    this.#code.focus();
  }

  /** Run the script without viewer side effects and return its MaterialX document. */
  async generateXml(options: { filePrefix?: string } = {}): Promise<string> {
    const library = this.#library ?? await this.#options.library;
    return toXml(await this.#dryRun(library), library, options);
  }

  /** Dry run: viewer operations are only validated; loaded documents are cached between runs. */
  #dryRun(library: ScriptLibrary): Promise<ScriptRun> {
    const fetchText = (url: string): Promise<string> => {
      let text = this.#documents.get(url);
      if (!text) {
        text = fetch(url).then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
          return response.text();
        });
        text.catch(() => this.#documents.delete(url));
        this.#documents.set(url, text);
      }
      return text;
    };
    return runScript(this.#code.value, library, { fetchText });
  }

  /**
   * Execute the script on the viewer. A script that does not drive the viewer (`scene`, `assign`,
   * `render`, settings) applies its material to the selected object.
   */
  async apply(): Promise<void> {
    await this.#guard('Matériau appliqué.', async () => {
      const library = this.#library ?? await this.#options.library;
      const prefix = this.#options.filePrefix;
      const run = await runScript(this.#code.value, library, {
        ...(this.#options.host ? { host: this.#options.host } : {}), ...(prefix ? { filePrefix: prefix } : {}),
      });
      this.#xml.value = toXml(run, library);
      if (run.viewerCommands) return 'Script exécuté.';
      await this.#options.onApply?.(toXml(run, library, prefix ? { filePrefix: prefix } : {}));
      return undefined;
    });
  }

  async scriptToXml(): Promise<void> {
    await this.#guard('Document MaterialX généré.', async () => { this.#xml.value = await this.generateXml(); });
  }

  async xmlToScript(): Promise<void> {
    await this.#guard('Script généré depuis le document MaterialX.', async () => {
      const library = this.#library ?? await this.#options.library;
      const xml = await inlineIncludes(this.#xml.value, document.baseURI);
      this.#code.value = toScript(fromXml(xml, library), library);
      // The generated script is valid; a pending validation must not replace the status.
      this.#changed(false);
    });
  }

  async materialToScript(): Promise<void> {
    await this.#guard('Script généré depuis le matériau de l’objet sélectionné.', async () => {
      const current = await this.#options.currentMaterial?.();
      if (!current) throw new Error('Aucun matériau disponible pour l’objet sélectionné.');
      const library = this.#library ?? await this.#options.library;
      const graph = fromResolvedGraph(current.graph, library, current.name);
      this.#code.value = toScript(graph, library);
      this.#xml.value = toXml(graph, library);
      this.#changed(false);
    });
  }

  async export(): Promise<void> {
    await this.#guard('Document exporté.', async () => {
      const xml = await this.generateXml();
      this.#xml.value = xml;
      const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
      const link = Object.assign(document.createElement('a'), { href: url, download: 'material.mtlx' });
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    });
  }

  /** Run an editor action; it may return a status message replacing `success`. */
  async #guard(success: string, action: () => Promise<string | void | undefined>): Promise<void> {
    clearTimeout(this.#validateTimer);
    // Results of validations started before this action are obsolete.
    this.#validation++;
    try {
      this.#setStatus((await action()) ?? success);
    } catch (error) {
      this.#setStatus(this.#describe(error), true);
    }
  }

  #describe(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return error instanceof ScriptError && error.line !== undefined ? `Ligne ${error.line} : ${message}` : message;
  }

  #setStatus(text: string, error = false): void {
    this.#status.textContent = text;
    this.#status.classList.toggle('error', error);
  }

  #bind(): void {
    this.element.addEventListener('click', (event) => {
      const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]')?.dataset['action'];
      if (action === 'apply') void this.apply();
      else if (action === 'to-xml') void this.scriptToXml();
      else if (action === 'from-xml') void this.xmlToScript();
      else if (action === 'from-material') void this.materialToScript();
      else if (action === 'export') void this.export();
      else if (action === 'close') this.element.dispatchEvent(new CustomEvent('script-editor-close', { bubbles: true }));
    });
    // Keep viewer shortcuts from reacting to typing in the editor.
    this.element.addEventListener('keydown', event => event.stopPropagation());
    this.#code.addEventListener('input', (event) => {
      this.#changed();
      const typed = (event as InputEvent).data ?? '';
      if (/[\w.$"' ]/.test(typed.slice(-1))) this.#complete(false);
      else this.#closeCompletions();
    });
    this.#code.addEventListener('scroll', () => {
      this.#highlight.scrollTop = this.#code.scrollTop;
      this.#highlight.scrollLeft = this.#code.scrollLeft;
      this.#closeCompletions();
    });
    this.#code.addEventListener('keydown', event => this.#keydown(event));
    this.#code.addEventListener('blur', () => setTimeout(() => this.#closeCompletions(), 150));
    for (const type of ['click', 'keyup', 'focus'] as const) this.#code.addEventListener(type, () => this.#updateHelper());
    this.#completions.addEventListener('mousedown', (event) => {
      const item = (event.target as HTMLElement).closest('li');
      if (!item) return;
      event.preventDefault();
      this.#accept(Number(item.dataset['index']));
    });
  }

  #keydown(event: KeyboardEvent): void {
    const open = !this.#completions.hidden;
    if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      this.#select(this.#selected + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (open && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault();
      this.#accept(this.#selected);
    } else if (open && event.key === 'Escape') {
      event.preventDefault();
      this.#closeCompletions();
    } else if (event.key === ' ' && event.ctrlKey) {
      event.preventDefault();
      this.#complete(true);
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void this.apply();
    } else if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      this.#insert(this.#code.selectionStart, this.#code.selectionEnd, '  ');
    } else if (event.key === 'Escape') {
      this.element.dispatchEvent(new CustomEvent('script-editor-close', { bubbles: true }));
    }
  }

  #insert(from: number, to: number, text: string): void {
    this.#code.focus();
    this.#code.setSelectionRange(from, to);
    // execCommand keeps the native undo stack; fall back to a direct edit.
    if (!document.execCommand('insertText', false, text)) {
      this.#code.setRangeText(text, from, to, 'end');
      this.#changed();
    }
  }

  #changed(validate = true): void {
    this.#render();
    this.#updateHelper();
    clearTimeout(this.#validateTimer);
    if (validate) this.#validateTimer = setTimeout(() => void this.#validate(), 250);
  }

  #render(): void {
    this.#highlight.innerHTML = highlightScript(this.#code.value, this.#library);
    this.#highlight.scrollTop = this.#code.scrollTop;
  }

  async #validate(): Promise<void> {
    if (!this.#library) return;
    const validation = ++this.#validation;
    try {
      const run = await this.#dryRun(this.#library);
      if (validation !== this.#validation) return;
      const count = run.nodes.length;
      const commands = run.viewerCommands ? `, ${run.viewerCommands} commande${run.viewerCommands > 1 ? 's' : ''} viewer` : '';
      this.#setStatus(`✓ Script valide : ${count} nœud${count > 1 ? 's' : ''}${commands}.`);
    } catch (error) {
      if (validation === this.#validation) this.#setStatus(this.#describe(error), true);
    }
  }

  #complete(explicit: boolean): void {
    if (!this.#library) return;
    const caret = this.#code.selectionStart;
    const prefix = this.#code.value.slice(0, caret);
    const result = scriptCompletions(prefix, this.#code.value, this.#library);
    if (!result || !result.items.length || (!explicit && result.from === caret && !/(?:\bnew\s+|\.|\(\s*["'])$/.test(prefix))) {
      this.#closeCompletions();
      return;
    }
    this.#items = result.items;
    this.#from = result.from;
    this.#completions.innerHTML = result.items.map((item, index) =>
      `<li role="option" data-index="${index}" data-testid="script-completion"><b>${escapeHtml(item.label)}</b><span>${escapeHtml(item.detail)}</span></li>`).join('');
    const lines = prefix.split('\n');
    const style = getComputedStyle(this.#code);
    const lineHeight = parseFloat(style.lineHeight) || 18;
    const context = document.createElement('canvas').getContext('2d');
    if (context) context.font = `${style.fontSize} ${style.fontFamily}`;
    const charWidth = context?.measureText('M').width || 7.8;
    const column = lines.at(-1)!.replace(/\t/g, '  ').length;
    this.#completions.style.top = `${8 + lines.length * lineHeight - this.#code.scrollTop + 2}px`;
    this.#completions.style.left = `${Math.max(0, 8 + column * charWidth - this.#code.scrollLeft)}px`;
    this.#completions.hidden = false;
    this.#select(0);
  }

  #select(index: number): void {
    this.#selected = (index + this.#items.length) % this.#items.length;
    this.#completions.querySelectorAll('li').forEach((item, i) => item.setAttribute('aria-selected', String(i === this.#selected)));
    this.#completions.children[this.#selected]?.scrollIntoView({ block: 'nearest' });
  }

  #accept(index: number): void {
    const item = this.#items[index];
    if (!item) return;
    this.#closeCompletions();
    const caret = this.#code.selectionStart;
    let end = caret;
    while (/[\w$]/.test(this.#code.value[end] ?? '')) end++;
    this.#insert(this.#from, end, item.insert);
    if (item.insert.endsWith('()')) {
      const position = this.#code.selectionStart - 1;
      this.#code.setSelectionRange(position, position);
    }
    this.#updateHelper();
  }

  #closeCompletions(): void {
    this.#completions.hidden = true;
    this.#items = [];
  }

  /** Show a value editor for the `node.input = value` line under the caret. */
  #updateHelper(): void {
    const library = this.#library;
    const text = this.#code.value;
    const lineIndex = text.slice(0, this.#code.selectionStart).split('\n').length - 1;
    const match = ASSIGNMENT.exec(text.split('\n')[lineIndex] ?? '');
    const def = library && match ? scriptVariables(text, library).get(match[2]!) : undefined;
    const port = def && isColorspaceAttribute(def, match![3]!)
      ? { name: 'colorspace', type: 'string', default: '', enum: MATERIALX_COLORSPACES }
      : def?.inputs.find(input => input.name === match![3]);
    if (!port || !acceptsValue(port.type)) {
      this.#helper.hidden = true;
      this.#helperLine = -1;
      return;
    }
    const literal = parseLiteral(match![5]!);
    if (lineIndex === this.#helperLine && this.#helper.contains(document.activeElement)) return;
    this.#helperLine = lineIndex;
    const value = literal ?? port.default;
    this.#helper.replaceChildren();
    const label = document.createElement('code');
    label.textContent = `${match![2]}.${port.name} : ${port.type}`;
    this.#helper.append(label);
    if (literal === undefined && match![5]!.trim()) {
      const info = document.createElement('span');
      info.textContent = `expression : ${match![5]!.trim()}`;
      this.#helper.append(info);
      this.#helper.hidden = false;
      return;
    }
    const write = (next: ScriptValue): void => this.#writeValue(lineIndex, next);
    const input = (type: string, attributes: Record<string, string>, testId: string): HTMLInputElement => {
      const element = Object.assign(document.createElement('input'), { type });
      for (const [key, attribute] of Object.entries(attributes)) element.setAttribute(key, attribute);
      element.dataset['testid'] = testId;
      this.#helper.append(element);
      return element;
    };
    const vector = Array.isArray(value) ? value as readonly number[] : undefined;
    if ((port.type === 'color3' || port.type === 'color4') && vector) {
      const picker = input('color', { value: toHex(vector), title: 'Choisir la couleur' }, 'helper-color');
      picker.addEventListener('input', () => write([...fromHex(picker.value), ...vector.slice(3)]));
    } else if (port.type === 'boolean') {
      const box = input('checkbox', {}, 'helper-boolean');
      box.checked = value === true;
      box.addEventListener('change', () => write(box.checked));
    } else if (port.type === 'float' || port.type === 'integer') {
      const current = typeof value === 'number' ? value : 0;
      const min = port.min ?? (port.type === 'integer' ? 0 : Math.min(0, current));
      const max = port.max ?? Math.max(port.type === 'integer' ? 10 : 1, current);
      const step = port.type === 'integer' ? '1' : String((max - min) / 1000);
      const range = input('range', { min: String(min), max: String(max), step, value: String(current) }, 'helper-range');
      const number = input('number', { step: port.type === 'integer' ? '1' : 'any', value: String(current) }, 'helper-number');
      const update = (source: HTMLInputElement): void => {
        const next = port.type === 'integer' ? Math.round(Number(source.value)) : Number(source.value);
        if (!Number.isFinite(next)) return;
        range.value = number.value = String(next);
        write(next);
      };
      range.addEventListener('input', () => update(range));
      number.addEventListener('input', () => update(number));
    } else if (port.enum && typeof value === 'string') {
      const select = document.createElement('select');
      select.dataset['testid'] = 'helper-enum';
      for (const option of port.enum) select.append(new Option(option, option, false, option === value));
      select.addEventListener('change', () => write(select.value));
      this.#helper.append(select);
    } else if (vector) {
      const fields = vector.map((component, i) => input('number', { step: 'any', value: String(component), 'aria-label': `composante ${i}` }, 'helper-vector'));
      for (const field of fields) field.addEventListener('input', () => write(fields.map(f => Number(f.value) || 0)));
    } else {
      const field = input('text', { value: String(value ?? '') }, 'helper-text');
      field.addEventListener('change', () => write(field.value));
    }
    this.#helper.hidden = false;
  }

  #writeValue(lineIndex: number, value: ScriptValue): void {
    const lines = this.#code.value.split('\n');
    const match = ASSIGNMENT.exec(lines[lineIndex] ?? '');
    if (!match) return;
    lines[lineIndex] = `${match[1] ?? ''}${match[2]}.${match[3]}${match[4]}${formatValue(value)}${match[6] || ';'}`;
    const { scrollTop } = this.#code;
    this.#code.value = lines.join('\n');
    const caret = lines.slice(0, lineIndex + 1).join('\n').length;
    this.#code.setSelectionRange(caret, caret);
    this.#code.scrollTop = scrollTop;
    this.#changed();
  }
}

export interface ScriptEditorAttachment {
  editor: MaterialXScriptEditor;
  toggle(visible?: boolean): void;
}

/** Add the script editor panel, its toolbar button and the F2 shortcut to the page. */
export function attachScriptEditor(toolbar: HTMLElement | null, options: ScriptEditorOptions): ScriptEditorAttachment {
  let editor: MaterialXScriptEditor | undefined;
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'open-script-editor';
  button.textContent = 'Script';
  button.title = 'Éditeur de script MaterialX (F2)';
  button.setAttribute('aria-expanded', 'false');
  const attachment: ScriptEditorAttachment = {
    get editor() {
      if (!editor) {
        editor = new MaterialXScriptEditor(options);
        editor.element.hidden = true;
        editor.element.addEventListener('script-editor-close', () => attachment.toggle(false));
        document.body.append(editor.element);
      }
      return editor;
    },
    toggle(visible) {
      const panel = attachment.editor.element;
      panel.hidden = !(visible ?? panel.hidden);
      button.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) attachment.editor.focus();
    },
  };
  button.addEventListener('click', () => attachment.toggle());
  toolbar?.append(button);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'F2') {
      event.preventDefault();
      attachment.toggle();
    }
  });
  return attachment;
}
