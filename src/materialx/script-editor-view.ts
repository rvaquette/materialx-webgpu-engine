// CodeMirror 6 editor for material scripts (docs/SCRIPTING.md): NodeDef-aware highlighting,
// completions, hover documentation and diagnostics; value helpers; local runs with pause, stop
// and a debugger (breakpoints, step, variables); console, live graph and XML tabs; script library,
// share links, templates; and remote rendering (docs/REMOTE_RENDER.md).

import { Compartment, EditorState, Prec, RangeSet, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  Decoration, drawSelection, EditorView, gutter, GutterMarker, highlightActiveLine, highlightActiveLineGutter,
  hoverTooltip, keymap, lineNumbers, ViewPlugin, type DecorationSet, type ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import {
  autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type Completion as CmCompletion, type CompletionContext,
} from '@codemirror/autocomplete';
import { forceLinting, linter, lintGutter, lintKeymap, type Diagnostic } from '@codemirror/lint';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import {
  acceptsValue, fromResolvedGraph, fromXml, inlineIncludes, isColorspaceAttribute, MATERIALX_COLORSPACES, runScript, ScriptError,
  toScript, toXml, type ScriptLibrary, type ScriptNode, type ScriptPortDef, type ScriptRun, type ScriptValue, type ScriptVariable,
} from './script-api.ts';
import {
  ASSIGNMENT, DEFAULT_SCRIPT, escapeHtml, formatValue, fromHex, parseLiteral, scriptCompletions, scriptHover, scriptLiteral, scriptTokens,
  scriptVariables, setScriptInput, addScriptDownstream, addScriptUpstream, toHex, type ScriptEditorOptions,
} from './script-editor.ts';
import { layoutScriptGraph } from './script-graph-layout.ts';
import {
  compileSceneGraph, P25_MATERIAL_GRAPH_SCRIPT, P25_SCENE_GRAPH, P25_SCENE_GRAPH_LAYOUT, removeSceneGraphLink, sceneGraphViewNodes,
  setSceneGraphLink, setSceneGraphValue, type SceneGraph,
} from './scene-graph.ts';
import { scriptToSceneGraph } from './scene-graph-script.ts';
import { loadDraft, saveDraft, ScriptStore, shareLink } from './script-store.ts';
import { SCRIPT_TEMPLATES } from './script-templates.ts';
import { requestNodeReference } from './node-reference.ts';
import { downloadBlob } from '../assets/download.ts';
import {
  controlRemoteJob, describeRemoteProgress, loadRemoteSettings, RemoteRenderView, runRemoteScript, saveRemoteSettings,
  type RemoteJobAction, type RemoteRenderSettings,
} from '../remote-render.ts';
import { ICON_BUTTON_STYLE, iconButton, setIconButton } from '../ui/icons.ts';
import { NodeGraphView, type GraphInput, type GraphLink, type GraphNode, type GraphWidget, type PickerGroup } from '../ui/node-graph-view.ts';

const STYLE = `
#script-editor-panel { position: fixed; top: 0; right: 0; bottom: 0; width: min(600px, 100vw); z-index: 1000;
  display: flex; flex-direction: column; gap: 6px; padding: 8px; box-sizing: border-box; background: #1e1e1e; color: #ddd;
  font: 13px system-ui, sans-serif; box-shadow: -4px 0 16px rgba(0, 0, 0, 0.5); }
#script-editor-panel[hidden] { display: none; }
#script-editor-panel .mx-toolbar { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
#script-editor-panel .mx-toolbar strong { margin-right: auto; }
#script-editor-panel .mx-separator { width: 1px; align-self: stretch; background: #444; margin: 0 4px; }
#script-editor-panel .mx-bar { display: flex; gap: 6px; align-items: center; }
#script-editor-panel .mx-bar[hidden] { display: none; }
#script-editor-panel select, #script-editor-panel input[type="text"], #script-editor-panel input[type="url"],
#script-editor-panel input[type="password"] { flex: 1; min-width: 0; background: #252526; color: #eee; border: 1px solid #555;
  border-radius: 8px; padding: 4px 6px; }
#script-editor-panel .mx-remote[hidden] { display: none; }
#script-editor-panel .mx-remote div { display: flex; gap: 6px; margin-top: 4px; }
${ICON_BUTTON_STYLE}
.mx-code { flex: 3; min-height: 160px; border: 1px solid #444; border-radius: 8px; overflow: hidden; display: flex; }
.mx-code .cm-editor { flex: 1; min-width: 0; height: 100%; }
.mx-code .cm-scroller { font: 13px/18px Consolas, 'Courier New', monospace; }
.tok-comment { color: #6a9955; } .tok-string { color: #ce9178; } .tok-number { color: #b5cea8; }
.tok-keyword { color: #569cd6; } .tok-node { color: #4ec9b0; } .tok-var { color: #9cdcfe; } .tok-builtin { color: #4fc1ff; font-weight: 600; }
.tok-input { color: #dcdcaa; } .tok-output { color: #c586c0; } .tok-member { color: #d4d4d4; }
.tok-error { color: #f48771; text-decoration: wavy underline; }
.cm-breakpoint-gutter { width: 16px; cursor: pointer; }
.cm-breakpoint-gutter .cm-gutterElement:empty:hover::after { content: '●'; color: #e5140066; }
.cm-breakpoint { color: #e51400; font-size: 14px; line-height: 18px; }
.cm-exec-line { background: rgba(255, 210, 0, 0.12) !important; }
.cm-paused-line { background: rgba(255, 210, 0, 0.32) !important; outline: 1px solid #c8a400; }
.mx-hover { max-width: 420px; padding: 4px 8px; font: 12px system-ui, sans-serif; }
.mx-hover b { display: block; font-family: Consolas, monospace; color: #4ec9b0; margin-bottom: 2px; }
.mx-helper { display: flex; gap: 8px; align-items: center; min-height: 28px; padding: 2px 8px; border-radius: 8px; background: #252526; }
.mx-helper[hidden] { display: none; }
.mx-helper code { color: #dcdcaa; }
.mx-helper input[type="number"] { width: 72px; }
.mx-status { min-height: 18px; max-height: 6em; overflow: auto; flex-shrink: 0; color: #89d185; white-space: pre-wrap; }
.mx-status.error { color: #f48771; }
.mx-tabs { display: flex; gap: 2px; border-bottom: 1px solid #444; }
.mx-tabs button { background: none; color: #aaa; border: 0; border-bottom: 2px solid transparent; padding: 4px 10px; cursor: pointer; }
.mx-tabs button[aria-selected="true"] { color: #fff; border-bottom-color: #0e639c; }
.mx-tab-panel { flex: 2; min-height: 100px; overflow: auto; border: 1px solid #444; border-radius: 8px; background: #1a1a1a; }
.mx-tab-panel[hidden] { display: none; }
.mx-console { margin: 0; padding: 4px; list-style: none; font: 12px/16px Consolas, monospace; }
.mx-console li { display: flex; gap: 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
.mx-console time { color: #777; flex: none; }
.mx-console .error { color: #f48771; } .mx-console .info { color: #89d185; }
.mx-console button { background: none; border: 0; padding: 0; color: #4fc1ff; text-decoration: underline; cursor: pointer; font: inherit; }
.mx-variables { width: 100%; border-collapse: collapse; font: 12px Consolas, monospace; }
.mx-variables td { border-bottom: 1px solid #333; padding: 2px 6px; vertical-align: top; overflow-wrap: anywhere; }
.mx-variables td:first-child { color: #9cdcfe; white-space: nowrap; }
.mx-empty { color: #888; padding: 6px; }
.mx-parameters { padding: 6px; }
.mx-parameters label { display: block; padding: 5px 0; border-bottom: 1px solid #333; }
.mx-parameters label > span { display: block; margin-bottom: 3px; }
.mx-parameters input[type="number"] { width: 80px; margin-right: 4px; }
.mx-parameters input, .mx-parameters select { background: #252526; color: #eee; border: 1px solid #555; padding: 4px; }
.mx-graph { display: flex; flex-direction: column; overflow: hidden; }
.mx-graph[hidden] { display: none; }
.mx-graph-help { margin: 0; padding: 3px 6px; color: #888; font-size: 11px; }
.mx-graph-canvas { flex: 1; min-height: 160px; }
.mx-scene-graph { display: flex; flex-direction: column; overflow: hidden; }
.mx-scene-graph[hidden] { display: none; }
.mx-scene-graph-toolbar { display: flex; gap: 6px; align-items: center; padding: 4px 6px; }
.mx-scene-graph-toolbar p { margin: 0 auto 0 0; color: #888; font-size: 11px; }
.mx-scene-graph-canvas { flex: 1; min-height: 160px; }
.mx-sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.mx-xml { width: 100%; height: 100%; min-height: 100px; box-sizing: border-box; resize: none; padding: 8px; border: 0;
  background: #1a1a1a; color: #ce9178; font: 12px/16px Consolas, monospace; white-space: pre; }
`;

const editorTheme = EditorView.theme({
  '&': { color: '#d4d4d4', backgroundColor: '#1e1e1e' },
  '.cm-content': { caretColor: '#fff' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#fff' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#264f78' },
  '.cm-gutters': { backgroundColor: '#1e1e1e', color: '#858585', border: 'none' },
  '.cm-activeLine': { backgroundColor: '#ffffff0a' },
  '.cm-activeLineGutter': { backgroundColor: '#ffffff12' },
  '.cm-tooltip': { backgroundColor: '#252526', border: '1px solid #454545', color: '#ddd' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: '#04395e', color: '#fff' },
  '.cm-completionDetail': { color: '#888', marginLeft: '12px', fontStyle: 'normal' },
  '.cm-panels': { backgroundColor: '#252526', color: '#ddd' },
}, { dark: true });

// --- Breakpoints and execution line -------------------------------------------------

const toggleBreakpoint = StateEffect.define<number>();
const breakpointMarker = new class extends GutterMarker {
  override toDOM(): Node {
    return Object.assign(document.createElement('span'), { className: 'cm-breakpoint', textContent: '●' });
  }
}();
const breakpoints = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, transaction) {
    let next = set.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(toggleBreakpoint)) continue;
      let exists = false;
      next.between(effect.value, effect.value, () => { exists = true; });
      next = exists ? next.update({ filter: from => from !== effect.value })
        : next.update({ add: [breakpointMarker.range(effect.value)] });
    }
    return next;
  },
});
const breakpointGutter: Extension = [breakpoints, gutter({
  class: 'cm-breakpoint-gutter',
  renderEmptyElements: true,
  markers: view => view.state.field(breakpoints),
  initialSpacer: () => breakpointMarker,
  domEventHandlers: {
    mousedown(view, line) {
      view.dispatch({ effects: toggleBreakpoint.of(line.from) });
      return true;
    },
  },
})];

