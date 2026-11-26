// Node graph view on litegraph (@comfyorg/litegraph, pinned: the package is no longer published),
// shared by the script editor's « Graphe » tab and the material graph dialog. The caller owns the
// model: the view shows nodes and links, and reports value edits, link edits, moves and selection.
import { LGraph, LGraphCanvas, LGraphNode, LiteGraph, type IContextMenuValue } from '@comfyorg/litegraph';
import '@comfyorg/litegraph/style.css';

export type GraphValue = number | boolean | string | readonly number[];

export interface GraphWidget {
  kind: 'number' | 'toggle' | 'combo' | 'text';
  min?: number;
  max?: number;
  /** Integer inputs step by 1. */
  integer?: boolean;
  values?: readonly string[];
}

export interface GraphInput {
  name: string;
  type: string;
  /** Value of an unconnected input, edited with `widget` when the node is editable. */
  value?: GraphValue;
  widget?: GraphWidget;
}

export interface GraphNode {
  id: string;
  title: string;
  /** Second line of information (category, output type), shown in the title tooltip area. */
  subtitle?: string;
  inputs: readonly GraphInput[];
  outputs: readonly { name: string; type: string }[];
  /** Inputs not shown that the node's context menu can add. */
  optionalInputs?: readonly { name: string; type: string }[];
  editable: boolean;
  /** Highlight, e.g. a node the renderer does not support. */
  warning?: boolean;
  previewArea?: boolean;
  preview?: { width: number; height: number; rgba: Uint8Array };
}

export interface GraphLink {
  from: string;
  output: string;
  to: string;
  input: string;
}

export interface NodeGraphHandlers {
  onSelect?(id: string | undefined): void;
  /** Double click on a node. */
  onActivate?(id: string): void;
  /** F1 on the focused graph canvas. */
  onHelp?(id: string): void;
  onValue?(id: string, input: string, value: GraphValue): void;
  /** A link was drawn to `link.to.input` (replacing any previous one). */
  onLink?(link: GraphLink): void;
  /** The link into `id.input` was removed. */
  onUnlink?(id: string, input: string): void;
  onAddInput?(id: string, input: string): void;
  onMove?(id: string, position: readonly [number, number]): void;
  /** Nodes that can feed `id.input` (already filtered by its type), offered by « Ajouter un nœud en amont ». */
  upstreamChoices?(id: string, input: string): readonly PickerGroup[];
  onPickUpstream?(id: string, input: string, value: string): void;
  /** Nodes with an input of the type of `id.output`, offered when a link from it is dropped on the background. */
  downstreamChoices?(id: string, output: string): readonly PickerGroup[];
  onPickDownstream?(id: string, output: string, value: string): void;
}

export interface PickerItem {
  label: string;
  detail?: string;
  value: string;
}

export interface PickerGroup {
  label: string;
  items: readonly PickerItem[];
}

/** Pan and zoom of a view, to restore it when the graph is rebuilt. */
export interface GraphViewport {
  scale: number;
  offset: readonly [number, number];
}

const PICKER_STYLE = `
.mx-graph-picker { position: absolute; z-index: 5; width: min(360px, calc(100% - 16px)); max-height: min(360px, calc(100% - 16px));
  display: flex; flex-direction: column; gap: 4px; padding: 6px; box-sizing: border-box; background: #20212b; color: #ddd;
  border: 1px solid #596278; border-radius: 10px; box-shadow: 0 6px 24px #000a; font: 12px system-ui, sans-serif; }
.mx-graph-picker strong { font-size: 12px; }
.mx-graph-picker input { padding: 4px 8px; background: #15161d; color: #eee; border: 1px solid #555; border-radius: 8px; }
.mx-graph-picker ul { margin: 0; padding: 0; list-style: none; overflow: auto; }
.mx-graph-picker li { padding: 3px 8px; border-radius: 6px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mx-graph-picker li[role="presentation"] { color: #8a93a8; cursor: default; font-weight: 600; padding-top: 6px; }
.mx-graph-picker li[aria-selected="true"] { background: #04395e; color: #fff; }
.mx-graph-picker li small { color: #8a93a8; margin-left: 6px; }
.mx-graph-picker p { margin: 4px 8px; color: #8a93a8; }
`;

