import { downloadBlob } from './assets/download.ts';
import { SURFACE_IR_UPSTREAM } from './compiler/surface-ir.ts';
import { compareMaterialGraphs } from './materialx/graph-comparison.ts';
import { makeMaterialExport, type TextureSourceResolver } from './materialx/graph-export.ts';
import type { ResolvedGraph, ResolvedNodeDefRef } from './materialx/graph.ts';
import type { SurfaceInputDiagnostic } from './materialx/surface-graph.ts';
import type { BackendKind, InteractiveViewer, MaterialVariantSlot } from './render/viewer.ts';
import type { MaterialPreviewOptions } from './render/material-preview.ts';
import type { RgbaCapture } from './gpu/capture.ts';
import { compatibleNodeOutputChoices, type MaterialGraphOutput, type MaterialParameter } from './render/material-parameters.ts';
import type { GraphInput, GraphLink, GraphNode, GraphValue, GraphWidget, NodeGraphView } from './ui/node-graph-view.ts';

// litegraph is loaded when a graph is first shown.
let nodeGraphModule: Promise<typeof import('./ui/node-graph-view.ts')> | undefined;
const loadNodeGraphView = () => nodeGraphModule ??= import('./ui/node-graph-view.ts');

const NODE_HEIGHT = 54;
const COLUMN = 232;
const ROW = 80;
const PADDING = 16;
const MAX_SAVED_POSITION = 100_000;
type NodePosition = { x: number; y: number };
const savedPositions = new WeakMap<ResolvedGraph, Map<string, NodePosition>>();
const positionStoragePrefix = 'material-graph-layout:v1:';
const BACKEND_LABELS: Readonly<Record<BackendKind, string>> = { raster: 'raster', pathtracing: 'path tracing MaterialX', disney: 'Disney' };

interface GraphParameterEditing {
  parameters(nodeId: string): readonly MaterialParameter[];
  nodeDefinitions(): readonly ResolvedNodeDefRef[];
  outputs(nodeId: string, input: string): readonly MaterialGraphOutput[];
  diagnostics(nodeId: string): readonly SurfaceInputDiagnostic[];
  backendDiagnostics?(): ReturnType<InteractiveViewer['objectMaterialBackendDiagnostics']>;
  apply(changes: ReadonlyMap<string, readonly number[]>): Promise<ResolvedGraph | undefined>;
  canUnlinkInput(nodeId: string, input: string): boolean;
  setInputLink(nodeId: string, input: string, sourceId: string | null, output?: string): Promise<ResolvedGraph>;
  setInputValue(nodeId: string, input: string, value: string): Promise<ResolvedGraph>;
  addNode(nodeId: string, input: string, nodeDef: string, output: string): Promise<ResolvedGraph>;
  variants(): Readonly<Record<MaterialVariantSlot, 'empty' | 'active' | 'saved'>> | undefined;
  variantGraph(slot: MaterialVariantSlot): ResolvedGraph | undefined;
  saveVariant(slot: MaterialVariantSlot): void;
  applyVariant(slot: MaterialVariantSlot): Promise<ResolvedGraph>;
  captureVariants?(
    options: Parameters<InteractiveViewer['captureObjectMaterialVariants']>[1], signal: AbortSignal,
  ): ReturnType<InteractiveViewer['captureObjectMaterialVariants']>;
  capturePreview?(options: MaterialPreviewOptions, signal: AbortSignal): Promise<RgbaCapture>;
  textureSource?: TextureSourceResolver;
}

type PreviewCapture = NonNullable<GraphParameterEditing['capturePreview']>;

/** Serialize GPU captures and discard superseded results, even if a capture cannot stop immediately. */
export function createMaterialPreviewScheduler(
  onResult: (image: RgbaCapture, options: MaterialPreviewOptions) => void, onError: (error: unknown) => void,
) {
  let pending: { capture: PreviewCapture; options: MaterialPreviewOptions } | undefined;
  let active: AbortController | undefined;
  let running = false;
  async function run(): Promise<void> {
    running = true;
    while (pending) {
      const job = pending;
      pending = undefined;
      const controller = active = new AbortController();
      try {
        const image = await job.capture(job.options, controller.signal);
        if (!controller.signal.aborted) onResult(image, job.options);
      } catch (error) {
        if (!controller.signal.aborted) onError(error);
      } finally {
        active = undefined;
      }
    }
    running = false;
  }
  return {
    request(capture: PreviewCapture, options: MaterialPreviewOptions): void {
      pending = { capture, options };
      active?.abort();
      if (!running) void run();
    },
    cancel(): void {
      pending = undefined;
      active?.abort();
    },
  };
}

