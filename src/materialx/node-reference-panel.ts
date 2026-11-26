import { nodeType, type ScriptLibrary } from './script-api.ts';
import { formatValue } from './script-editor.ts';
import { nodeReferenceEntries, nodeReferenceExample, nodeReferenceSignature, type NodeReferenceEntry } from './node-reference.ts';
import type { RgbaCapture } from '../gpu/capture.ts';

export interface NodeReferencePanelOptions {
  library: Promise<ScriptLibrary>;
  openExample(code: string): Promise<void>;
  renderPreview?: (code: string, signal: AbortSignal) => Promise<RgbaCapture>;
}

const STYLE = `
.mx-node-reference { display:grid; grid-template-columns:minmax(210px, 30%) minmax(0, 1fr); height:100%; min-height:0;
  background:#14141b; color:#ddd; font:13px/1.45 system-ui,sans-serif; }
.mx-node-reference * { box-sizing:border-box; }
.mx-node-reference-list { display:flex; flex-direction:column; min-height:0; border-right:1px solid #30303b; }
.mx-node-reference-search { flex:none; margin:10px; padding:7px 9px; color:#eee; background:#20212b; border:1px solid #4a4b56; border-radius:6px; }
.mx-node-reference-items { overflow:auto; margin:0; padding:0 6px 10px; list-style:none; }
.mx-node-reference-items button { width:100%; display:flex; flex-direction:column; align-items:flex-start; padding:6px 8px; color:#ddd;
  text-align:left; background:none; border:0; border-radius:5px; cursor:pointer; }
.mx-node-reference-items button:hover,.mx-node-reference-items button[aria-pressed=true] { background:#252b39; color:#fff; }
.mx-node-reference-items small { color:#9ba1b1; }
.mx-node-reference-page { overflow:auto; min-width:0; padding:18px 22px 28px; }
.mx-node-reference-page h2 { margin:0 0 3px; font-size:19px; }
.mx-node-reference-page h3 { margin:18px 0 6px; font-size:14px; }
.mx-node-reference-meta,.mx-node-reference-source { color:#aeb4c2; font-size:12px; }
.mx-node-reference-page pre { overflow:auto; padding:12px; background:#101116; border:1px solid #343541; border-radius:6px; color:#d5d9e3; }
.mx-node-reference-page code { font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace; }
.mx-node-reference-page table { width:100%; border-collapse:collapse; }
.mx-node-reference-page th,.mx-node-reference-page td { padding:5px 8px; border-bottom:1px solid #343541; text-align:left; vertical-align:top; }
.mx-node-reference-page th { color:#bfc7d8; font-weight:600; }
.mx-node-reference-actions { display:flex; gap:8px; margin:12px 0; }
.mx-node-reference-actions button { padding:6px 10px; color:#eee; background:#263852; border:1px solid #466186; border-radius:5px; cursor:pointer; }
.mx-node-reference-actions button:disabled { opacity:.55; cursor:wait; }
.mx-node-reference-preview { display:block; width:min(100%,320px); height:auto; aspect-ratio:1; background:#101116; border:1px solid #343541; border-radius:6px; }
.mx-node-reference-page a { color:#75bfff; }
@media(max-width:700px) { .mx-node-reference { grid-template-columns: minmax(110px, 34%) minmax(0, 1fr); }
  .mx-node-reference-page { padding:12px; } }
`;

function labelled(parent: HTMLElement, label: string, content: string): void {
  const row = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = label;
  const value = document.createElement('span');
  value.textContent = content;
  row.append(name, ' ', value);
  parent.append(row);
}

export class NodeReferencePanel {
  readonly element = document.createElement('section');
  readonly #options: NodeReferencePanelOptions;
  readonly #search: HTMLInputElement;
  readonly #list: HTMLUListElement;
  readonly #page: HTMLElement;
  readonly #entries: NodeReferenceEntry[] = [];
  readonly #previews = new Map<string, RgbaCapture>();
  #library: ScriptLibrary | undefined;
  #selected: NodeReferenceEntry | undefined;
  #requested: { category: string; nodeDef?: string } | undefined;
  #previewController: AbortController | undefined;
  #previewRenderer: NodeReferencePanelOptions['renderPreview'];
  #visible = false;