const setExecution = StateEffect.define<{ line: number; paused: boolean } | null>();
const executionLine = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setExecution)) continue;
      const target = effect.value;
      if (!target || target.line < 1 || target.line > transaction.state.doc.lines) next = Decoration.none;
      else {
        const line = transaction.state.doc.line(target.line);
        next = Decoration.set([Decoration.line({ class: target.paused ? 'cm-paused-line' : 'cm-exec-line' }).range(line.from)]);
      }
    }
    return next;
  },
  provide: field => EditorView.decorations.from(field),
});

/** Lines with a breakpoint (1-based). */
function breakpointLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  state.field(breakpoints).between(0, state.doc.length, from => { lines.add(state.doc.lineAt(from).number); });
  return lines;
}

// --- Editor -----------------------------------------------------------------------

type RunState = 'idle' | 'running' | 'paused';
type Tab = 'console' | 'variables' | 'parameters' | 'graph' | 'scene-graph' | 'xml';

interface LocalRun {
  controller: AbortController;
  debug: boolean;
  /** Pause in the next statement (step) instead of only at breakpoints. */
  stepping: boolean;
  /** Resolves a debugger pause. */
  release?: (() => void) | undefined;
  /** Editor-held pause when the viewer offers no run control. */
  hold?: { promise: Promise<void>; release: () => void } | undefined;
  userPaused: boolean;
}

interface RemoteRun {
  settings: RemoteRenderSettings;
  controller: AbortController;
  id?: string;
  paused: boolean;
  view: RemoteRenderView;
}

export class MaterialXScriptEditor {
  readonly element: HTMLElement;
  readonly #options: ScriptEditorOptions;
  readonly #view: EditorView;
  readonly #tokens = new Compartment();
  #library: ScriptLibrary | undefined;
  readonly #helper: HTMLElement;
  readonly #status: HTMLElement;
  readonly #xml: HTMLTextAreaElement;
  readonly #console: HTMLOListElement;
  readonly #variables: HTMLElement;
  readonly #parameters: HTMLElement;
  #parameterRun: ScriptRun | undefined;
  #parameterObject: string | undefined;
  #parameterBusy = false;
  readonly #graph: HTMLElement;
  readonly #graphSummary: HTMLElement;
  #graphView: NodeGraphView | undefined;
  #graphNodes: readonly ScriptNode[] = [];
  readonly #sceneGraphCanvas: HTMLElement;
  readonly #sceneGraphSummary: HTMLElement;
  readonly #sceneGraphError: HTMLElement;
  #sceneGraphView: NodeGraphView | undefined;
  #sceneGraphModel: SceneGraph = P25_SCENE_GRAPH;
  #sceneGraphMaterial = P25_MATERIAL_GRAPH_SCRIPT;
  #sceneGraphSource: { script: string; scene: string } | undefined;
  readonly #examples: HTMLSelectElement;
  readonly #library_: HTMLSelectElement;
  readonly #scriptName: HTMLInputElement;
  readonly #remoteUrl: HTMLInputElement;
  readonly #remoteToken: HTMLInputElement;
  readonly #importFile: HTMLInputElement;
  readonly #buttons: Record<string, HTMLButtonElement>;
  readonly #store = new ScriptStore();
  readonly #documents = new Map<string, Promise<string>>();
  #validation = 0;
  #helperLine = -1;
  #draftTimer: ReturnType<typeof setTimeout> | undefined;
  #local: LocalRun | undefined;
  #remote: RemoteRun | undefined;
  #remoteFrames: RemoteRenderView | undefined;
  #pendingLine: { line: number; paused: boolean } | null | undefined;
  #lineFrame = 0;
  /** Message kept above validation results until the script is edited (e.g. opened from a link). */
  #notice: string | undefined;