function materialPreview(dialog: HTMLDialogElement) {
  const section = document.createElement('section');
  section.className = 'material-preview';
  section.setAttribute('aria-label', 'Aperçu du matériau');
  const controls = document.createElement('div');
  const heading = document.createElement('h3');
  heading.textContent = 'Aperçu du matériau';
  const target = document.createElement('select');
  target.add(new Option('Objet sélectionné', 'object'));
  target.add(new Option('Shaderball', 'shaderball'));
  const targetLabel = document.createElement('label');
  targetLabel.append('Support : ', target);
  const mode = document.createElement('select');
  mode.add(new Option('Raster', 'raster'));
  mode.add(new Option('Path tracing', 'pathtracing'));
  const modeLabel = document.createElement('label');
  modeLabel.append('Moteur : ', mode);
  const samples = document.createElement('input');
  Object.assign(samples, { type: 'number', min: '1', max: '64', step: '1', value: '1', required: true });
  const samplesLabel = document.createElement('label');
  samplesLabel.append('Échantillons par pixel : ', samples);
  samplesLabel.hidden = true;
  const refreshButton = document.createElement('button');
  refreshButton.type = 'button';
  refreshButton.textContent = 'Actualiser';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  canvas.hidden = true;
  canvas.setAttribute('role', 'img');
  controls.append(heading, targetLabel, modeLabel, samplesLabel, refreshButton, status);
  section.append(controls, canvas);
  let capture: PreviewCapture | undefined;
  const scheduler = createMaterialPreviewScheduler((image, options) => {
    if (!dialog.open || !section.isConnected) return;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Impossible d’afficher l’aperçu.');
    canvas.width = image.width;
    canvas.height = image.height;
    const pixels = context.createImageData(image.width, image.height);
    pixels.data.set(image.rgba);
    context.putImageData(pixels, 0, 0);
    const support = options.target === 'object' ? 'Objet sélectionné' : 'Shaderball';
    const engine = options.backend === 'raster' ? 'Raster' : `Path tracing · ${options.samples} échantillon(s) par pixel`;
    canvas.setAttribute('aria-label', `Aperçu du matériau sur ${support}`);
    canvas.hidden = false;
    status.textContent = `${support} · ${engine} · ${image.width} × ${image.height}`;
  }, error => {
    if (!dialog.open || !section.isConnected) return;
    const previous = canvas.hidden ? '' : ' L’image affichée correspond à l’état précédent.';
    status.textContent = `Aperçu impossible : ${error instanceof Error ? error.message : String(error)}.${previous}`;
  });
  function refresh(): void {
    if (!capture || !dialog.open || !section.isConnected) return;
    if (mode.value === 'pathtracing' && !samples.checkValidity()) {
      scheduler.cancel();
      status.textContent = 'Le nombre d’échantillons doit être un entier de 1 à 64.';
      return;
    }
    const selectedTarget = target.value === 'shaderball' ? 'shaderball' : 'object';
    const options: MaterialPreviewOptions = mode.value === 'pathtracing'
      ? { target: selectedTarget, backend: 'pathtracing', samples: samples.valueAsNumber }
      : { target: selectedTarget, backend: 'raster' };
    status.textContent = canvas.hidden ? 'Calcul de l’aperçu…' : 'Actualisation de l’aperçu… (image précédente)';
    scheduler.request(capture, options);
  }
  target.onchange = refresh;
  mode.onchange = () => {
    samplesLabel.hidden = mode.value !== 'pathtracing';
    refresh();
  };
  samples.onchange = refresh;
  refreshButton.onclick = refresh;
  dialog.addEventListener('close', () => scheduler.cancel());
  return {
    section,
    setCapture(next: PreviewCapture | undefined): void {
      if (capture !== next) {
        scheduler.cancel();
        canvas.hidden = true;
        capture = next;
      }
    },
    refresh,
    pause(): void {
      scheduler.cancel();
      status.textContent = canvas.hidden ? 'Modification du matériau…' : 'Modification du matériau… (image précédente)';
    },
  };
}

const materialPreviews = new WeakMap<HTMLDialogElement, ReturnType<typeof materialPreview>>();