// litegraph appends its context menus to <body>, under a modal <dialog> (top layer): move them into it.
let menuObserver: MutationObserver | undefined;
function keepContextMenusVisible(): void {
  menuObserver ??= new MutationObserver((records) => {
    const dialog = [...document.querySelectorAll('dialog[open]')].filter(candidate => candidate.matches(':modal')).at(-1);
    if (!dialog) return;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLElement && node.classList.contains('litecontextmenu')) dialog.append(node);
      }
    }
  });
  menuObserver.observe(document.body, { childList: true });
}

const NODE_COLORS = { color: '#2c3a52', bgcolor: '#1f2633', warning: '#5a3a1f' };

export function fitGraphPreviewImage(
  imageWidth: number, imageHeight: number, areaWidth: number, areaHeight: number,
): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(areaWidth / imageWidth, areaHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return { x: (areaWidth - width) / 2, y: (areaHeight - height) / 2, width, height };
}

/** Text form of a vector for text widgets: "0.8, 0.2, 0.1". */
export function formatGraphVector(value: readonly number[]): string {
  return value.map(component => String(Number(component.toFixed(4)))).join(', ');
}

/** Numbers of a text widget, or undefined when the text is not a list of `size` finite numbers. */
export function parseGraphVector(text: string, size: number): number[] | undefined {
  const values = text.split(/[\s,;]+/).filter(Boolean).map(Number);
  return values.length === size && values.every(Number.isFinite) ? values : undefined;
}

export class NodeGraphView {
  readonly element: HTMLElement;
  readonly #canvas: HTMLCanvasElement;
  readonly #graph = new LGraph();
  readonly #view: LGraphCanvas;
  readonly #handlers: NodeGraphHandlers;
  readonly #resize: ResizeObserver;
  readonly #nodes = new Map<string, LGraphNode>();
  readonly #ids = new Map<LGraphNode, string>();
  readonly #positions = new Map<string, [number, number]>();
  #model: { nodes: readonly GraphNode[]; links: readonly GraphLink[] } = { nodes: [], links: [] };
  /** Changes made by `set()` are not reported as user edits. */
  #updating = false;
  #pendingInputs = new Set<string>();
  #fitted = false;
  #selected: string | undefined;