  constructor(options: ScriptEditorOptions) {
    this.#options = options;
    if (!document.getElementById('mx-script-style')) {
      document.head.append(Object.assign(document.createElement('style'), { id: 'mx-script-style', textContent: STYLE }));
    }
    this.element = document.createElement('aside');
    this.element.id = 'script-editor-panel';
    this.element.setAttribute('aria-label', 'Éditeur de script MaterialX');
    const separator = '<span class="mx-separator" aria-hidden="true"></span>';
    this.element.innerHTML = `
      <div class="mx-toolbar" role="toolbar" aria-label="Script MaterialX">
        ${iconButton('play', 'Appliquer / exécuter (Ctrl+Entrée)', { class: 'primary', 'data-action': 'apply', 'data-testid': 'script-apply' }, 'Exécuter')}
        ${iconButton('bug', 'Déboguer : s’arrête aux points d’arrêt (F5)', { 'data-action': 'debug', 'data-testid': 'script-debug' }, 'Déboguer')}
        ${iconButton('pause', 'Mettre en pause le script et le rendu (F6)', { 'data-action': 'pause', 'data-testid': 'script-pause', disabled: '' }, 'Pause')}
        ${iconButton('stepOver', 'Pas à pas : instruction suivante (F10)', { 'data-action': 'step', 'data-testid': 'script-step', disabled: '' }, 'Pas à pas')}
        ${iconButton('stop', 'Arrêter le script (Maj+F5)', { class: 'danger', 'data-action': 'stop', 'data-testid': 'script-stop', disabled: '' }, 'Arrêter')}
        ${separator}
        ${iconButton('wand', 'Matériau de l’objet sélectionné → script', { 'data-action': 'from-material', 'data-testid': 'script-from-material' }, 'Matériau')}
        ${iconButton('toXml', 'Script → XML MaterialX', { 'data-action': 'to-xml', 'data-testid': 'script-to-xml' }, '→ XML')}
        ${iconButton('fromXml', 'XML MaterialX → script', { 'data-action': 'from-xml', 'data-testid': 'script-from-xml' }, 'XML →')}
        ${iconButton('download', 'Exporter le matériau (.mtlx)', { 'data-action': 'export', 'data-testid': 'script-export' }, '.mtlx')}
        ${separator}
        ${iconButton('save', 'Enregistrer dans Mes scripts (Ctrl+S)', { 'data-action': 'save', 'data-testid': 'script-save' }, 'Enregistrer')}
        ${iconButton('upload', 'Importer un script (.js)', { 'data-action': 'import', 'data-testid': 'script-import' }, 'Importer')}
        ${iconButton('file', 'Exporter le script (.js)', { 'data-action': 'export-js', 'data-testid': 'script-export-js' }, 'Exporter')}
        ${iconButton('link', 'Copier un lien de partage du script', { 'data-action': 'share', 'data-testid': 'script-share' }, 'Partager')}
        ${iconButton('close', 'Fermer (Échap)', { 'data-action': 'close', 'data-testid': 'script-close', style: 'margin-left:auto' }, 'Fermer')}
      </div>
      <div class="mx-bar">
        <select aria-label="Mes scripts" data-testid="script-library"><option value="">Mes scripts…</option></select>
        <input type="text" placeholder="Nom du script" aria-label="Nom du script" data-testid="script-name">
        ${iconButton('trash', 'Supprimer de Mes scripts', { class: 'danger', 'data-action': 'delete', 'data-testid': 'script-delete' }, 'Supprimer')}
      </div>
      <div class="mx-bar">
        <select aria-label="Insérer un modèle" data-testid="script-templates"><option value="">Insérer un modèle…</option></select>
      </div>
      <div class="mx-bar" data-testid="script-examples-bar" hidden>
        <select aria-label="Scripts de validation" data-testid="script-examples"><option value="">Scripts de validation…</option></select>
        ${iconButton('play', 'Charger le script choisi puis l’exécuter sur le viewer', { 'data-action': 'run-example', 'data-testid': 'script-run-example' }, 'Lancer')}
      </div>
      <details class="mx-remote" data-testid="script-remote" hidden>
        <summary>Rendu distant</summary>
        <div>
          <input type="url" placeholder="https://serveur-de-rendu.example/" aria-label="URL du serveur de rendu" data-testid="script-remote-url">
          <input type="password" placeholder="Jeton" autocomplete="off" aria-label="Jeton du serveur de rendu" data-testid="script-remote-token">
          ${iconButton('cloud', 'Rendu distant : exécuter le script sur le serveur et afficher le rendu au fil de sa progression', { 'data-action': 'remote', 'data-testid': 'script-remote-run' }, 'Distant')}
        </div>
      </details>
      <div class="mx-code" data-testid="script-code"></div>
      <div class="mx-helper" data-testid="script-value-helper" hidden></div>
      <div class="mx-status" role="status" data-testid="script-status"></div>
      <div class="mx-tabs" role="tablist" aria-label="Résultats du script">
        <button type="button" role="tab" data-tab="console" aria-selected="true" data-testid="script-tab-console">Console</button>
        <button type="button" role="tab" data-tab="variables" aria-selected="false" data-testid="script-tab-variables">Variables</button>
        <button type="button" role="tab" data-tab="parameters" aria-selected="false" data-testid="script-tab-parameters">Paramètres</button>
        <button type="button" role="tab" data-tab="graph" aria-selected="false" data-testid="script-tab-graph">Graphe</button>
        <button type="button" role="tab" data-tab="scene-graph" aria-selected="false" data-testid="script-tab-scene-graph">Scène</button>
        <button type="button" role="tab" data-tab="xml" aria-selected="false" data-testid="script-tab-xml">XML</button>
        ${iconButton('trash', 'Vider la console', { 'data-action': 'clear-console', 'data-testid': 'script-clear-console', style: 'margin-left:auto' })}
      </div>
      <div class="mx-tab-panel" role="tabpanel" data-panel="console"><ol class="mx-console" data-testid="script-console" aria-live="polite"></ol></div>
      <div class="mx-tab-panel" role="tabpanel" data-panel="variables" data-testid="script-variables" hidden></div>
      <div class="mx-tab-panel mx-parameters" role="tabpanel" data-panel="parameters" data-testid="script-parameters" hidden></div>
      <div class="mx-tab-panel mx-graph" role="tabpanel" data-panel="graph" hidden>
        <p class="mx-graph-help">Glisser d’une sortie vers une entrée pour connecter, modifier les valeurs dans les nœuds ; double-clic : ligne du script. Clic droit : ajouter une entrée.</p>
        <div class="mx-graph-canvas" data-testid="script-graph"></div>
        <p class="mx-sr-only" role="status" data-testid="script-graph-summary"></p>
      </div>
      <div class="mx-tab-panel mx-scene-graph" role="tabpanel" data-panel="scene-graph" hidden>
        <div class="mx-scene-graph-toolbar">
          <p>Prototype P25 · MaterialX reste dans « Graphe » ; modifier ici la scène sans lancer le rendu.</p>
          ${iconButton('graph', 'Convertir le script courant en graphe de scène sans l’exécuter', { 'data-action': 'script-to-scene-graph', 'data-testid': 'script-to-scene-graph' }, 'Script → scène')}
          ${iconButton('file', 'Remplacer le script par le graphe sans l’exécuter', { 'data-action': 'scene-graph-to-script', 'data-testid': 'scene-graph-to-script' }, 'Générer le script')}
          ${iconButton('restore', 'Réinitialiser le prototype', { 'data-action': 'scene-graph-reset', 'data-testid': 'scene-graph-reset' }, 'Réinitialiser')}
        </div>
        <div class="mx-scene-graph-canvas" data-testid="scene-graph"></div>
        <p class="mx-graph-help" role="status" data-testid="scene-graph-summary"></p>
        <p class="mx-status error" role="alert" data-testid="scene-graph-error" hidden></p>
      </div>
      <div class="mx-tab-panel" role="tabpanel" data-panel="xml" hidden>
        <textarea class="mx-xml" spellcheck="false" aria-label="Document MaterialX" data-testid="script-xml"
          placeholder="Document MaterialX : « Script → XML » pour le générer, ou collez un document puis « XML → Script »."></textarea>
      </div>
      <input type="file" accept=".js,text/javascript" hidden data-testid="script-import-file">`;
    const $ = <T extends Element>(testId: string): T => this.element.querySelector<T>(`[data-testid="${testId}"]`)!;
    this.#helper = $('script-value-helper');
    this.#status = $('script-status');
    this.#xml = $('script-xml');
    this.#console = $('script-console');
    this.#variables = $('script-variables');
    this.#parameters = $('script-parameters');
    this.#showParameters();
    this.#graph = $('script-graph');
    this.#graphSummary = $('script-graph-summary');
    this.#sceneGraphCanvas = $('scene-graph');
    this.#sceneGraphSummary = $('scene-graph-summary');
    this.#sceneGraphError = $('scene-graph-error');
    this.#examples = $('script-examples');
    this.#library_ = $('script-library');
    this.#scriptName = $('script-name');
    this.#remoteUrl = $('script-remote-url');
    this.#remoteToken = $('script-remote-token');
    this.#importFile = $('script-import-file');
    this.#buttons = Object.fromEntries([...this.element.querySelectorAll<HTMLButtonElement>('button[data-action]')]
      .map(button => [button.dataset['action']!, button]));
    for (const [index, example] of (options.examples ?? []).entries()) {
      this.#examples.append(new Option(example.label, String(index)));
    }
    $<HTMLElement>('script-examples-bar').hidden = !options.examples?.length;
    const templates = $<HTMLSelectElement>('script-templates');
    for (const [index, template] of SCRIPT_TEMPLATES.entries()) templates.append(new Option(template.label, String(index)));
    templates.addEventListener('change', () => {
      const template = SCRIPT_TEMPLATES[Number(templates.value)];
      templates.value = '';
      if (template) this.insertTemplate(template.code);
    });
    $<HTMLElement>('script-remote').hidden = !options.remoteView;
    if (options.remoteView) {
      const settings = loadRemoteSettings();
      this.#remoteUrl.value = settings.url;
      this.#remoteToken.value = settings.token;
      // Kept as typed, so a page reload does not lose them before a first remote render.
      const save = () => saveRemoteSettings(this.#remoteSettings());
      this.#remoteUrl.addEventListener('input', save);
      this.#remoteToken.addEventListener('input', save);
    }

    this.#view = new EditorView({
      parent: $('script-code'),
      state: EditorState.create({
        doc: options.initialScript ?? loadDraft() ?? DEFAULT_SCRIPT,
        extensions: this.#extensions(),
      }),
    });
    // Script text for automation and tests: `document.querySelector('#script-editor-panel').script`.
    Object.defineProperty(this.element, 'script', { get: () => this.script, set: (code: string) => { this.script = code; } });
    this.#bind();
    this.#setStatus('Chargement des NodeDefs MaterialX...');
    void this.#refreshLibrary();
    options.library.then((library) => {
      this.#library = library;
      this.#view.dispatch({ effects: this.#tokens.reconfigure(this.#tokenExtension()) });
      forceLinting(this.#view);
    }, (error: unknown) => this.#setStatus(`Bibliothèque MaterialX indisponible : ${error instanceof Error ? error.message : String(error)}`, true));
  }

  get script(): string {
    return this.#view.state.doc.toString();
  }

  set script(code: string) {
    this.#view.dispatch({ changes: { from: 0, to: this.#view.state.doc.length, insert: code } });
  }

  focus(): void {
    this.#view.focus();
  }

  /** Show a script opened from a share link; it is not run. */
  loadShared(code: string): void {
    this.script = code;
    this.#notice = 'Script ouvert depuis un lien de partage : le relire avant de l’exécuter.';
    this.#setStatus(this.#notice);
    this.#log('info', 'Script chargé depuis un lien de partage (non exécuté).');
  }

  report(error: unknown): void {
    this.#setStatus(this.#describe(error), true);
  }

  insertTemplate(code: string): void {
    const { from, to } = this.#view.state.selection.main;
    const line = this.#view.state.doc.lineAt(from);
    // A template replaces an empty script; otherwise it goes on its own lines at the caret.
    const empty = !this.script.trim();
    const insert = empty ? code : `${from === line.from ? '' : '\n'}${code}`;
    this.#view.dispatch({
      changes: empty ? { from: 0, to: this.#view.state.doc.length, insert } : { from, to, insert },
      selection: { anchor: (empty ? 0 : from) + insert.length },
      scrollIntoView: true,
    });
    this.#view.focus();
  }

  // --- CodeMirror setup ---------------------------------------------------------

  #extensions(): Extension[] {
    const run = (action: () => void) => (): boolean => { action(); return true; };
    return [
      breakpointGutter, lineNumbers(), foldGutter(), lintGutter(), highlightActiveLineGutter(), history(), drawSelection(),
      indentOnInput(), bracketMatching(), closeBrackets(), highlightActiveLine(), highlightSelectionMatches(), search({ top: true }),
      javascript(), editorTheme, executionLine, EditorState.tabSize.of(2),
      this.#tokens.of([]),
      autocompletion({ override: [context => this.#complete(context)], icons: false }),
      linter(view => this.#lint(view), { delay: 250 }),
      hoverTooltip((view, position) => {
        const hover = this.#library && scriptHover(view.state.doc.toString(), position, this.#library);
        if (!hover) return null;
        return {
          pos: hover.from, end: hover.to, above: true,
          create: () => {
            const dom = Object.assign(document.createElement('div'), { className: 'mx-hover' });
            dom.dataset['testid'] = 'script-hover';
            dom.innerHTML = `<b>${escapeHtml(hover.title)}</b>${hover.lines.map(line => `<div>${escapeHtml(line)}</div>`).join('')}`;
            return { dom };
          },
        };
      }),
      Prec.highest(keymap.of([
        { key: 'Mod-Enter', run: run(() => void this.apply()) },
        { key: 'F5', run: run(() => void (this.#local?.debug && this.#state() === 'paused' ? this.resume() : this.debug())) },
        { key: 'Shift-F5', run: run(() => this.stop()) },
        { key: 'F6', run: run(() => this.togglePause()) },
        { key: 'F8', run: run(() => this.resume()) },
        { key: 'F10', run: run(() => this.step()) },
        { key: 'Mod-s', run: run(() => void this.saveScript()) },
      ])),
      keymap.of([...closeBracketsKeymap, ...completionKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...lintKeymap,
        indentWithTab, ...defaultKeymap]),
      Prec.lowest(keymap.of([{
        key: 'Escape',
        run: run(() => this.element.dispatchEvent(new CustomEvent('script-editor-close', { bubbles: true }))),
      }])),
      EditorView.contentAttributes.of({ 'aria-label': 'Script', 'data-testid': 'script-content' }),
      EditorView.updateListener.of(update => this.#updated(update)),
    ];
  }

  /** NodeDef-aware coloring (nodes, variables, inputs, outputs, unknown members). */
  #tokenExtension(): Extension {
    const library = this.#library;
    const decorate = (state: EditorState): DecorationSet => Decoration.set(
      scriptTokens(state.doc.toString(), library).map(token => Decoration.mark({ class: `tok-${token.kind}` }).range(token.from, token.to)));
    return ViewPlugin.define(view => ({
      decorations: decorate(view.state),
      update(update: ViewUpdate) { if (update.docChanged) this.decorations = decorate(update.state); },
    }), { decorations: plugin => plugin.decorations });
  }

  #complete(context: CompletionContext) {
    if (!this.#library) return null;
    const code = context.state.doc.toString();
    const prefix = code.slice(0, context.pos);
    const result = scriptCompletions(prefix, code, this.#library);
    if (!result?.items.length) return null;
    if (!context.explicit && result.from === context.pos && !/(?:\bnew\s+|\.|\(\s*["'])$/.test(prefix)) return null;
    return {
      from: result.from,
      // Typing more of the word filters this list locally: Enter right after typing accepts, never inserts a line.
      validFor: /^[\w$]*$/,
      options: result.items.map((item, index): CmCompletion => ({
        label: item.label,
        detail: item.detail,
        ...(item.info ? { info: item.info } : {}),
        // Keep scriptCompletions' ranking (inputs before outputs, prefix matches first).
        boost: Math.max(-99, 99 - index),
        apply: (view, _completion, from, to) => {
          let end = to;
          const text = view.state.doc;
          while (end < text.length && /[\w$]/.test(text.sliceString(end, end + 1))) end++;
          const caret = from + item.insert.length - (item.insert.endsWith('()') ? 1 : 0);
          view.dispatch({ changes: { from, to: end, insert: item.insert }, selection: { anchor: caret } });
        },
      })),
    };
  }

  async #lint(view: EditorView): Promise<Diagnostic[]> {
    const library = this.#library;
    if (!library) return [];
    const validation = ++this.#validation;
    try {
      const run = await this.#dryRun(library, view.state.doc.toString());
      if (validation !== this.#validation) return [];
      const count = run.nodes.length;
      const commands = run.viewerCommands ? `, ${run.viewerCommands} commande${run.viewerCommands > 1 ? 's' : ''} viewer` : '';
      if (!this.#local && !this.#remote) this.#setStatus(`${this.#notice ? `${this.#notice}\n` : ''}✓ Script valide : ${count} nœud${count > 1 ? 's' : ''}${commands}.`);
      this.#showGraph(run.nodes);
      return [];
    } catch (error) {
      if (validation !== this.#validation) return [];
      if (!this.#local && !this.#remote) this.#setStatus(this.#describe(error), true);
      const message = error instanceof Error ? error.message : String(error);
      const lineNumber = error instanceof ScriptError ? error.line : undefined;
      const doc = view.state.doc;
      if (lineNumber === undefined || lineNumber < 1 || lineNumber > doc.lines) return [{ from: 0, to: 0, severity: 'error', message }];
      const line = doc.line(lineNumber);
      const indent = /^\s*/.exec(line.text)![0].length;
      return [{ from: line.from + Math.min(indent, line.length), to: line.to, severity: 'error', message }];
    }
  }

  /** Dry run: viewer operations are only validated; loaded documents are cached between runs. */
  #dryRun(library: ScriptLibrary, code = this.script): Promise<ScriptRun> {
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
    return runScript(code, library, { fetchText, ...(this.#options.host ? { host: this.#options.host, dryRun: true } : {}) });
  }

  #updated(update: ViewUpdate): void {
    if (update.docChanged) {
      this.#notice = undefined;
      clearTimeout(this.#draftTimer);
      this.#draftTimer = setTimeout(() => saveDraft(this.script), 500);
    }
    if (update.docChanged || update.selectionSet || update.focusChanged) this.#updateHelper();
  }

  // --- Running --------------------------------------------------------------------

  #state(): RunState {
    if (this.#remote) return this.#remote.paused ? 'paused' : 'running';
    if (!this.#local) return 'idle';
    return this.#local.release || this.#local.userPaused ? 'paused' : 'running';
  }

  #refreshButtons(): void {
    const state = this.#state();
    const running = state !== 'idle';
    const busy = running || this.#parameterBusy;
    for (const action of ['apply', 'debug', 'run-example', 'remote', 'from-material', 'from-xml']) {
      const button = this.#buttons[action];
      if (button) button.disabled = busy;
    }
    const pause = this.#buttons['pause']!;
    pause.disabled = !running || (this.#remote !== undefined && this.#remote.id === undefined);
    const paused = state === 'paused';
    setIconButton(pause, paused ? 'play' : 'pause', paused ? 'Reprendre (F6, F8)' : 'Mettre en pause le script et le rendu (F6)', paused ? 'Reprendre' : 'Pause');
    pause.dataset['testid'] = 'script-pause';
    this.#buttons['step']!.disabled = !(this.#local?.debug && paused);
    this.#buttons['stop']!.disabled = !running;
  }

  /**
   * Execute the script on the viewer. A script that does not drive the viewer (`scene`, `assign`,
   * `render`, settings) applies its material to the selected object.
   */
  apply(): Promise<void> {
    return this.#runLocal(false);
  }

  /** Run with the debugger: pauses at breakpoints (click in the gutter), then step or continue. */
  debug(): Promise<void> {
    return this.#runLocal(true);
  }

  async #runLocal(debug: boolean): Promise<void> {
    if (this.#state() !== 'idle' || this.#parameterBusy) return;
    this.#parameterRun = undefined;
    this.#showParameters();
    const run: LocalRun = { controller: new AbortController(), debug, stepping: false, userPaused: false };
    this.#local = run;
    this.#refreshButtons();
    this.#setStatus(debug ? 'Débogage du script…' : 'Exécution du script…');
    this.#log('info', debug ? 'Débogage démarré.' : 'Exécution démarrée.');
    if (debug) this.#selectTab('variables');
    const logs: string[] = [];
    await this.#guard('Matériau appliqué.', async () => {
      const library = this.#library ?? await this.#options.library;
      const prefix = this.#options.filePrefix;
      const host = this.#options.host;
      try {
        const result = await runScript(this.script, library, {
          ...(host ? {
            host: {
              ...host,
              log: (message: string) => {
                host.log?.(message);
                logs.push(message);
                this.#log('log', message);
              },
            },
          } : {}),
          ...(prefix ? { filePrefix: prefix } : {}),
          signal: run.controller.signal,
          hooks: { pausable: true, beforeLine: (line, variables) => this.#beforeLine(run, line, variables) },
        });
        this.#xml.value = toXml(result, library);
        this.#showGraph(result.nodes);
        const output = !host && result.logs.length ? `\n${result.logs.join('\n')}` : '';
        if (!result.viewerCommands) {
          this.#parameterObject = this.#options.selectedObject?.();
          await this.#options.onApply?.(toXml(result, library, prefix ? { filePrefix: prefix } : {}));
        }
        this.#parameterRun = result;
        this.#showParameters();
        if (result.viewerCommands) return `Script exécuté.${output}`;
        return `Matériau appliqué.${output}`;
      } catch (error) {
        if (run.controller.signal.aborted) {
          const line = error instanceof ScriptError ? error.line : undefined;
          return `Script arrêté${line ? ` à la ligne ${line}` : ''}.`;
        }
        // Keep the messages logged before the failure visible.
        if (error instanceof Error && logs.length) error.message += `\n${logs.slice(-12).join('\n')}`;
        throw error;
      } finally {
        if (run.userPaused) this.#options.runControl?.resume();
        this.#local = undefined;
        this.#markLine(null);
        this.#refreshButtons();
      }
    });
  }

  #beforeLine(run: LocalRun, line: number, variables: () => ScriptVariable[]): Promise<void> | undefined {
    const external = run.userPaused ? this.#options.runControl?.wait() ?? run.hold?.promise : undefined;
    const breakpoint = run.debug && (run.stepping || breakpointLines(this.#view.state).has(line));
    if (!breakpoint && !external) {
      this.#markLine({ line, paused: false });
      return undefined;
    }
    this.#markLine({ line, paused: true });
    this.#showVariables(variables(), line);
    const pauses: Promise<void>[] = external ? [external] : [];
    if (breakpoint) {
      run.stepping = false;
      pauses.push(new Promise<void>((resolve) => { run.release = resolve; }));
      this.#setStatus(`Pause ligne ${line}. Continuer (F8), pas à pas (F10) ou arrêter (Maj+F5).`);
      this.#log('info', `Pause ligne ${line}.`, line);
    }
    this.#refreshButtons();
    return Promise.all(pauses).then(() => {
      run.release = undefined;
      this.#markLine({ line, paused: false });
      this.#setStatus(run.debug ? 'Débogage du script…' : 'Exécution du script…');
      this.#refreshButtons();
    });
  }

  /** Throttled execution-line highlight (a loop may run thousands of statements per frame). */
  #markLine(target: { line: number; paused: boolean } | null): void {
    if (target?.paused || target === null) {
      cancelAnimationFrame(this.#lineFrame);
      this.#lineFrame = 0;
      this.#view.dispatch({ effects: setExecution.of(target) });
      return;
    }
    this.#pendingLine = target;
    this.#lineFrame ||= requestAnimationFrame(() => {
      this.#lineFrame = 0;
      if (this.#pendingLine !== undefined && this.#local) this.#view.dispatch({ effects: setExecution.of(this.#pendingLine) });
    });
  }

  /** Continue a debugger pause (or a user pause). */
  resume(): void {
    const run = this.#local;
    if (this.#remote) { if (this.#remote.paused) void this.#controlRemote('resume'); return; }
    if (!run) return;
    if (run.userPaused) this.#setUserPause(run, false);
    run.release?.();
  }

  step(): void {
    const run = this.#local;
    if (!run?.debug || !run.release) return;
    run.stepping = true;
    run.release();
  }

  togglePause(): void {
    if (this.#remote) { void this.#controlRemote(this.#remote.paused ? 'resume' : 'pause'); return; }
    const run = this.#local;
    if (!run) return;
    if (this.#state() === 'paused') this.resume();
    else this.#setUserPause(run, true);
  }

  #setUserPause(run: LocalRun, paused: boolean): void {
    run.userPaused = paused;
    const control = this.#options.runControl;
    if (paused) {
      if (control) control.pause();
      else {
        let release!: () => void;
        run.hold = { promise: new Promise<void>((resolve) => { release = resolve; }), release };
      }
      this.#setStatus('En pause : le script attend avant sa prochaine instruction et le path tracer n’accumule plus.');
      this.#log('info', 'Pause.');
    } else {
      control?.resume();
      run.hold?.release();
      run.hold = undefined;
      this.#log('info', 'Reprise.');
    }
    this.#refreshButtons();
  }

  stop(): void {
    if (this.#remote) { void this.#controlRemote('cancel'); return; }
    const run = this.#local;
    if (!run) return;
    run.controller.abort();
    if (run.userPaused) this.#setUserPause(run, false);
    run.release?.();
    this.#log('info', 'Arrêt demandé.');
  }

  // --- Remote rendering ---------------------------------------------------------------

  #remoteSettings(): RemoteRenderSettings {
    return { url: this.#remoteUrl.value.trim(), token: this.#remoteToken.value.trim() };
  }

  async #controlRemote(action: RemoteJobAction): Promise<void> {
    const remote = this.#remote;
    if (!remote) return;
    if (!remote.id) {
      if (action === 'cancel') remote.controller.abort();
      return;
    }
    try {
      await controlRemoteJob(remote.settings, remote.id, action);
    } catch (error) {
      // Cancelling must work even when the control request fails: closing the stream cancels the job.
      if (action === 'cancel') remote.controller.abort();
      else this.#log('error', `Rendu distant : ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Run the script on the remote render server: its frames replace the viewer image while it
   * renders, `log` messages appear in the console and `save(...)` files are downloaded.
   */
  async renderRemote(): Promise<void> {
    const container = this.#options.remoteView;
    if (!container || this.#state() !== 'idle') return;
    const settings = this.#remoteSettings();
    const view = this.#remoteFrames ??= new RemoteRenderView(container);
    const remote: RemoteRun = { settings, controller: new AbortController(), paused: false, view };
    this.#remote = remote;
    view.onAction = action => void this.#controlRemote(action);
    view.start();
    this.#refreshButtons();
    this.#selectTab('console');
    this.#log('info', `Rendu distant sur ${settings.url}.`);
    let files = 0;
    let progress = '';
    const show = (text: string) => {
      progress = text;
      view.status(text);
      this.#setStatus(`Rendu distant : ${text}`);
    };
    await this.#guard('Rendu distant terminé.', async () => {
      try {
        saveRemoteSettings(settings);
        const result = await runRemoteScript(settings, this.script, (event) => {
          if (event.type === 'job') {
            remote.id = event.id;
            view.controllable(true);
            this.#refreshButtons();
          } else if (event.type === 'status') {
            remote.paused = event.stage === 'paused';
            view.paused(remote.paused);
            this.#refreshButtons();
            show(event.stage === 'queued' ? `en file d’attente (${event.position ?? 1} avant)`
              : event.stage === 'loading' ? 'chargement du viewer distant…'
                : event.stage === 'paused' ? `en pause. ${progress}` : 'exécution du script…');
          } else if (event.type === 'progress') {
            if (!remote.paused) show(describeRemoteProgress(event.progress) || progress);
          } else if (event.type === 'frame') view.frame(event.image);
          else if (event.type === 'log') this.#log(event.level === 'error' ? 'error' : 'log', event.message);
          else {
            const bytes = Uint8Array.from(atob(event.data), char => char.charCodeAt(0));
            downloadBlob(new Blob([bytes]), event.name);
            this.#log('info', `Fichier reçu : ${event.name}`);
            files++;
          }
        }, remote.controller.signal);
        if (!result.ok) throw new ScriptError(result.message ?? 'Échec du script distant.', result.line);
        view.finish(`Terminé. ${progress}`);
        return `Rendu distant terminé.${files ? `\n${files} fichier(s) téléchargé(s).` : ''}`;
      } catch (error) {
        if (remote.controller.signal.aborted || (error instanceof Error && /Cancelled by the client/.test(error.message))) {
          view.finish(`Rendu distant arrêté. ${progress}`);
          return 'Rendu distant arrêté.';
        }
        view.finish(`Échec : ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      } finally {
        this.#remote = undefined;
        this.#refreshButtons();
      }
    });
  }

  // --- Conversions --------------------------------------------------------------------

  /** Run the script without viewer side effects and return its MaterialX document. */
  async generateXml(options: { filePrefix?: string } = {}): Promise<string> {
    const library = this.#library ?? await this.#options.library;
    return toXml(await this.#dryRun(library), library, options);
  }

  async scriptToXml(): Promise<void> {
    this.#selectTab('xml');
    await this.#guard('Document MaterialX généré.', async () => { this.#xml.value = await this.generateXml(); });
  }

  async xmlToScript(): Promise<void> {
    await this.#guard('Script généré depuis le document MaterialX.', async () => {
      const library = this.#library ?? await this.#options.library;
      const xml = await inlineIncludes(this.#xml.value, document.baseURI);
      this.script = toScript(fromXml(xml, library), library);
    });
  }

  async materialToScript(): Promise<void> {
    await this.#guard('Script généré depuis le matériau de l’objet sélectionné.', async () => {
      const current = await this.#options.currentMaterial?.();
      if (!current) throw new Error('Aucun matériau disponible pour l’objet sélectionné.');
      const library = this.#library ?? await this.#options.library;
      const graph = fromResolvedGraph(current.graph, library, current.name);
      this.script = toScript(graph, library);
      this.#xml.value = toXml(graph, library);
    });
  }

  async export(): Promise<void> {
    await this.#guard('Document exporté.', async () => {
      const xml = await this.generateXml();
      this.#xml.value = xml;
      downloadBlob(new Blob([xml], { type: 'application/xml' }), 'material.mtlx');
    });
  }

  /** Load the script chosen in the « Scripts de validation » menu into the editor. */
  loadExample(): boolean {
    const example = this.#options.examples?.[Number(this.#examples.value)];
    if (!this.#examples.value || !example) return false;
    this.script = example.code;
    return true;
  }

  /** Load the chosen validation script and run it on the viewer. */
  async runExample(): Promise<void> {
    if (!this.loadExample()) {
      this.#setStatus('Choisir d’abord un script de validation.', true);
      return;
    }
    await this.apply();
  }

  // --- Library, files and sharing ---------------------------------------------------------

  async #refreshLibrary(selected = this.#library_.value): Promise<void> {
    try {
      const scripts = await this.#store.list();
      this.#library_.replaceChildren(new Option('Mes scripts…', ''), ...scripts.map(script => new Option(script.name, script.name)));
      this.#library_.value = scripts.some(script => script.name === selected) ? selected : '';
    } catch {
      this.#library_.disabled = true;
      this.#library_.title = 'Stockage IndexedDB indisponible dans ce navigateur.';
    }
  }

  async saveScript(): Promise<void> {
    await this.#guard('', async () => {
      const name = this.#scriptName.value.trim() || this.#library_.value;
      if (!name) throw new Error('Donner un nom au script avant de l’enregistrer.');
      await this.#store.save(name, this.script);
      this.#scriptName.value = name;
      await this.#refreshLibrary(name);
      return `Script « ${name} » enregistré dans Mes scripts.`;
    });
  }

  async #openStored(name: string): Promise<void> {
    await this.#guard('', async () => {
      const stored = await this.#store.get(name);
      if (!stored) throw new Error(`Script « ${name} » introuvable.`);
      this.script = stored.code;
      this.#scriptName.value = name;
      return `Script « ${name} » ouvert (Ctrl+Z pour revenir au précédent).`;
    });
  }

  async #deleteStored(): Promise<void> {
    const name = this.#library_.value;
    if (!name || !confirm(`Supprimer « ${name} » de Mes scripts ?`)) return;
    await this.#guard('', async () => {
      await this.#store.remove(name);
      await this.#refreshLibrary('');
      return `Script « ${name} » supprimé.`;
    });
  }

  async #importScript(file: File): Promise<void> {
    await this.#guard('', async () => {
      if (file.size > 512 * 1024) throw new Error('Script trop volumineux (512 Kio maximum).');
      this.script = await file.text();
      this.#scriptName.value = file.name.replace(/\.[^.]*$/, '');
      return `Script importé depuis ${file.name}.`;
    });
  }

  #exportScript(): void {
    const name = (this.#scriptName.value.trim() || 'script').replace(/[\\/:*?"<>|]+/g, '_');
    downloadBlob(new Blob([this.script], { type: 'text/javascript' }), `${name}.js`);
  }

  async share(): Promise<string> {
    let link = '';
    await this.#guard('', async () => {
      link = await shareLink(this.script);
      try {
        await navigator.clipboard.writeText(link);
        return 'Lien de partage copié dans le presse-papiers. Il s’ouvre sans exécuter le script.';
      } catch {
        this.#log('info', link);
        return 'Lien de partage affiché dans la console (copie automatique refusée).';
      }
    });
    return link;
  }

  // --- Panels -------------------------------------------------------------------------

  #showParameters(error?: string): void {
    this.#parameters.replaceChildren();
    if (error) {
      const message = document.createElement('p');
      message.className = 'mx-status error';
      message.setAttribute('role', 'alert');
      message.textContent = error;
      this.#parameters.append(message);
    }
    const run = this.#parameterRun;
    if (!run?.parameters().length) {
      const empty = document.createElement('p');
      empty.className = 'mx-empty';
      empty.textContent = 'Aucun paramètre déclaré par le dernier script exécuté.';
      this.#parameters.append(empty);
      return;
    }
    const fields = document.createElement('fieldset');
    fields.disabled = this.#parameterBusy;
    for (const parameter of run.parameters()) {
      const label = document.createElement('label');
      const title = document.createElement('span');
      title.textContent = `${parameter.label} (${parameter.type})`;
      label.append(title);
      const inputs: Array<HTMLInputElement | HTMLSelectElement> = [];
      const values = Array.isArray(parameter.value) ? parameter.value : [parameter.value];
      for (const value of values) {
        let input: HTMLInputElement | HTMLSelectElement;
        if (parameter.enum) {
          const select = document.createElement('select');
          for (const option of parameter.enum) select.add(new Option(option, option));
          select.value = String(value);
          input = select;
        } else {
          const element = document.createElement('input');
          element.type = typeof value === 'boolean' ? 'checkbox' : typeof value === 'number' ? 'number' : 'text';
          if (element.type === 'checkbox') element.checked = Boolean(value);
          else element.value = String(value);
          if (element.type === 'number') element.step = parameter.type === 'integer' ? '1' : 'any';
          input = element;
        }
        input.setAttribute('aria-label', parameter.label + (values.length > 1 ? ` ${inputs.length + 1}` : ''));
        input.dataset['parameterId'] = parameter.id;
        inputs.push(input);
        input.addEventListener('change', () => {
          const parsed = inputs.map(item => item instanceof HTMLSelectElement ? item.value
            : item.type === 'checkbox' ? item.checked : item.type === 'number' ? item.valueAsNumber : item.value);
          const next = Array.isArray(parameter.value) ? parsed : parsed[0];
          void this.#changeParameter(run, parameter.id, next);
        });
        label.append(input);
      }
      fields.append(label);
    }
    this.#parameters.append(fields);
  }

  async #changeParameter(run: ScriptRun, id: string, value: unknown): Promise<void> {
    if (this.#parameterBusy || run !== this.#parameterRun || this.#state() !== 'idle') return;
    const previous = run.parameters().find(parameter => parameter.id === id)?.value;
    let updated = false;
    this.#parameterBusy = true;
    this.#refreshButtons();
    this.#showParameters();
    try {
      await run.setParameter(id, value);
      updated = true;
      const library = this.#library ?? await this.#options.library;
      const xml = toXml(run, library, this.#options.filePrefix ? { filePrefix: this.#options.filePrefix } : {});
      if (!run.viewerCommands) {
        if (this.#parameterObject && this.#options.host) {
          await this.#options.host.assignMaterial(this.#parameterObject, { xml });
        } else if (this.#options.onApply) await this.#options.onApply(xml);
        else throw new ScriptError('Aucune cible disponible pour appliquer le matériau.');
      }
      this.#xml.value = toXml(run, library);
      this.#parameterBusy = false;
      this.#refreshButtons();
      this.#showParameters();
    } catch (error) {
      if (updated && !run.viewerCommands && previous !== undefined) await run.setParameter(id, previous);
      this.#parameterBusy = false;
      this.#refreshButtons();
      this.#showParameters(this.#describe(error));
    }
  }

  #selectTab(tab: Tab): void {
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
      button.setAttribute('aria-selected', String(button.dataset['tab'] === tab));
    }
    for (const panel of this.element.querySelectorAll<HTMLElement>('[role="tabpanel"]')) panel.hidden = panel.dataset['panel'] !== tab;
    if (tab === 'scene-graph') this.#showSceneGraph();
  }

  #showSceneGraph(): void {
    if (!this.#sceneGraphView) {
      this.#sceneGraphView = new NodeGraphView(this.#sceneGraphCanvas, {
        onValue: (id, input, value) => this.#updateSceneGraph(() => {
          this.#sceneGraphModel = setSceneGraphValue(this.#sceneGraphModel, id, input, value);
        }),
        onLink: link => this.#updateSceneGraph(() => {
          this.#sceneGraphModel = setSceneGraphLink(this.#sceneGraphModel, link);
        }),
        onUnlink: (id, input) => this.#updateSceneGraph(() => {
          this.#sceneGraphModel = removeSceneGraphLink(this.#sceneGraphModel, id, input);
        }),
      });
    }
    const layout = new Map<string, readonly [number, number]>();
    let sphereIndex = 0;
    for (const node of this.#sceneGraphModel.nodes) {
      const prototypeId = node.kind === 'sphere' ? (sphereIndex++ === 0 ? 'sphereA' : 'sphereB') : node.kind;
      const position = P25_SCENE_GRAPH_LAYOUT.get(prototypeId);
      if (position) layout.set(node.id, position);
    }
    this.#sceneGraphView.set(
      sceneGraphViewNodes(this.#sceneGraphModel),
      this.#sceneGraphModel.links,
      layout,
    );
    try {
      compileSceneGraph(this.#sceneGraphModel);
      this.#sceneGraphSummary.textContent =
        `Prototype valide : ${this.#sceneGraphModel.nodes.length} nœuds, ${this.#sceneGraphModel.links.length} liens.`;
    } catch (error) {
      this.#sceneGraphSummary.textContent = `Graphe incomplet : ${this.#describe(error)}`;
    }
  }

  #updateSceneGraph(update: () => void): void {
    try {
      update();
      this.#sceneGraphError.hidden = true;
      this.#showSceneGraph();
    } catch (error) {
      this.#reportSceneGraphError(error);
      this.#showSceneGraph();
    }
  }

  #reportSceneGraphError(error: unknown): void {
    const message = this.#describe(error);
    this.#sceneGraphError.textContent = message;
    this.#sceneGraphError.hidden = false;
    this.#setStatus(message, true);
    this.#log('error', message);
  }

  #sceneGraphToScript(): void {
    try {
      if (this.#state() !== 'idle') throw new Error('Conversion impossible pendant une exécution.');
      let material = this.#sceneGraphMaterial;
      if (this.#sceneGraphSource && this.script !== this.#sceneGraphSource.script) {
        if (!this.#library) throw new Error('La bibliothèque MaterialX n’est pas encore chargée.');
        const current = scriptToSceneGraph(this.script, this.#library);
        if (compileSceneGraph(current.graph) !== this.#sceneGraphSource.scene) {
          throw new Error('Le script de scène a changé depuis sa conversion. Convertissez-le à nouveau avant de générer.');
        }
        material = current.materialScript;
      }
      const scene = compileSceneGraph(this.#sceneGraphModel);
      if (!this.#sceneGraphSource && this.script.trim() &&
          !confirm('Remplacer le script courant par le prototype de graphe de scène ?')) return;
      this.script = `${material.trimEnd()}\n\n${scene}`;
      this.#sceneGraphMaterial = material;
      this.#sceneGraphSource = { script: this.script, scene };
      this.#sceneGraphError.hidden = true;
      this.#notice = 'Script généré depuis le graphe ; il n’a pas été exécuté.';
      this.#setStatus(this.#notice);
      this.#log('info', 'Graphe de scène converti en script. Relire le code puis cliquer sur Exécuter.');
    } catch (error) {
      this.#reportSceneGraphError(error);
    }
  }

  #scriptToSceneGraph(): void {
    try {
      if (this.#state() !== 'idle') throw new Error('Conversion impossible pendant une exécution.');
      if (!this.#library) throw new Error('La bibliothèque MaterialX n’est pas encore chargée.');
      const imported = scriptToSceneGraph(this.script, this.#library);
      this.#sceneGraphModel = imported.graph;
      this.#sceneGraphMaterial = imported.materialScript;
      this.#sceneGraphSource = { script: this.script, scene: compileSceneGraph(imported.graph) };
      this.#sceneGraphError.hidden = true;
      this.#sceneGraphView?.resetPositions();
      this.#showSceneGraph();
      this.#setStatus('Script converti en graphe de scène sans exécution.');
      this.#log('info', 'Script converti en graphe de scène ; le graphe MaterialX reste séparé.');
    } catch (error) {
      this.#reportSceneGraphError(error);
    }
  }

  #log(level: 'log' | 'info' | 'error', message: string, line?: number): void {
    const item = document.createElement('li');
    item.className = level;
    const time = new Date();
    const stamp = `${time.toLocaleTimeString('fr-FR', { hour12: false })}.${String(time.getMilliseconds()).padStart(3, '0')}`;
    item.append(Object.assign(document.createElement('time'), { textContent: stamp }));
    const text = document.createElement('span');
    text.textContent = message;
    item.append(text);
    if (line !== undefined) item.append(this.#lineLink(line));
    this.#console.append(item);
    while (this.#console.childElementCount > 500) this.#console.firstElementChild!.remove();
    item.scrollIntoView({ block: 'nearest' });
  }

  #lineLink(line: number): HTMLButtonElement {
    const link = Object.assign(document.createElement('button'), { type: 'button', textContent: `ligne ${line}` });
    link.addEventListener('click', () => this.#goToLine(line));
    return link;
  }

  #goToLine(line: number): void {
    const doc = this.#view.state.doc;
    if (line < 1 || line > doc.lines) return;
    const target = doc.line(line);
    this.#view.dispatch({ selection: { anchor: target.from }, scrollIntoView: true });
    this.#view.focus();
  }

  #showVariables(variables: readonly ScriptVariable[], line: number): void {
    if (!variables.length) {
      this.#variables.innerHTML = `<p class="mx-empty">Aucune variable à la ligne ${line}.</p>`;
      return;
    }
    const table = document.createElement('table');
    table.className = 'mx-variables';
    table.innerHTML = `<caption class="mx-empty">Avant la ligne ${line}</caption>`;
    for (const variable of variables) {
      const row = table.insertRow();
      row.insertCell().textContent = variable.name;
      row.insertCell().textContent = variable.value;
    }
    this.#variables.replaceChildren(table);
  }

  #showGraph(nodes: readonly ScriptNode[]): void {
    this.#graphNodes = nodes;
    const library = this.#library;
    const variables = library ? scriptVariables(this.script, library) : new Map();
    const layout = layoutScriptGraph(nodes);
    const positions = new Map(layout.boxes.map(box => [box.node.name, [box.x, box.y] as const]));
    const widgetOf = (port: ScriptPortDef): GraphWidget | undefined => {
      if (port.type === 'float' || port.type === 'integer') {
        return { kind: 'number', integer: port.type === 'integer', ...(port.min !== undefined ? { min: port.min } : {}), ...(port.max !== undefined ? { max: port.max } : {}) };
      }
      if (port.type === 'boolean') return { kind: 'toggle' };
      if (port.enum?.length) return { kind: 'combo', values: port.enum };
      return acceptsValue(port.type) ? { kind: 'text' } : undefined;
    };
    const graphNodes: GraphNode[] = nodes.map((node) => {
      const assigned = new Set(node.inputs.keys());
      const inputs: GraphInput[] = [];
      for (const port of node.def.inputs) {
        const input = node.inputs.get(port.name);
        // Unassigned shader-type inputs stay visible so they can be connected.
        if (!input && acceptsValue(port.type)) continue;
        const widget = input && 'value' in input ? widgetOf(port) : undefined;
        inputs.push({ name: port.name, type: port.type, ...(input && 'value' in input ? { value: input.value } : {}), ...(widget ? { widget } : {}) });
      }
      return {
        id: node.name,
        title: `${node.name} : ${node.def.category}`,
        inputs,
        outputs: node.def.outputs.map(port => ({ name: port.name, type: port.type })),
        optionalInputs: node.def.inputs.filter(port => !assigned.has(port.name) && acceptsValue(port.type) && port.default !== undefined)
          .map(port => ({ name: port.name, type: port.type })),
        editable: variables.has(node.name),
      };
    });
    const links: GraphLink[] = nodes.flatMap(node => [...node.inputs].flatMap(([name, input]) =>
      'node' in input ? [{ from: input.node.name, output: input.output, to: node.name, input: name }] : []));
    if (!this.#graphView) {
      this.#graphView = new NodeGraphView(this.#graph, {
        onActivate: id => this.#goToNode(id),
        onHelp: id => {
          const node = this.#graphNodes.find(candidate => candidate.name === id);
          if (node) requestNodeReference(node.def.category, node.def.name);
        },
        onValue: (id, input, value) => this.#editInput(id, input, scriptLiteral(value as ScriptValue)),
        onLink: (link) => {
          if (!this.#isVariable(link.from)) {
            this.#setStatus(`${link.from} n’a pas de variable dans le script : le connecter dans le code.`, true);
            this.#showGraph(this.#graphNodes);
            return;
          }
          this.#editInput(link.to, link.input, `${link.from}.${link.output}`);
        },
        onUnlink: (id, input) => this.#editInput(id, input, undefined),
        onAddInput: (id, input) => {
          const port = this.#graphNodes.find(node => node.name === id)?.def.inputs.find(candidate => candidate.name === input);
          if (port?.default !== undefined) this.#editInput(id, input, scriptLiteral(port.default));
        },
        upstreamChoices: (id, input) => this.#upstreamChoices(id, input),
        onPickUpstream: (id, input, value) => this.#pickUpstream(id, input, value),
        downstreamChoices: (id, output) => this.#downstreamChoices(id, output),
        onPickDownstream: (id, output, value) => this.#pickDownstream(id, output, value),
      });
    }
    this.#graphView.set(graphNodes, links, positions);
    this.#graphSummary.textContent = `Graphe : ${nodes.length} nœud${nodes.length > 1 ? 's' : ''}, ${links.length} lien${links.length > 1 ? 's' : ''}.`;
  }

  #isVariable(name: string): boolean {
    return !!this.#library && scriptVariables(this.script, this.#library).has(name);
  }

  /** Script variables and library NodeDefs whose output has the type of `id.input`. */
  #upstreamChoices(id: string, input: string): PickerGroup[] {
    const library = this.#library;
    const type = this.#graphNodes.find(node => node.name === id)?.def.inputs.find(port => port.name === input)?.type;
    if (!library || !type) return [];
    const variables = scriptVariables(this.script, library);
    const existing = this.#graphNodes.filter(node => node.name !== id && variables.has(node.name)).flatMap(node =>
      node.def.outputs.filter(port => port.type === type).map(port => ({
        label: `${node.name}.${port.name}`, detail: node.def.name, value: JSON.stringify({ existing: node.name, output: port.name }),
      })));
    const created = library.classNames.flatMap(className => library.variants(library.categoryOf(className)!).flatMap(def =>
      def.outputs.filter(port => port.type === type).map(port => ({
        label: `${className}${port.name !== 'out' ? `.${port.name}` : ''}`, detail: def.name,
        value: JSON.stringify({ def: def.name, category: def.category, className, output: port.name }),
      }))));
    return [{ label: 'Nœuds du script', items: existing }, { label: `Nouveau nœud (sortie ${type})`, items: created }];
  }

  /** Library NodeDefs with an input of the type of `id.output`. */
  #downstreamChoices(id: string, output: string): PickerGroup[] {
    const library = this.#library;
    const type = this.#graphNodes.find(node => node.name === id)?.def.outputs.find(port => port.name === output)?.type;
    if (!library || !type) return [];
    const items = library.classNames.flatMap(className => library.variants(library.categoryOf(className)!).flatMap(def =>
      def.inputs.filter(port => port.type === type).map(port => ({
        label: `${className}.${port.name}`, detail: def.name,
        value: JSON.stringify({ def: def.name, category: def.category, className, input: port.name }),
      }))));
    return [{ label: `Nouveau nœud (entrée ${type})`, items }];
  }

  #pickDownstream(id: string, output: string, value: string): void {
    const choice = JSON.parse(value) as { def: string; category: string; className: string; input: string };
    if (this.#state() !== 'idle' || !this.#isVariable(id)) {
      this.#setStatus(`${id} : ajout impossible ${this.#state() !== 'idle' ? 'pendant une exécution' : 'sans variable dans le script'}.`, true);
      return;
    }
    const line = this.#graphNodes.find(node => node.name === id)?.line;
    const { code, variable } = addScriptDownstream(this.script, id, output,
      { name: choice.def, category: choice.category, className: choice.className }, choice.input, line);
    this.#replaceScript(code);
    this.#log('info', `Graphe : ${variable} = new ${choice.className}() ajouté en aval de ${id}.${output}.`);
  }

  /** Replaces the script by `code` changing only the differing span (undo with Ctrl+Z). */
  #replaceScript(code: string): void {
    const before = this.script;
    let start = 0;
    while (start < before.length && start < code.length && before[start] === code[start]) start++;
    let end = 0;
    while (end < before.length - start && end < code.length - start && before[before.length - 1 - end] === code[code.length - 1 - end]) end++;
    this.#view.dispatch({ changes: { from: start, to: before.length - end, insert: code.slice(start, code.length - end) } });
  }

  #pickUpstream(id: string, input: string, value: string): void {
    const choice = JSON.parse(value) as { existing: string; output: string } | { def: string; category: string; className: string; output: string };
    if ('existing' in choice) {
      this.#editInput(id, input, `${choice.existing}.${choice.output}`);
      return;
    }
    if (this.#state() !== 'idle' || !this.#isVariable(id)) {
      this.#setStatus(`${id} : ajout impossible ${this.#state() !== 'idle' ? 'pendant une exécution' : 'sans variable dans le script'}.`, true);
      return;
    }
    const before = this.script;
    const line = this.#graphNodes.find(node => node.name === id)?.line;
    const { code, variable } = addScriptUpstream(before, id, input, { name: choice.def, category: choice.category, className: choice.className }, choice.output, line);
    let start = 0;
    while (start < before.length && start < code.length && before[start] === code[start]) start++;
    let end = 0;
    while (end < before.length - start && end < code.length - start && before[before.length - 1 - end] === code[code.length - 1 - end]) end++;
    this.#view.dispatch({ changes: { from: start, to: before.length - end, insert: code.slice(start, code.length - end) } });
    this.#log('info', `Graphe : ${variable} = new ${choice.className}() ajouté en amont de ${id}.${input}.`);
  }

  #goToNode(id: string): void {
    const line = this.#graphNodes.find(node => node.name === id)?.line;
    if (line) this.#goToLine(line);
  }

  /** Applies a graph edit to the script text; only the changed lines are replaced (undo with Ctrl+Z). */
  #editInput(id: string, input: string, expression: string | undefined): void {
    if (this.#state() !== 'idle') {
      this.#setStatus('Modification du graphe impossible pendant une exécution.', true);
      this.#showGraph(this.#graphNodes);
      return;
    }
    if (!this.#isVariable(id)) {
      this.#setStatus(`${id} n’a pas de variable dans le script : le modifier dans le code.`, true);
      this.#showGraph(this.#graphNodes);
      return;
    }
    const before = this.script;
    const line = this.#graphNodes.find(node => node.name === id)?.line;
    const after = setScriptInput(before, id, input, expression, line);
    if (after === before) return;
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    let end = 0;
    while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
    this.#view.dispatch({ changes: { from: start, to: before.length - end, insert: after.slice(start, after.length - end) } });
    this.#log('info', expression === undefined ? `Graphe : ${id}.${input} supprimé.` : `Graphe : ${id}.${input} = ${expression}`);
  }

  // --- Status and events ----------------------------------------------------------------

  /** Run an editor action; it may return a status message replacing `success`. */
  async #guard(success: string, action: () => Promise<string | void | undefined>): Promise<void> {
    // Results of validations started before this action are obsolete.
    this.#validation++;
    try {
      const message = (await action()) ?? success;
      this.#setStatus(message);
      if (message) this.#log('info', message);
    } catch (error) {
      this.#setStatus(this.#describe(error), true);
      const line = error instanceof ScriptError ? error.line : undefined;
      this.#log('error', error instanceof Error ? error.message : String(error), line);
      this.#selectTab('console');
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
      const button = (event.target as Element).closest<HTMLButtonElement>('button');
      const tab = button?.dataset['tab'] as Tab | undefined;
      if (tab) { this.#selectTab(tab); return; }
      const action = button?.dataset['action'];
      if (action === 'apply') void this.apply();
      else if (action === 'debug') void this.debug();
      else if (action === 'pause') this.togglePause();
      else if (action === 'step') this.step();
      else if (action === 'stop') this.stop();
      else if (action === 'to-xml') void this.scriptToXml();
      else if (action === 'from-xml') void this.xmlToScript();
      else if (action === 'from-material') void this.materialToScript();
      else if (action === 'export') void this.export();
      else if (action === 'save') void this.saveScript();
      else if (action === 'import') this.#importFile.click();
      else if (action === 'export-js') this.#exportScript();
      else if (action === 'share') void this.share();
      else if (action === 'delete') void this.#deleteStored();
      else if (action === 'run-example') void this.runExample();
      else if (action === 'script-to-scene-graph') this.#scriptToSceneGraph();
      else if (action === 'scene-graph-to-script') this.#sceneGraphToScript();
      else if (action === 'scene-graph-reset') {
        this.#sceneGraphModel = P25_SCENE_GRAPH;
        this.#sceneGraphMaterial = P25_MATERIAL_GRAPH_SCRIPT;
        this.#sceneGraphSource = undefined;
        this.#sceneGraphError.hidden = true;
        this.#sceneGraphView?.resetPositions();
        this.#showSceneGraph();
      }
      else if (action === 'remote') void this.renderRemote();
      else if (action === 'clear-console') this.#console.replaceChildren();
      else if (action === 'close') this.element.dispatchEvent(new CustomEvent('script-editor-close', { bubbles: true }));
    });
    // Keep viewer shortcuts from reacting to typing in the editor.
    this.element.addEventListener('keydown', event => event.stopPropagation());
    this.#examples.addEventListener('change', () => this.loadExample());
    this.#library_.addEventListener('change', () => { if (this.#library_.value) void this.#openStored(this.#library_.value); });
    this.#importFile.addEventListener('change', () => {
      const file = this.#importFile.files?.[0];
      this.#importFile.value = '';
      if (file) void this.#importScript(file);
    });
  }

  // --- Value helpers ----------------------------------------------------------------------

  /** Show a value editor for the `node.input = value` line under the caret. */
  #updateHelper(): void {
    const library = this.#library;
    const state = this.#view.state;
    const text = state.doc.toString();
    const line = state.doc.lineAt(state.selection.main.head);
    const lineIndex = line.number - 1;
    const match = ASSIGNMENT.exec(line.text);
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
    const doc = this.#view.state.doc;
    if (lineIndex + 1 > doc.lines) return;
    const line = doc.line(lineIndex + 1);
    const match = ASSIGNMENT.exec(line.text);
    if (!match) return;
    const text = `${match[1] ?? ''}${match[2]}.${match[3]}${match[4]}${formatValue(value)}${match[6] || ';'}`;
    this.#view.dispatch({ changes: { from: line.from, to: line.to, insert: text }, selection: { anchor: line.from + text.length } });
  }
}