function variantRenderComparison(dialog: HTMLDialogElement, capture: NonNullable<GraphParameterEditing['captureVariants']>) {
  const section = document.createElement('details');
  section.className = 'material-variant-renders';
  const summary = document.createElement('summary');
  summary.textContent = 'Comparer les rendus A/B';
  const form = document.createElement('form');
  const controls = document.createElement('fieldset');
  const mode = document.createElement('select');
  mode.add(new Option('Raster', 'raster'));
  mode.add(new Option('Path tracing', 'pathtracing'));
  const modeLabel = document.createElement('label');
  modeLabel.append('Moteur : ', mode);
  const samples = document.createElement('input');
  Object.assign(samples, { type: 'number', min: '1', max: '64', step: '1', value: '8', required: true, disabled: true });
  const samplesLabel = document.createElement('label');
  samplesLabel.append('Échantillons par pixel : ', samples);
  samplesLabel.hidden = true;
  mode.onchange = () => { samplesLabel.hidden = samples.disabled = mode.value !== 'pathtracing'; };
  const button = document.createElement('button');
  button.textContent = 'Générer les aperçus';
  controls.append(modeLabel, ' ', samplesLabel, ' ', button);
  form.append(controls);
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const images = document.createElement('div');
  images.className = 'material-variant-images';
  section.append(summary, form, status, images);
  form.onsubmit = async event => {
    event.preventDefault();
    if (controls.disabled) return;
    const options = samples.disabled ? { backend: 'raster' as const }
      : { backend: 'pathtracing' as const, samples: samples.valueAsNumber };
    const controller = new AbortController();
    const abort = () => controller.abort();
    const isCurrent = () => dialog.open && section.isConnected && !controller.signal.aborted;
    dialog.addEventListener('close', abort, { once: true });
    controls.disabled = true;
    images.replaceChildren();
    status.textContent = 'Calcul des deux aperçus…';
    try {
      const pair = await capture(options, controller.signal);
      if (!isCurrent()) return;
      const figures = (['A', 'B'] as const).map(slot => {
        const { width, height, rgba } = pair[slot];
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `Rendu de la variante ${slot}`);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Impossible d’afficher les aperçus.');
        const pixels = context.createImageData(width, height);
        pixels.data.set(rgba);
        context.putImageData(pixels, 0, 0);
        const figure = document.createElement('figure');
        const caption = document.createElement('figcaption');
        caption.textContent = `Variante ${slot}`;
        figure.append(canvas, caption);
        return figure;
      });
      images.replaceChildren(...figures);
      const engine = options.backend === 'raster' ? 'Raster' : `Path tracing · ${options.samples} échantillon(s) par pixel`;
      status.textContent = `${engine} · ${pair.A.width} × ${pair.A.height}`;
    } catch (error) {
      if (isCurrent()) status.textContent = `Comparaison impossible : ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      dialog.removeEventListener('close', abort);
      controls.disabled = false;
    }
  };
  return {
    section,
    invalidate() {
      images.replaceChildren();
      status.textContent = '';
    },
  };
}

function variantComparison(graphs: readonly [ResolvedGraph, ResolvedGraph]): HTMLDetailsElement {
  const comparison = document.createElement('details');
  comparison.className = 'material-variant-comparison';
  const summary = document.createElement('summary');
  summary.textContent = 'Différences A/B';
  comparison.append(summary);
  comparison.ontoggle = () => {
    if (!comparison.open || comparison.childElementCount > 1) return;
    const differences = compareMaterialGraphs(...graphs);
    if (!differences.length) {
      const empty = document.createElement('p');
      empty.textContent = 'Aucune différence de valeur, de nœud ou de connexion.';
      comparison.append(empty);
      return;
    }
    const table = document.createElement('table');
    table.setAttribute('aria-label', summary.textContent!);
    const headers = table.createTHead().insertRow();
    for (const label of ['Élément', 'Variante A', 'Variante B']) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = label;
      headers.append(cell);
    }
    const body = table.createTBody();
    for (const difference of differences) {
      const row = body.insertRow();
      const name = document.createElement('th');
      name.scope = 'row';
      name.textContent = difference.input === undefined ? difference.node : `${difference.node} · ${difference.input}`;
      row.append(name);
      row.insertCell().textContent = difference.a ?? 'Absent';
      row.insertCell().textContent = difference.b ?? 'Absent';
    }
    comparison.append(table);
  };
  return comparison;
}

function diagnosticText(diagnostic: SurfaceInputDiagnostic): string {
  switch (diagnostic.kind) {
    case 'ignored-input': return 'Entrée ignorée : absente de la définition du nœud (NodeDef).';
    case 'unresolved-interface': return `Interface « ${diagnostic.interfaceName} » introuvable : la valeur par défaut est utilisée.`;
    case 'unsupported-node': return `Nœud « ${diagnostic.nodeId} » (${diagnostic.category}) non pris en charge : sa contribution peut être perdue.`;
    case 'missing-node': return `Connexion incomplète : le nœud « ${diagnostic.nodeId} » est introuvable.`;
  }
}

export function parseGraphNodePositions(raw: string | null, nodeIds: ReadonlySet<string>): Map<string, NodePosition> {
  if (raw === null) return new Map();
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('La disposition enregistrée doit être un objet.');
  }
  const positions = new Map<string, NodePosition>();
  for (const [id, value] of Object.entries(parsed)) {
    if (!nodeIds.has(id)) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Position enregistrée invalide pour ${id}.`);
    }
    const { x, y } = value as { x?: unknown; y?: unknown };
    if (typeof x !== 'number' || typeof y !== 'number'
      || !Number.isFinite(x) || !Number.isFinite(y)
      || x < PADDING || y < PADDING || x > MAX_SAVED_POSITION || y > MAX_SAVED_POSITION) {
      throw new Error(`Position enregistrée invalide pour ${id}.`);
    }
    positions.set(id, { x, y });
  }
  return positions;
}

export function graphNodePositionStorageKey(scope: string | undefined, material: string, slot?: MaterialVariantSlot) {
  if (scope === undefined) return undefined;
  return `${positionStoragePrefix}${encodeURIComponent(scope)}:${encodeURIComponent(material)}:${slot ?? 'current'}`;
}

export function readGraphNodePositions(
  storage: Pick<Storage, 'getItem'>, key: string, nodeIds: ReadonlySet<string>,
): Map<string, NodePosition> {
  return parseGraphNodePositions(storage.getItem(key), nodeIds);
}

export function writeGraphNodePositions(
  storage: Pick<Storage, 'setItem'>, key: string, positions: ReadonlyMap<string, NodePosition>,
): void {
  storage.setItem(key, JSON.stringify(Object.fromEntries(positions)));
}

export function unsupportedSurfaceGraphNodes(graph: ResolvedGraph): string[] {
  const roots = graph.terminals
    .filter(terminal => terminal.name === 'surfaceshader' && terminal.nodeId)
    .map(terminal => terminal.nodeId!);
  const pending = roots.flatMap(id => graph.nodes.get(id)?.inputs.flatMap(input =>
    input.source.kind === 'connection' ? [input.source.nodeId] : []) ?? []);
  const visited = new Set(roots);
  const unsupported: string[] = [];
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = graph.nodes.get(id);
    if (!node) continue;
    if (!SURFACE_IR_UPSTREAM.has(node.category)) unsupported.push(id);
    for (const input of node.inputs) {
      if (input.source.kind === 'connection') pending.push(input.source.nodeId);
    }
  }
  return unsupported;
}