  constructor(container: HTMLElement, handlers: NodeGraphHandlers = {}) {
    this.#handlers = handlers;
    this.element = document.createElement('div');
    this.element.className = 'mx-node-graph';
    this.element.style.cssText = 'position:relative;width:100%;height:100%;min-height:160px;overflow:hidden';
    this.#canvas = document.createElement('canvas');
    this.#canvas.tabIndex = 0;
    this.#canvas.setAttribute('aria-label', 'Graphe des nœuds : glisser pour déplacer, molette pour zoomer, glisser d’une sortie vers une entrée pour connecter');
    this.#canvas.style.cssText = 'display:block;width:100%;height:100%;outline:none';
    this.element.append(this.#canvas);
    Object.defineProperty(this.element, 'mxGraph', { value: this });
    // litegraph's own shortcuts would change the graph behind the model's back (deleting, pasting,
    // undoing): they are stopped before its canvas listener, which runs in the capture phase.
    this.element.addEventListener('keydown', (event) => {
      if (event.target !== this.#canvas) return;
      const key = event.key.toLowerCase();
      if (key === 'f1' && this.#selected) {
        event.preventDefault();
        event.stopPropagation();
        this.#handlers.onHelp?.(this.#selected);
        return;
      }
      const command = event.ctrlKey || event.metaKey;
      if (key === 'delete' || key === 'backspace' || (command && ['v', 'z', 'y', 'x', 'd'].includes(key))) {
        event.stopPropagation();
        event.preventDefault();
      }
    }, true);
    container.append(this.element);
    if (!document.getElementById('mx-graph-picker-style')) {
      document.head.append(Object.assign(document.createElement('style'), { id: 'mx-graph-picker-style', textContent: PICKER_STYLE }));
    }
    keepContextMenusVisible();
    LiteGraph.release_link_on_empty_shows_menu = false;
    this.#view = new LGraphCanvas(this.#canvas, this.#graph);
    this.#view.allow_searchbox = false;
    this.#view.render_canvas_border = false;
    this.#view.show_info = false;
    // litegraph drops all text below 0.6: keep labels readable down to the minimum fit zoom.
    this.#view.low_quality_zoom_threshold = 0.3;
    this.#view.onNodeSelected = node => {
      this.#selected = node ? this.#ids.get(node) : undefined;
      this.#handlers.onSelect?.(this.#selected);
    };
    this.#view.onNodeDblClicked = (node) => {
      const id = this.#ids.get(node);
      if (id) this.#handlers.onActivate?.(id);
    };
    this.#view.onNodeMoved = (node) => {
      const id = node && this.#ids.get(node);
      if (!id || !node) return;
      const position: [number, number] = [node.pos[0], node.pos[1]];
      this.#positions.set(id, position);
      this.#handlers.onMove?.(id, position);
    };
    // Only the view's own actions: no node creation, cloning or removal (the model owns nodes).
    this.#view.getCanvasMenuOptions = () => [
      { content: 'Ajuster la vue', callback: () => { this.fit(); } },
    ];
    this.#view.getNodeMenuOptions = node => this.#nodeMenu(node);
    // A new link dropped on the background creates the node at its other end, chosen by type:
    // from an output, a node fed by it; from an input, a node feeding it. Dragging an existing link
    // away (a moving link) keeps litegraph's meaning: disconnect.
    this.#view.linkConnector.events.addEventListener('dropped-on-canvas', (event) => {
      const link = this.#view.linkConnector.renderLinks[0];
      if (!link || 'link' in link || !(link.node instanceof LGraphNode)) return;
      const id = this.#ids.get(link.node);
      const model = id ? this.#model.nodes.find(candidate => candidate.id === id) : undefined;
      if (!id || !model?.editable) return;
      const pointer = event.detail as unknown as PointerEvent;
      const at = { x: pointer.clientX, y: pointer.clientY };
      const slot = link.fromSlot.name;
      if (link.toType === 'input') {
        if (this.#handlers.downstreamChoices) void this.openDownstream(id, slot, at);
      } else if (this.#handlers.upstreamChoices) void this.openUpstream(id, slot, at);
    });
    this.#resize = new ResizeObserver(() => this.#fitCanvas());
    this.#resize.observe(this.element);
    this.#fitCanvas();
  }

  /** Replaces the shown graph; nodes keep the position they had (or `layout`'s for new ones). */
  set(nodes: readonly GraphNode[], links: readonly GraphLink[], layout?: ReadonlyMap<string, readonly [number, number]>): void {
    // Keep nodes where they are drawn now (litegraph may have adjusted them since the last set()).
    for (const [id, node] of this.#nodes) this.#positions.set(id, [node.pos[0], node.pos[1]]);
    this.#model = { nodes, links };
    this.#updating = true;
    try {
      const selected = this.#selectedId();
      this.#graph.clear();
      this.#nodes.clear();
      this.#ids.clear();
      const laidOut: LGraphNode[] = [];
      for (const model of nodes) {
        const node = this.#createNode(model);
        const remembered = this.#positions.get(model.id);
        const position = remembered ?? layout?.get(model.id);
        if (position) node.pos = [position[0], position[1]];
        if (!remembered && position) laidOut.push(node);
        this.#graph.add(node);
        this.#nodes.set(model.id, node);
        this.#ids.set(node, model.id);
      }
      // Layout positions assume a fixed node size: space columns by the nodes' real widths, then
      // stack each column by their real heights.
      const columns = new Map<number, LGraphNode[]>();
      for (const node of laidOut) columns.set(node.pos[0], [...columns.get(node.pos[0]) ?? [], node]);
      let columnX = -Infinity;
      for (const x of [...columns.keys()].sort((a, b) => a - b)) {
        const column = columns.get(x)!;
        const left = Math.max(x, columnX);
        for (const node of column) node.pos[0] = left;
        columnX = left + Math.max(...column.map(node => node.size[0])) + 60;
      }
      for (const column of columns.values()) {
        column.sort((a, b) => a.pos[1] - b.pos[1]);
        let bottom = -Infinity;
        for (const node of column) {
          node.pos[1] = Math.max(node.pos[1], bottom + LiteGraph.NODE_TITLE_HEIGHT + 16);
          bottom = node.pos[1] + node.size[1];
        }
      }
      for (const link of links) {
        const from = this.#nodes.get(link.from);
        const to = this.#nodes.get(link.to);
        if (!from || !to) continue;
        const output = from.outputs.findIndex(slot => slot.name === link.output);
        const input = to.inputs.findIndex(slot => slot.name === link.input);
        if (output >= 0 && input >= 0) from.connect(output, to, input);
      }
      for (const [id, node] of this.#nodes) this.#positions.set(id, [node.pos[0], node.pos[1]]);
      if (selected && this.#nodes.has(selected)) this.#view.selectNode(this.#nodes.get(selected)!);
    } finally {
      this.#updating = false;
    }
    if (!this.#fitted && nodes.length && this.element.clientWidth) {
      this.#fitted = true;
      this.fit();
    }
    this.#view.setDirty(true, true);
  }

  /** Positions of the nodes, e.g. to remember a layout. */
  get positions(): ReadonlyMap<string, readonly [number, number]> {
    return this.#positions;
  }

  /**
   * Page coordinates (CSS pixels) of a node's widget, input or output, for automation and tests:
   * `element.mxGraph.point("noise", "widget", "octaves")`.
   */
  point(id: string, kind: 'widget' | 'input' | 'output' | 'title', name = ''): { x: number; y: number } | undefined {
    const node = this.#nodes.get(id);
    if (!node) return undefined;
    let local: [number, number] | undefined;
    if (kind === 'title') local = [node.pos[0] + 40, node.pos[1] - LiteGraph.NODE_TITLE_HEIGHT / 2];
    else if (kind === 'widget') {
      const widget = node.widgets?.find(candidate => candidate.name === name);
      if (widget) local = [node.pos[0] + node.size[0] - 20, node.pos[1] + (widget.y ?? 0) + LiteGraph.NODE_WIDGET_HEIGHT / 2];
    } else {
      const slots = kind === 'input' ? node.inputs : node.outputs;
      const index = slots.findIndex(slot => slot.name === name);
      if (index >= 0) {
        const position = kind === 'input' ? node.getInputPos(index) : node.getOutputPos(index);
        local = [position[0], position[1]];
      }
    }
    if (!local) return undefined;
    const converted = this.#view.ds.convertOffsetToCanvas(local);
    const bounds = this.#canvas.getBoundingClientRect();
    return { x: bounds.left + converted[0]!, y: bounds.top + converted[1]! };
  }

  /** Forgets moved positions: the next `set()` uses its layout again. */
  resetPositions(): void {
    this.#positions.clear();
    this.#fitted = false;
  }

  get viewport(): GraphViewport {
    return { scale: this.#view.ds.scale, offset: [this.#view.ds.offset[0], this.#view.ds.offset[1]] };
  }

  /** Restores a pan and zoom (instead of fitting the graph on the first `set()`). */
  set viewport(viewport: GraphViewport) {
    this.#view.ds.scale = viewport.scale;
    this.#view.ds.offset[0] = viewport.offset[0];
    this.#view.ds.offset[1] = viewport.offset[1];
    this.#fitted = true;
    this.#view.setDirty(true, true);
  }

  /**
   * Opens a filterable list at the pointer position (page coordinates); resolves with the picked
   * value, or undefined when dismissed (Échap, click outside).
   */
  pick(at: { x: number; y: number }, title: string, groups: readonly PickerGroup[]): Promise<string | undefined> {
    this.element.querySelector('.mx-graph-picker')?.remove();
    const bounds = this.element.getBoundingClientRect();
    const popup = document.createElement('div');
    popup.className = 'mx-graph-picker';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', title);
    const heading = Object.assign(document.createElement('strong'), { textContent: title });
    const search = Object.assign(document.createElement('input'), { type: 'search', placeholder: 'Filtrer…' });
    search.setAttribute('aria-label', 'Filtrer');
    const list = document.createElement('ul');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', title);
    popup.append(heading, search, list);
    this.element.append(popup);
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    popup.style.left = `${Math.max(8, Math.min(at.x - bounds.left, bounds.width - width - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(at.y - bounds.top, bounds.height - height - 8))}px`;
    return new Promise((resolve) => {
      let items: { element: HTMLLIElement; value: string }[] = [];
      let active = 0;
      const close = (value?: string): void => {
        document.removeEventListener('pointerdown', outside, true);
        popup.remove();
        this.#canvas.focus();
        resolve(value);
      };
      const outside = (event: PointerEvent): void => { if (!popup.contains(event.target as Node)) close(); };
      const highlight = (index: number): void => {
        if (!items.length) return;
        active = (index + items.length) % items.length;
        items.forEach((item, i) => item.element.setAttribute('aria-selected', String(i === active)));
        items[active]!.element.scrollIntoView({ block: 'nearest' });
      };
      const render = (): void => {
        const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
        list.replaceChildren();
        items = [];
        for (const group of groups) {
          const matches = group.items.filter(item => words.every(word => `${item.label} ${item.detail ?? ''}`.toLowerCase().includes(word)));
          if (!matches.length) continue;
          list.append(Object.assign(document.createElement('li'), { role: 'presentation', textContent: group.label }));
          for (const item of matches.slice(0, 300)) {
            const element = document.createElement('li');
            element.setAttribute('role', 'option');
            element.textContent = item.label;
            if (item.detail) element.append(Object.assign(document.createElement('small'), { textContent: item.detail }));
            element.addEventListener('pointerdown', event => event.preventDefault());
            element.addEventListener('click', () => close(item.value));
            list.append(element);
            items.push({ element, value: item.value });
          }
        }
        if (!items.length) list.append(Object.assign(document.createElement('p'), { textContent: 'Aucun nœud compatible.' }));
        highlight(0);
      };
      search.addEventListener('input', render);
      search.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          highlight(active + (event.key === 'ArrowDown' ? 1 : -1));
        } else if (event.key === 'Enter') {
          event.preventDefault();
          close(items[active]?.value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      });
      document.addEventListener('pointerdown', outside, true);
      render();
      search.focus();
    });
  }

  /** Selects a node; `center` also scrolls it into view (e.g. when chosen from a list). */
  select(id: string, center = false): void {
    const node = this.#nodes.get(id);
    if (!node) return;
    this.#view.selectNode(node);
    if (center) this.#view.centerOnNode(node);
    this.#view.setDirty(true, true);
  }

  /** Zooms and pans so every node is visible. */
  fit(): void {
    if (!this.#nodes.size) return;
    let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const node of this.#nodes.values()) {
      left = Math.min(left, node.pos[0]);
      top = Math.min(top, node.pos[1] - LiteGraph.NODE_TITLE_HEIGHT);
      right = Math.max(right, node.pos[0] + node.size[0]);
      bottom = Math.max(bottom, node.pos[1] + node.size[1]);
    }
    const margin = 24;
    const width = Math.max(1, this.element.clientWidth);
    const height = Math.max(1, this.element.clientHeight);
    // Below 0.4 the text is unreadable: a large graph is then panned rather than shrunk.
    const scale = Math.min(1.2, Math.max(0.4, Math.min(width / (right - left + margin * 2), height / (bottom - top + margin * 2))));
    this.#view.ds.scale = scale;
    this.#view.ds.offset[0] = -left + margin + (width / scale - (right - left + margin * 2)) / 2;
    this.#view.ds.offset[1] = -top + margin + (height / scale - (bottom - top + margin * 2)) / 2;
    this.#view.setDirty(true, true);
  }

  dispose(): void {
    this.#resize.disconnect();
    this.#graph.clear();
    this.element.remove();
  }

  #selectedId(): string | undefined {
    for (const item of this.#view.selectedItems) {
      const id = item instanceof LGraphNode ? this.#ids.get(item) : undefined;
      if (id) return id;
    }
    return undefined;
  }

  #fitCanvas(): void {
    const width = Math.max(1, this.element.clientWidth);
    const height = Math.max(1, this.element.clientHeight);
    // litegraph scales by devicePixelRatio itself when the canvas is resized through it.
    this.#view.resize(width, height);
    if (!this.#fitted && this.#nodes.size && this.element.clientWidth) {
      this.#fitted = true;
      this.fit();
    }
    this.#view.setDirty(true, true);
  }

  #createNode(model: GraphNode): LGraphNode {
    const node = new LGraphNode(model.title);
    node.color = model.warning ? NODE_COLORS.warning : NODE_COLORS.color;
    node.bgcolor = NODE_COLORS.bgcolor;
    // The model owns nodes: litegraph's Delete/Backspace (deleteSelected) only honours block_delete.
    node.removable = false;
    node.block_delete = true;
    node.resizable = true;
    for (const output of model.outputs) node.addOutput(output.name, output.type);
    for (const input of model.inputs) {
      const widget = model.editable && input.widget && input.value !== undefined ? this.#addWidget(node, model, input) : undefined;
      node.addInput(input.name, input.type, widget ? { widget: { name: widget } } : {});
    }
    node.onConnectionsChange = (type, index) => {
      if (this.#updating || type !== LiteGraph.INPUT) return;
      const input = node.inputs[index];
      if (input) this.#inputChanged(model.id, input.name);
    };
    // Right click on an input: feed it from a new or existing node of its type.
    node.getSlotMenuOptions = (slot) => {
      const input = slot.input;
      const items: IContextMenuValue[] = [];
      if (input && model.editable && this.#handlers.upstreamChoices) {
        items.push({
          content: 'Ajouter un nœud en amont…',
          callback: (_value, _options, event) => { void this.#openUpstream(model.id, input.name, event); },
        });
      }
      if (input?.link != null || slot.output?.links?.length) items.push({ content: 'Disconnect Links', slot } as IContextMenuValue);
      return items;
    };
    const size = node.computeSize();
    node.size = [Math.max(size[0], 180), size[1]];
    if (model.previewArea) {
      node.size[1] += 84;
      const image = model.preview && model.preview.rgba.length === model.preview.width * model.preview.height * 4
        ? document.createElement('canvas') : undefined;
      if (image && model.preview) {
        image.width = model.preview.width;
        image.height = model.preview.height;
        image.getContext('2d')?.putImageData(
          new ImageData(new Uint8ClampedArray(model.preview.rgba), image.width, image.height), 0, 0,
        );
      }
      node.onDrawForeground = (context: CanvasRenderingContext2D) => {
        const x = 8;
        const y = node.size[1] - 78;
        const width = node.size[0] - 16;
        context.save();
        context.fillStyle = '#101018';
        context.fillRect(x, y, width, 68);
        if (image) {
          const fitted = fitGraphPreviewImage(image.width, image.height, width, 68);
          context.drawImage(image, x + fitted.x, y + fitted.y, fitted.width, fitted.height);
        }
        context.restore();
      };
    }
    return node;
  }

  /** Adds the value widget of `input`; returns its name. */
  #addWidget(node: LGraphNode, model: GraphNode, input: GraphInput): string | undefined {
    const spec = input.widget!;
    const report = (value: GraphValue): void => {
      if (!this.#updating) this.#handlers.onValue?.(model.id, input.name, value);
    };
    const value = input.value!;
    if (spec.kind === 'toggle' && typeof value === 'boolean') {
      node.addWidget('toggle', input.name, value, (next: unknown) => report(Boolean(next)));
    } else if (spec.kind === 'number' && typeof value === 'number') {
      node.addWidget('number', input.name, value, (next: unknown) => report(Number(next)), {
        ...(spec.min !== undefined ? { min: spec.min } : {}), ...(spec.max !== undefined ? { max: spec.max } : {}),
        step2: spec.integer ? 1 : Math.max(0.001, ((spec.max ?? 1) - (spec.min ?? 0)) / 100), precision: spec.integer ? 0 : 3,
      });
    } else if (spec.kind === 'combo' && typeof value === 'string') {
      node.addWidget('combo', input.name, value, (next: unknown) => report(String(next)), { values: [...(spec.values ?? [value])] });
    } else if (Array.isArray(value)) {
      const size = value.length;
      node.addWidget('text', input.name, formatGraphVector(value), (next: unknown) => {
        const parsed = parseGraphVector(String(next), size);
        if (parsed) report(parsed);
        else this.set(this.#model.nodes, this.#model.links);
      });
    } else {
      node.addWidget('text', input.name, String(value), (next: unknown) => report(String(next)));
    }
    return input.name;
  }

  /** Link edits arrive as disconnect + connect pairs: report the final state of each input once. */
  #inputChanged(id: string, input: string): void {
    const key = `${id}\u0000${input}`;
    if (this.#pendingInputs.has(key)) return;
    this.#pendingInputs.add(key);
    queueMicrotask(() => {
      this.#pendingInputs.delete(key);
      const node = this.#nodes.get(id);
      const slot = node?.inputs.find(candidate => candidate.name === input);
      if (!node || !slot) return;
      const link = slot.link === null ? undefined : this.#graph.links.get(slot.link);
      const origin = link ? this.#graph.getNodeById(link.origin_id) : undefined;
      const from = origin ? this.#ids.get(origin) : undefined;
      if (link && origin && from) this.#handlers.onLink?.({ from, output: origin.outputs[link.origin_slot]!.name, to: id, input });
      else this.#handlers.onUnlink?.(id, input);
    });
  }

  #nodeMenu(node: LGraphNode): IContextMenuValue<string>[] {
    const id = this.#ids.get(node);
    const model = id ? this.#model.nodes.find(candidate => candidate.id === id) : undefined;
    if (!id || !model) return [];
    const items: IContextMenuValue<string>[] = [];
    if (this.#handlers.onActivate) items.push({ content: 'Aller au nœud', callback: () => { this.#handlers.onActivate!(id); } });
    if (model.editable && model.optionalInputs?.length && this.#handlers.onAddInput) {
      items.push({
        content: 'Ajouter une entrée', has_submenu: true,
        submenu: { options: model.optionalInputs.map(input => ({ content: `${input.name} (${input.type})`, callback: () => { this.#handlers.onAddInput!(id, input.name); } })) },
      } as IContextMenuValue<string>);
    }
    if (model.editable && (model.inputs.length || model.optionalInputs?.length) && this.#handlers.upstreamChoices) {
      items.push({
        content: 'Ajouter un nœud en amont de', has_submenu: true,
        submenu: {
          options: [...model.inputs, ...model.optionalInputs ?? []].map(input => ({
            content: `${input.name} (${input.type})`,
            callback: (_value: unknown, _options: unknown, event?: MouseEvent) => { void this.#openUpstream(id, input.name, event); },
          })),
        },
      } as IContextMenuValue<string>);
    }
    items.push({ content: 'Ajuster la vue', callback: () => { this.fit(); } });
    return items;
  }

  /** « Ajouter un nœud en amont » of `id.input`: lists the caller's choices, then reports the pick. */
  async openUpstream(id: string, input: string, at?: { x: number; y: number }): Promise<void> {
    const choices = this.#handlers.upstreamChoices?.(id, input) ?? [];
    const model = this.#model.nodes.find(node => node.id === id);
    const type = [...model?.inputs ?? [], ...model?.optionalInputs ?? []].find(candidate => candidate.name === input)?.type ?? '';
    const bounds = this.element.getBoundingClientRect();
    const value = await this.pick(at ?? { x: bounds.left + 24, y: bounds.top + 24 }, `En amont de ${input}${type ? ` (${type})` : ''}`, choices);
    if (value !== undefined) this.#handlers.onPickUpstream?.(id, input, value);
  }

  #openUpstream(id: string, input: string, event?: MouseEvent): Promise<void> {
    return this.openUpstream(id, input, event ? { x: event.clientX, y: event.clientY } : undefined);
  }

  /** Lists nodes accepting `id.output` (by type), then reports the pick. */
  async openDownstream(id: string, output: string, at?: { x: number; y: number }): Promise<void> {
    const choices = this.#handlers.downstreamChoices?.(id, output) ?? [];
    const type = this.#model.nodes.find(node => node.id === id)?.outputs.find(candidate => candidate.name === output)?.type ?? '';
    const bounds = this.element.getBoundingClientRect();
    const value = await this.pick(at ?? { x: bounds.left + 24, y: bounds.top + 24 }, `En aval de ${output}${type ? ` (${type})` : ''}`, choices);
    if (value !== undefined) this.#handlers.onPickDownstream?.(id, output, value);
  }
}