  constructor(options: NodeReferencePanelOptions) {
    this.#options = options;
    this.#previewRenderer = options.renderPreview;
    if (!document.getElementById('mx-node-reference-style')) {
      document.head.append(Object.assign(document.createElement('style'), { id: 'mx-node-reference-style', textContent: STYLE }));
    }
    this.element.className = 'mx-node-reference';
    this.element.setAttribute('aria-label', 'Référence des nœuds MaterialX');
    const navigation = document.createElement('div');
    navigation.className = 'mx-node-reference-list';
    this.#search = document.createElement('input');
    this.#search.className = 'mx-node-reference-search';
    this.#search.type = 'search';
    this.#search.placeholder = 'Rechercher un nœud…';
    this.#search.setAttribute('aria-label', 'Rechercher un nœud MaterialX');
    this.#list = document.createElement('ul');
    this.#list.className = 'mx-node-reference-items';
    this.#page = document.createElement('article');
    this.#page.className = 'mx-node-reference-page';
    navigation.append(this.#search, this.#list);
    this.element.append(navigation, this.#page);
    this.#search.addEventListener('input', () => this.#renderList());
    this.#search.addEventListener('keydown', event => {
      if (event.key === 'Enter' && this.#list.firstElementChild) {
        event.preventDefault();
        (this.#list.firstElementChild as HTMLButtonElement).click();
      }
    });
    void options.library.then(library => {
      this.#library = library;
      this.#entries.push(...nodeReferenceEntries(library));
      this.#renderList();
      const requested = this.#requested;
      const initial = requested
        ? this.#find(requested.category, requested.nodeDef)
        : this.#entries.find(entry => entry.definition.category === 'standard_surface') ?? this.#entries[0];
      if (initial) this.open(initial.definition.category, initial.definition.name);
      else this.#page.textContent = 'La bibliothèque MaterialX ne contient aucune NodeDef documentable.';
    }).catch(error => {
      this.#page.textContent = `Chargement des NodeDefs impossible : ${error instanceof Error ? error.message : String(error)}`;
    });
  }

  setPreviewRenderer(renderPreview: NodeReferencePanelOptions['renderPreview']): void {
    this.#previewRenderer = renderPreview;
    const button = this.#page.querySelector<HTMLButtonElement>('[data-preview-button]');
    if (button) button.disabled = !renderPreview;
    if (!renderPreview) this.#previewController?.abort();
    else if (this.#visible && this.#selected) void this.#renderPreview(this.#selected);
  }

  setVisible(visible: boolean): void {
    this.#visible = visible;
    if (!visible) this.#previewController?.abort();
    else if (this.#selected) void this.#renderPreview(this.#selected);
  }

  open(category: string, nodeDef?: string): void {
    this.#requested = { category, ...(nodeDef ? { nodeDef } : {}) };
    const entry = this.#find(category, nodeDef);
    if (!entry || !this.#library) return;
    if (this.#selected?.id !== entry.id) this.#previewController?.abort();
    this.#selected = entry;
    this.#renderList();
    this.#renderPage(entry);
  }

  #find(category: string, nodeDef?: string): NodeReferenceEntry | undefined {
    return this.#entries.find(entry => entry.definition.category === category
      && (nodeDef === undefined || entry.definition.name === nodeDef))
      ?? this.#entries.find(entry => entry.definition.category.toLowerCase() === category.toLowerCase());
  }

  #renderList(): void {
    const query = this.#search.value.trim().toLowerCase();
    const filtered = this.#entries.filter(entry => {
      const def = entry.definition;
      return !query || [def.category, def.className, def.name, nodeType(def), def.doc ?? '']
        .some(value => value.toLowerCase().includes(query));
    });
    const fragment = document.createDocumentFragment();
    for (const entry of filtered) {
      const def = entry.definition;
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(entry.id === this.#selected?.id));
      const title = document.createElement('span');
      title.textContent = `${def.category} · ${nodeType(def)}`;
      const detail = document.createElement('small');
      detail.textContent = def.name;
      button.append(title, detail);
      button.addEventListener('click', () => this.open(def.category, def.name));
      item.append(button);
      fragment.append(item);
    }
    this.#list.replaceChildren(fragment);
    if (filtered.length === 0) {
      const empty = document.createElement('li');
      empty.textContent = 'Aucun nœud correspondant.';
      this.#list.append(empty);
    }
  }

  #renderPage(entry: NodeReferenceEntry): void {
    const library = this.#library!;
    const def = entry.definition;
    const example = nodeReferenceExample(def, library);
    const page = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = `${def.category} · ${nodeType(def)}`;
    const signature = document.createElement('div');
    signature.className = 'mx-node-reference-meta';
    signature.textContent = `${nodeReferenceSignature(def, library)} → ${def.outputs.map(port => `${port.name}: ${port.type}`).join(', ') || def.outputs.map(port => port.type).join(', ')}`;
    page.append(title, signature);
    const support = document.createElement('div');
    support.className = 'mx-node-reference-meta';
    labelled(support, 'Raster :', entry.support.raster);
    labelled(support, 'Path tracing :', entry.support.pathTracing);
    labelled(support, 'Corpus :', entry.support.coverage === 'direct' ? 'direct' : entry.support.coverage === 'dependency'
      ? 'dépendance transitive' : 'hors corpus de référence');
    if (entry.support.implementation) labelled(support, 'Implémentation :', entry.support.implementation);
    page.append(support);

    const description = document.createElement('p');
    description.textContent = def.doc || 'La NodeDef MaterialX ne fournit pas de description pour ce nœud.';
    page.append(description);

    const inputsHeading = document.createElement('h3');
    inputsHeading.textContent = `Entrées (${def.inputs.length})`;
    page.append(inputsHeading);
    const inputs = document.createElement('table');
    const inputHead = document.createElement('thead');
    inputHead.innerHTML = '<tr><th>Entrée</th><th>Type</th><th>Défaut</th><th>Description</th></tr>';
    inputs.append(inputHead);
    const inputBody = document.createElement('tbody');
    for (const port of def.inputs) {
      const row = inputBody.insertRow();
      row.insertCell().textContent = port.name;
      row.insertCell().textContent = port.type;
      row.insertCell().textContent = port.default === undefined ? '—' : formatValue(port.default);
      row.insertCell().textContent = port.doc ?? '';
    }
    inputs.append(inputBody);
    page.append(inputs);

    const outputHeading = document.createElement('h3');
    outputHeading.textContent = `Sorties (${def.outputs.length})`;
    page.append(outputHeading);
    const outputs = document.createElement('ul');
    for (const port of def.outputs) {
      const item = document.createElement('li');
      item.textContent = `${port.name}: ${port.type}${port.doc ? ` — ${port.doc}` : ''}`;
      outputs.append(item);
    }
    page.append(outputs);

    const actions = document.createElement('div');
    actions.className = 'mx-node-reference-actions';
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = 'Ouvrir dans l’éditeur';
    open.addEventListener('click', () => void this.#options.openExample(example.code).catch(error => {
      this.#showStatus(`Impossible d’ouvrir l’exemple : ${error instanceof Error ? error.message : String(error)}`);
    }));
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.dataset['previewButton'] = 'true';
    preview.textContent = 'Rendre l’aperçu';
    preview.disabled = !this.#previewRenderer;
    preview.title = example.previewable ? 'Rendre cet exemple sur une sphère' : 'Sortie non connectable directement à un shader de surface';
    preview.addEventListener('click', () => void this.#renderPreview(entry));
    actions.append(open, preview);
    page.append(actions);
    if (!example.previewable) {
      const note = document.createElement('p');
      note.textContent = 'Cette sortie n’est pas directement visualisable sur un shader de surface ; la vignette montre le matériau neutre de la sphère.';
      page.append(note);
    }

    const canvas = document.createElement('canvas');
    canvas.className = 'mx-node-reference-preview';
    canvas.width = canvas.height = 256;
    canvas.setAttribute('aria-label', `Vignette du nœud ${def.category} sur une sphère`);
    const status = document.createElement('p');
    status.className = 'mx-node-reference-meta';
    status.dataset['previewStatus'] = 'true';
    if (this.#previews.has(entry.id)) {
      this.#drawPreview(canvas, this.#previews.get(entry.id)!);
      status.textContent = 'Aperçu raster en cache.';
    } else {
      status.textContent = this.#previewRenderer ? 'Aperçu non généré.' : 'Le viewer WebGPU n’est pas encore prêt.';
    }
    page.append(canvas, status);

    const source = document.createElement('p');
    source.className = 'mx-node-reference-source';
    source.append('Description et signature tirées des NodeDefs de la bibliothèque standard MaterialX. Licence Apache-2.0 : ');
    const link = document.createElement('a');
    link.href = 'https://github.com/AcademySoftwareFoundation/MaterialX/blob/main/LICENSE';
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = 'Academy Software Foundation / MaterialX';
    source.append(link, '. Statut backend : matrice du corpus dans docs/conformance.md ; inventaire : docs/materialx-node-coverage.md.');
    page.append(source);

    const exampleHeading = document.createElement('h3');
    exampleHeading.textContent = 'Exemple JavaScript exécutable';
    const code = document.createElement('pre');
    const codeText = document.createElement('code');
    codeText.textContent = example.code;
    code.append(codeText);
    page.append(exampleHeading, code);
    this.#page.replaceChildren(page);
    if (this.#visible && this.#previewRenderer && !this.#previews.has(entry.id)) void this.#renderPreview(entry);
  }

  async #renderPreview(entry: NodeReferenceEntry): Promise<void> {
    const renderPreview = this.#previewRenderer;
    const library = this.#library;
    if (!renderPreview || !library) return;
    const cached = this.#previews.get(entry.id);
    const canvas = this.#page.querySelector<HTMLCanvasElement>('.mx-node-reference-preview');
    const status = this.#page.querySelector<HTMLElement>('[data-preview-status]');
    const button = this.#page.querySelector<HTMLButtonElement>('[data-preview-button]');
    if (cached) {
      if (canvas) this.#drawPreview(canvas, cached);
      if (status) status.textContent = 'Aperçu raster en cache.';
      return;
    }
    this.#previewController?.abort();
    const controller = this.#previewController = new AbortController();
    if (button) button.disabled = true;
    if (status) status.textContent = 'Rendu de l’aperçu…';
    try {
      const capture = await renderPreview(nodeReferenceExample(entry.definition, library).code, controller.signal);
      if (controller.signal.aborted || this.#selected?.id !== entry.id) return;
      this.#previews.set(entry.id, capture);
      while (this.#previews.size > 12) this.#previews.delete(this.#previews.keys().next().value!);
      if (canvas) this.#drawPreview(canvas, capture);
      if (status) status.textContent = `Aperçu raster · ${capture.width} × ${capture.height}.`;
    } catch (error) {
      if (controller.signal.aborted) return;
      if (status) status.textContent = `Échec de l’aperçu : ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      if (button?.isConnected) button.disabled = !this.#previewRenderer;
      if (this.#previewController === controller) this.#previewController = undefined;
    }
  }

  #drawPreview(canvas: HTMLCanvasElement, capture: RgbaCapture): void {
    canvas.width = capture.width;
    canvas.height = capture.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D indisponible pour afficher la vignette.');
    context.putImageData(new ImageData(new Uint8ClampedArray(capture.rgba), capture.width, capture.height), 0, 0);
  }

  #showStatus(message: string): void {
    const status = this.#page.querySelector<HTMLElement>('[data-preview-status]');
    if (status) status.textContent = message;
  }
}