export function layoutMaterialGraph(graph: ResolvedGraph) {
  const depths = new Map<string, number>();
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  const edges: { from: string; to: string; input: string; output?: string }[] = [];
  for (const id of graph.nodes.keys()) {
    incoming.set(id, 0);
    outgoing.set(id, []);
  }
  for (const node of graph.nodes.values()) {
    for (const { name, source } of node.inputs) {
      if (source.kind !== 'connection' || !graph.nodes.has(source.nodeId)) continue;
      edges.push({ from: source.nodeId, to: node.id, input: name, ...(source.output ? { output: source.output } : {}) });
      outgoing.get(source.nodeId)!.push(node.id);
      incoming.set(node.id, incoming.get(node.id)! + 1);
    }
  }

  const ready = [...incoming].filter(([, count]) => count === 0).map(([id]) => id);
  let lastColumn = 0;
  for (let i = 0; i < ready.length; i++) {
    const id = ready[i]!;
    const depth = depths.get(id) ?? 0;
    lastColumn = Math.max(lastColumn, depth);
    for (const target of outgoing.get(id)!) {
      depths.set(target, Math.max(depths.get(target) ?? 0, depth + 1));
      const count = incoming.get(target)! - 1;
      incoming.set(target, count);
      if (count === 0) ready.push(target);
    }
  }

  const rows = new Map<number, number>();
  const positions = new Map<string, NodePosition>();
  let width = 0;
  let height = 0;
  for (const id of graph.nodes.keys()) {
    // Keep cyclic branches visible without blocking the rest of the layout.
    const column = incoming.get(id) === 0 ? depths.get(id) ?? 0 : lastColumn + 1;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    const x = PADDING + column * COLUMN;
    const y = PADDING + row * ROW;
    positions.set(id, { x, y });
    width = Math.max(width, x + COLUMN);
    height = Math.max(height, y + NODE_HEIGHT + PADDING);
  }
  return { positions, edges, width, height };
}

export function showMaterialGraph(
  dialog: HTMLDialogElement, graph: ResolvedGraph | undefined, material: string, editing?: GraphParameterEditing,
  selection?: { id: string; message: string }, positionScope?: string,
): void {
  const title = dialog.querySelector<HTMLElement>('#material-graph-title')!;
  const diagram = dialog.querySelector<HTMLElement>('#material-graph-diagram')!;
  const details = dialog.querySelector<HTMLElement>('#material-graph-details')!;
  const reset = dialog.querySelector<HTMLButtonElement>('#reset-material-graph')!;
  const exportButton = dialog.querySelector<HTMLButtonElement>('#export-material-graph')!;
  const exportStatus = dialog.querySelector<HTMLElement>('#material-graph-export-status')!;
  const backend = dialog.querySelector<HTMLDetailsElement>('#material-graph-backend');
  const previewHost = dialog.querySelector<HTMLElement>('#material-preview');
  let preview = materialPreviews.get(dialog);
  if (previewHost && graph?.nodes.size && editing?.capturePreview) {
    if (!preview) {
      preview = materialPreview(dialog);
      materialPreviews.set(dialog, preview);
    }
    preview.setCapture(editing.capturePreview);
    if (preview.section.parentElement !== previewHost) previewHost.replaceChildren(preview.section);
  } else {
    preview?.setCapture(undefined);
    previewHost?.replaceChildren();
  }
  const comparisonHost = dialog.querySelector<HTMLElement>('#material-variant-renders');
  const comparison = comparisonHost && graph?.nodes.size && editing?.captureVariants
    ? variantRenderComparison(dialog, editing.captureVariants) : undefined;
  comparisonHost?.replaceChildren(...(comparison ? [comparison.section] : []));
  title.textContent = `Graphe du matériau${material ? ` : ${material}` : ''}`;
  diagram.replaceChildren();
  details.replaceChildren();
  reset.hidden = !graph?.nodes.size;
  reset.onclick = null;
  exportButton.hidden = !graph?.nodes.size;
  exportButton.disabled = false;
  exportButton.onclick = null;
  exportStatus.textContent = '';
  const variantStatus = editing?.variants();
  const activeVariant = variantStatus?.A === 'active' ? 'A' : variantStatus?.B === 'active' ? 'B' : undefined;
  const storageKey = graphNodePositionStorageKey(positionScope, material, activeVariant);
  function refreshBackendDiagnostics(): void {
    if (!backend) return;
    const list = backend.querySelector('ul')!;
    list.replaceChildren();
    const diagnostics = graph?.nodes.size ? editing?.backendDiagnostics?.() : undefined;
    const messages = diagnostics && ('error' in diagnostics
      ? [`Conversion refusée : ${diagnostics.error}`] : diagnostics.warnings);
    const summary = backend.querySelector('summary');
    if (summary && diagnostics) summary.textContent = `Compatibilité du matériau avec le moteur ${BACKEND_LABELS[diagnostics.backend]}`;
    backend.hidden = !messages?.length;
    if (backend.hidden) backend.open = false;
    for (const message of messages ?? []) {
      const item = document.createElement('li');
      item.textContent = message;
      list.append(item);
    }
  }
  if (backend && !selection) backend.open = false;
  refreshBackendDiagnostics();
  if (!graph?.nodes.size) {
    diagram.textContent = 'Aucun graphe de surface disponible. Essaie avec une scène USD source.';
    if (!dialog.open) dialog.showModal();
    return;
  }

  let currentGraph = graph;
  const unsupportedNodes = new Set(unsupportedSurfaceGraphNodes(graph));
  let exporting = false;
  function setExporting(value: boolean): void {
    exporting = value;
    exportButton.disabled = value || applying;
    for (const button of details.querySelectorAll<HTMLButtonElement>('[data-export-variant]')) button.disabled = value;
  }
  async function exportGraph(snapshot: ResolvedGraph, name: string): Promise<void> {
    if (exporting || applying) return;
    setExporting(true);
    exportStatus.textContent = 'Préparation de l’export…';
    const handler = exportButton.onclick;
    try {
      const { filename, blob } = await makeMaterialExport(snapshot, name, fetch, editing?.textureSource);
      if (!dialog.open || exportButton.onclick !== handler) return;
      downloadBlob(blob, filename);
      exportStatus.textContent = `Téléchargement lancé : ${filename}`;
    } catch (error) {
      if (exportButton.onclick === handler) exportStatus.textContent = `Export impossible : ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      if (exportButton.onclick === handler) setExporting(false);
    }
  }
  exportButton.onclick = () => exportGraph(currentGraph, material);
  const layout = layoutMaterialGraph(graph);
  const original = new Map(layout.positions);
  const overrides = savedPositions.get(graph) ?? (() => {
    try {
      return storageKey === undefined ? new Map<string, NodePosition>()
        : readGraphNodePositions(localStorage, storageKey, new Set(graph.nodes.keys()));
    } catch (error) {
      exportStatus.textContent = `Disposition précédente ignorée : ${error instanceof Error ? error.message : String(error)}`;
      return new Map<string, NodePosition>();
    }
  })();
  savedPositions.set(graph, overrides);
  const persistPositions = (slot?: MaterialVariantSlot) => {
    const key = slot === undefined ? storageKey : graphNodePositionStorageKey(positionScope, material, slot);
    if (key === undefined) return;
    try {
      writeGraphNodePositions(localStorage, key, overrides);
      if ((exportStatus.textContent ?? '').startsWith('Disposition ')) exportStatus.textContent = '';
    } catch (error) {
      exportStatus.textContent = `Disposition non sauvegardée : ${error instanceof Error ? error.message : String(error)}`;
    }
  };
  for (const [id, position] of overrides) layout.positions.set(id, position);
  let { nodes } = graph;
  const { terminals } = graph;
  const terminalNames = (id: string) => terminals.filter(terminal => terminal.nodeId === id).map(terminal => terminal.name);
  // Keyboard and screen readers pick nodes here; the litegraph canvas is pointer-only.
  const nodeChooser = document.createElement('select');
  nodeChooser.setAttribute('aria-label', 'Nœud sélectionné');
  nodeChooser.setAttribute('aria-describedby', 'material-graph-help');
  for (const node of nodes.values()) {
    const terminalsOfNode = terminalNames(node.id);
    nodeChooser.add(new Option(`${node.id} · ${node.category}${terminalsOfNode.length ? ` (sortie : ${terminalsOfNode.join(', ')})` : ''}`, node.id));
  }
  nodeChooser.onchange = () => {
    select(nodeChooser.value);
    graphView?.select(nodeChooser.value, true);
  };
  const canvasHost = document.createElement('div');
  canvasHost.className = 'material-graph-canvas';
  diagram.append(nodeChooser, canvasHost);
  let graphView: NodeGraphView | undefined;
  const surface = canvasHost;
  reset.onclick = () => {
    overrides.clear();
    for (const [id, position] of original) layout.positions.set(id, position);
    persistPositions();
    showGraphView(true);
  };
  let applying = false;
  /** In-graph edits (links, parameter widgets) rebuild the dialog like the details form does. */
  async function graphEdit(edit: () => Promise<ResolvedGraph | void>, selectId: (graph: ResolvedGraph) => string, message: string): Promise<void> {
    if (applying || !editing) return;
    applying = true;
    exportButton.disabled = true;
    exportStatus.textContent = 'Modification du graphe…';
    preview?.pause();
    try {
      const updated = await edit();
      if (updated) {
        if (!savedPositions.has(updated)) {
          savedPositions.set(updated, new Map([...overrides].filter(([key]) => updated.nodes.has(key))));
        }
        applying = false;
        if (dialog.open && surface.isConnected) {
          showMaterialGraph(dialog, updated, material, editing, { id: selectId(updated), message }, positionScope);
        }
      }
      exportStatus.textContent = '';
    } catch (error) {
      exportStatus.textContent = `Échec : ${error instanceof Error ? error.message : String(error)}`;
      showGraphView(false);
      preview?.refresh();
    } finally {
      applying = false;
      if (surface.isConnected) exportButton.disabled = exporting;
    }
  }
  function graphModel(): { models: GraphNode[]; links: GraphLink[] } {
    const models: GraphNode[] = [];
    const links: GraphLink[] = [];
    for (const node of nodes.values()) {
      const outputs = node.nodeDef?.outputs?.length ? node.nodeDef.outputs.map(output => ({ name: output.name, type: output.type }))
        : [{ name: 'out', type: node.type }];
      const parameters = new Map(editing?.parameters(node.id).map(parameter => [parameter.input, parameter]));
      const inputs: GraphInput[] = node.inputs.map((input) => {
        const parameter = input.source.kind === 'value' ? parameters.get(input.name) : undefined;
        if (!parameter) return { name: input.name, type: input.type };
        const scalar = parameter.value.length === 1;
        const value: GraphValue = parameter.type === 'boolean' ? parameter.value[0] === 1 : scalar ? parameter.value[0]! : parameter.value;
        const widget: GraphWidget = parameter.type === 'boolean' ? { kind: 'toggle' }
          : scalar ? { kind: 'number', integer: parameter.type === 'integer',
            ...(parameter.min?.[0] !== undefined ? { min: parameter.min[0] } : {}), ...(parameter.max?.[0] !== undefined ? { max: parameter.max[0] } : {}) }
            : { kind: 'text' };
        return { name: input.name, type: input.type, value, widget };
      });
      for (const input of node.inputs) {
        if (input.source.kind !== 'connection' || !nodes.has(input.source.nodeId)) continue;
        const source = nodes.get(input.source.nodeId)!;
        const output = input.source.output ?? source.nodeDef?.outputs?.[0]?.name ?? 'out';
        links.push({ from: source.id, output, to: node.id, input: input.name });
      }
      const terminalsOfNode = terminalNames(node.id);
      // Nodegraph paths are in the list above the canvas; nodes show their own name.
      const name = node.id.split('/').at(-1)!;
      models.push({
        id: node.id,
        title: terminalsOfNode.length ? `${name} → ${terminalsOfNode.join(', ')}` : `${name} : ${node.category}`,
        inputs, outputs, editable: !!editing, warning: unsupportedNodes.has(node.id),
      });
    }
    return { models, links };
  }
  function showGraphView(useLayout: boolean): void {
    if (!graphView) return;
    const { models, links } = graphModel();
    if (useLayout) graphView.resetPositions();
    graphView.set(models, links, new Map([...layout.positions].map(([id, { x, y }]) => [id, [x, y] as const])));
  }
  void loadNodeGraphView().then(({ NodeGraphView: View }) => {
    if (!surface.isConnected) return;
    graphView = new View(canvasHost, {
      onSelect: id => { if (id && id !== nodeChooser.value) select(id); },
      onMove: (id, [x, y]) => {
        const position = { x: Math.max(PADDING, Math.min(MAX_SAVED_POSITION, x)), y: Math.max(PADDING, Math.min(MAX_SAVED_POSITION, y)) };
        layout.positions.set(id, position);
        overrides.set(id, position);
        persistPositions();
      },
      onValue: (id, input, value) => {
        const parameter = editing?.parameters(id).find(candidate => candidate.input === input);
        if (!parameter) return;
        const values = typeof value === 'boolean' ? [Number(value)] : typeof value === 'number' ? [value] : Array.isArray(value) ? [...value] : undefined;
        if (!values || values.length !== parameter.value.length) return;
        void graphEdit(() => editing!.apply(new Map([[parameter.id, values]])).then(updated => updated ?? undefined),
          () => id, `${input} modifié.`).then(() => { if (dialog.open) select(id, `${input} modifié.`); });
      },
      onLink: link => void graphEdit(() => editing!.setInputLink(link.to, link.input, link.from, link.output), () => link.to, 'Sortie connectée.'),
      onUnlink: (id, input) => {
        if (editing?.canUnlinkInput(id, input)) {
          void graphEdit(() => editing.setInputLink(id, input, null), () => id, 'Connexion précédente restaurée.');
        } else {
          exportStatus.textContent = `${input} : pas de connexion précédente à restaurer ; connecte une autre sortie à la place.`;
          showGraphView(false);
        }
      },
    });
    showGraphView(false);
    graphView.select(nodeChooser.value, true);
  });
  function select(id: string, message = ''): void {
    if (applying) return;
    const node = nodes.get(id)!;
    nodeChooser.value = id;
    graphView?.select(id);
    const heading = document.createElement('h3');
    heading.textContent = `${node.id} · ${node.category} (${node.type})`;
    details.replaceChildren(heading);
    if (unsupportedNodes.has(id)) {
      const warning = document.createElement('p');
      warning.className = 'material-graph-warning';
      warning.textContent = 'Aucun lowering WGSL : la contribution peut être remplacée par une valeur neutre.';
      details.append(warning);
    }
    if (!node.inputs.length) details.append('Aucune entrée.');
    const parameters = new Map(editing?.parameters(id).map(parameter => [parameter.input, parameter]));
    const diagnostics = new Map(editing?.diagnostics(id).map(diagnostic => [diagnostic.input, diagnostic]));
    const form = document.createElement('form');
    const fields = document.createElement('fieldset');
    const editors: { parameter: MaterialParameter; controls: HTMLInputElement[] }[] = [];
    const literalEditors: { control: HTMLInputElement; initial: string }[] = [];
    const status = document.createElement('p');
    status.role = 'status';
    status.textContent = message;
    form.append(fields, status);
    details.append(form);
    const changesFromForm = () => {
      const changes = new Map<string, readonly number[]>();
      for (const { parameter, controls } of editors) {
        const values = controls.map(control => control.type === 'checkbox' ? Number(control.checked) : control.valueAsNumber);
        if (values.some((value, index) => value !== parameter.value[index])) changes.set(parameter.id, values);
      }
      return changes;
    };
    async function changeTopology(
      edit: () => Promise<ResolvedGraph>, next: (graph: ResolvedGraph) => string, message: string,
      committingLiteral?: HTMLInputElement,
    ): Promise<void> {
      if (applying) return;
      if (changesFromForm().size || literalEditors.some(editor =>
        editor.control !== committingLiteral && editor.control.value !== editor.initial)) {
        status.textContent = 'Applique les valeurs modifiées avant de modifier le graphe.';
        return;
      }
      applying = true;
      fields.disabled = true;
      exportButton.disabled = true;
      status.textContent = 'Modification du graphe…';
      preview?.pause();
      try {
        const updated = await edit();
        if (!savedPositions.has(updated)) {
          savedPositions.set(updated, new Map([...overrides].filter(([key]) => updated.nodes.has(key))));
        }
        if (dialog.open && surface.isConnected) showMaterialGraph(dialog, updated, material, editing, {
          id: next(updated), message,
        }, positionScope);
      } catch (error) {
        status.textContent = `Échec : ${error instanceof Error ? error.message : String(error)}`;
        preview?.refresh();
      } finally {
        applying = false;
        fields.disabled = false;
        if (surface.isConnected) exportButton.disabled = exporting;
      }
    }
    const variants = editing?.variants();
    if (comparison) comparison.section.hidden = !variants || variants.A === 'empty' || variants.B === 'empty';
    if (editing && variants) {
      const tools = document.createElement('div');
      tools.setAttribute('role', 'group');
      tools.setAttribute('aria-label', 'Variantes A/B');
      const a = editing.variantGraph('A');
      const b = editing.variantGraph('B');
      for (const slot of ['A', 'B'] as const) {
        const save = document.createElement('button');
        save.type = 'button';
        save.textContent = variants[slot] === 'empty' ? `Enregistrer ${slot}` : `Remplacer ${slot}`;
        save.disabled = variants[slot] === 'active';
        save.onclick = () => {
          if (changesFromForm().size || literalEditors.some(editor => editor.control.value !== editor.initial)) {
            status.textContent = 'Applique les valeurs modifiées avant d’enregistrer la variante.';
            return;
          }
          try {
            editing.saveVariant(slot);
            persistPositions(slot);
            comparison?.invalidate();
            select(id, `Variante ${slot} enregistrée.`);
            nodeChooser.focus({ preventScroll: true });
          } catch (error) {
            status.textContent = `Échec : ${error instanceof Error ? error.message : String(error)}`;
          }
        };
        const apply = document.createElement('button');
        apply.type = 'button';
        apply.textContent = variants[slot] === 'active' ? `${slot} active` : `Afficher ${slot}`;
        apply.disabled = variants[slot] !== 'saved';
        apply.onclick = () => changeTopology(() => editing.applyVariant(slot), updated =>
          updated.nodes.has(id) ? id : updated.terminals.find(terminal => terminal.name === 'surfaceshader')?.nodeId ?? id,
        `Variante ${slot} affichée.`);
        tools.append(save, ' ', apply, ' ');
        const snapshot = slot === 'A' ? a : b;
        if (snapshot) {
          const download = document.createElement('button');
          download.type = 'button';
          download.textContent = `Exporter ${slot}`;
          download.dataset.exportVariant = slot;
          download.disabled = exporting;
          download.onclick = () => exportGraph(snapshot, `${material || 'Material'}_${slot}`);
          tools.append(download, ' ');
        }
      }
      if (a && b) tools.append(variantComparison([a, b]));
      fields.prepend(tools);
    }
    for (const input of node.inputs) {
      const row = document.createElement('p');
      const { source } = input;
      row.textContent = `${input.name} (${input.type}) : `;
      const parameter = parameters.get(input.name);
      if (parameter && source.kind === 'value') {
        const controls = parameter.value.map((value, index) => {
          const control = document.createElement('input');
          control.setAttribute('aria-label', parameter.value.length === 1 ? input.name : `${input.name}, composante ${index + 1}`);
          if (parameter.type === 'boolean') {
            control.type = 'checkbox';
            control.checked = value === 1;
          } else {
            control.type = 'number';
            control.required = true;
            control.step = parameter.type === 'integer' ? '1' : 'any';
            control.value = String(value);
            if (parameter.min?.[index] !== undefined) control.min = String(parameter.min[index]);
            if (parameter.max?.[index] !== undefined) control.max = String(parameter.max[index]);
          }
          return control;
        });
        row.append(...controls);
        editors.push({ parameter, controls });
      } else if (source.kind === 'connection') {
        const label = `${source.nodeId}${source.output ? `.${source.output}` : ''}`;
        if (nodes.has(source.nodeId)) {
          const link = document.createElement('button');
          link.type = 'button';
          link.textContent = label;
          link.onclick = () => { select(source.nodeId); nodeChooser.focus(); };
          row.append(link);
        } else row.append(`${label} (indisponible)`);
      } else {
        row.append(source.kind === 'value' ? source.value
          : source.kind === 'interface' ? `interface ${source.name}` : 'valeur par défaut');
      }
      if (editing && (source.kind === 'value' || source.kind === 'default')
        && !parameter && input.parameter === undefined && input.type === 'filename') {
        const warning = document.createElement('span');
        warning.className = 'material-graph-warning';
        warning.textContent = 'Fichier en lecture seule : sa modification nécessite de recharger les textures.';
        row.append(' ', warning);
      } else if (editing && (source.kind === 'value' || source.kind === 'default')
        && !parameter && input.parameter === undefined) {
        const literal = document.createElement('input');
        literal.type = 'text';
        literal.value = source.kind === 'value' ? source.value : '';
        const initial = literal.value;
        literal.setAttribute('aria-label', `${input.name} (${input.type})`);
        const applyLiteral = document.createElement('button');
        applyLiteral.type = 'button';
        applyLiteral.textContent = 'Appliquer la valeur littérale';
        applyLiteral.onclick = () => changeTopology(
          () => editing.setInputValue(id, input.name, literal.value), () => id,
          'Valeur littérale modifiée.', literal,
        );
        literalEditors.push({ control: literal, initial });
        row.append(' ', literal, ' ', applyLiteral);
      }
        if (editing) {
          const existingOutputs = editing.outputs(id, input.name);
          const nodeChoices = compatibleNodeOutputChoices(editing.nodeDefinitions(), input.type);
          if (existingOutputs.length || nodeChoices.length) {
            type SourceChoice = { kind: 'existing'; nodeId: string; output: string }
              | { kind: 'new'; nodeDef: string; output: string };
            const sources = document.createElement('select');
            sources.setAttribute('aria-label', `Sortie MaterialX compatible : ${input.name}`);
            sources.add(new Option('Choisir une sortie compatible…', ''));
            if (existingOutputs.length) {
              const group = document.createElement('optgroup');
              group.label = 'Nœuds du graphe';
              for (const output of existingOutputs) {
                const choice: SourceChoice = { kind: 'existing', nodeId: output.nodeId, output: output.output };
                group.append(new Option(output.label, JSON.stringify(choice)));
              }
              sources.append(group);
            }
            if (nodeChoices.length) {
              const group = document.createElement('optgroup');
              group.label = 'Ajouter un NodeDef MaterialX';
              for (const choice of nodeChoices) {
                const value: SourceChoice = { kind: 'new', nodeDef: choice.nodeDef.name, output: choice.output.name };
                const label = SURFACE_IR_UPSTREAM.has(choice.nodeDef.nodeString)
                  ? choice.label : `${choice.label} — rendu WGSL non pris en charge (valeur neutre possible)`;
                group.append(new Option(label, JSON.stringify(value)));
              }
              sources.append(group);
            }
            const connect = document.createElement('button');
            connect.type = 'button';
            connect.textContent = 'Connecter au port';
            connect.setAttribute('aria-label', `Connecter au port : ${input.name}`);
            connect.disabled = true;
            sources.onchange = () => { connect.disabled = !sources.value; };
            connect.onclick = () => {
              const choice = JSON.parse(sources.value) as SourceChoice;
              const operation = choice.kind === 'existing'
                ? editing.setInputLink(id, input.name, choice.nodeId, choice.output)
                : editing.addNode(id, input.name, choice.nodeDef, choice.output);
              void changeTopology(() => operation, updated => {
                const binding = updated.nodes.get(id)?.inputs.find(candidate => candidate.name === input.name)?.source;
                return binding?.kind === 'connection' ? binding.nodeId
                  : updated.terminals.find(terminal => terminal.name === 'surfaceshader')?.nodeId ?? id;
              }, choice.kind === 'new' ? 'Nœud MaterialX ajouté et connecté.' : 'Sortie connectée.');
            };
            row.append(' ', sources, ' ', connect);
          }
          if (editing.canUnlinkInput(id, input.name)) {
            const unlink = document.createElement('button');
            unlink.type = 'button';
            unlink.textContent = 'Restaurer la connexion précédente';
            unlink.setAttribute('aria-label', `Restaurer la connexion précédente : ${input.name}`);
            unlink.onclick = () => changeTopology(
              () => editing.setInputLink(id, input.name, null), () => id, 'Connexion précédente restaurée.',
            );
            row.append(' ', unlink);
          }
      }
      const diagnostic = diagnostics.get(input.name);
      if (diagnostic) {
        const warning = document.createElement('span');
        warning.className = 'material-graph-warning';
        warning.textContent = diagnosticText(diagnostic);
        row.append(warning);
      }
      fields.append(row);
    }
    if (!editing || !editors.length) return;
    const apply = document.createElement('button');
    apply.type = 'submit';
    apply.textContent = 'Appliquer les valeurs';
    fields.append(apply);
    form.onsubmit = async event => {
      event.preventDefault();
      if (literalEditors.some(editor => editor.control.value !== editor.initial)) {
        status.textContent = 'Applique les valeurs littérales avant les paramètres numériques.';
        return;
      }
      if (applying) return;
      const changes = changesFromForm();
      if (!changes.size) {
        status.textContent = 'Aucune valeur modifiée.';
        return;
      }
      applying = true;
      fields.disabled = true;
      exportButton.disabled = true;
      status.textContent = 'Application en cours…';
      preview?.pause();
      try {
        const updated = await editing.apply(changes);
        if (updated) {
          currentGraph = updated;
          nodes = updated.nodes;
          savedPositions.set(updated, overrides);
        }
      } catch (error) {
        status.textContent = `Échec : ${error instanceof Error ? error.message : String(error)}`;
        preview?.refresh();
        return;
      } finally {
        applying = false;
        fields.disabled = false;
        if (surface.isConnected) exportButton.disabled = exporting;
      }
      if (dialog.open && surface.isConnected) {
        refreshBackendDiagnostics();
        preview?.refresh();
        select(id, 'Valeurs appliquées.');
        showGraphView(false);
        nodeChooser.focus({ preventScroll: true });
      }
    };
  }

  const selected = selection && nodes.has(selection.id) ? selection.id
    : terminals.find(terminal => terminal.nodeId && nodes.has(terminal.nodeId))?.nodeId ?? nodes.keys().next().value!;
  select(selected, selection?.message);
  if (!dialog.open) dialog.showModal();
  else nodeChooser.focus();
  preview?.refresh();
}
