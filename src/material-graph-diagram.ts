import { downloadBlob } from './assets/download.ts';
import { compareMaterialGraphs } from './materialx/graph-comparison.ts';
import { makeMaterialExport } from './materialx/graph-export.ts';
import type { ResolvedGraph } from './materialx/graph.ts';
import type { SurfaceInputDiagnostic } from './materialx/surface-graph.ts';
import type { InteractiveViewer, MaterialVariantSlot } from './render/viewer.ts';
import type { EditableInputNode, MaterialParameter } from './render/material-parameters.ts';

const NODE_WIDTH = 174;
const NODE_HEIGHT = 54;
const COLUMN = 232;
const ROW = 80;
const PADDING = 16;
const SVG = 'http://www.w3.org/2000/svg';
type NodePosition = { x: number; y: number };
const savedPositions = new WeakMap<ResolvedGraph, Map<string, NodePosition>>();

interface GraphParameterEditing {
  parameters(nodeId: string): readonly MaterialParameter[];
  diagnostics(nodeId: string): readonly SurfaceInputDiagnostic[];
  disneyDiagnostics?(): ReturnType<InteractiveViewer['objectDisneyMaterialDiagnostics']>;
  apply(changes: ReadonlyMap<string, readonly number[]>): Promise<ResolvedGraph | undefined>;
  canInsertConstant(nodeId: string, input: string, kind?: EditableInputNode): boolean;
  setConstant(nodeId: string, input: string, insert: boolean, kind?: EditableInputNode): Promise<ResolvedGraph>;
  constantSources(nodeId: string, input: string): readonly string[];
  canUnlinkConstant(nodeId: string, input: string): boolean;
  setConstantLink(nodeId: string, input: string, sourceId: string | null): Promise<ResolvedGraph>;
  variants(): Readonly<Record<MaterialVariantSlot, 'empty' | 'active' | 'saved'>> | undefined;
  variantGraph(slot: MaterialVariantSlot): ResolvedGraph | undefined;
  saveVariant(slot: MaterialVariantSlot): void;
  applyVariant(slot: MaterialVariantSlot): Promise<ResolvedGraph>;
  captureVariants?(
    options: Parameters<InteractiveViewer['captureObjectMaterialVariants']>[1], signal: AbortSignal,
  ): ReturnType<InteractiveViewer['captureObjectMaterialVariants']>;
}

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
  selection?: { id: string; message: string },
): void {
  const title = dialog.querySelector<HTMLElement>('#material-graph-title')!;
  const diagram = dialog.querySelector<HTMLElement>('#material-graph-diagram')!;
  const details = dialog.querySelector<HTMLElement>('#material-graph-details')!;
  const reset = dialog.querySelector<HTMLButtonElement>('#reset-material-graph')!;
  const exportButton = dialog.querySelector<HTMLButtonElement>('#export-material-graph')!;
  const exportStatus = dialog.querySelector<HTMLElement>('#material-graph-export-status')!;
  const backend = dialog.querySelector<HTMLDetailsElement>('#material-graph-backend');
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
  function refreshBackendDiagnostics(): void {
    if (!backend) return;
    const list = backend.querySelector('ul')!;
    list.replaceChildren();
    const diagnostics = graph?.nodes.size ? editing?.disneyDiagnostics?.() : undefined;
    const messages = diagnostics && ('error' in diagnostics
      ? [`Conversion refusée : ${diagnostics.error}`] : diagnostics.warnings);
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
      const { filename, blob } = await makeMaterialExport(snapshot, name);
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
  const overrides = savedPositions.get(graph) ?? new Map<string, NodePosition>();
  savedPositions.set(graph, overrides);
  for (const [id, position] of overrides) layout.positions.set(id, position);
  let width = Math.max(layout.width + COLUMN, 640);
  let height = Math.max(layout.height + ROW, 260);
  for (const { x, y } of overrides.values()) {
    width = Math.max(width, x + NODE_WIDTH + 48);
    height = Math.max(height, y + NODE_HEIGHT + PADDING);
  }
  let { nodes } = graph;
  const { terminals } = graph;
  const surface = document.createElement('div');
  surface.className = 'material-graph-surface';
  surface.style.cssText = `width:${width}px;height:${height}px;--node-width:${NODE_WIDTH}px;--node-height:${NODE_HEIGHT}px`;
  const links = document.createElementNS(SVG, 'svg');
  links.setAttribute('width', String(width));
  links.setAttribute('height', String(height));
  links.setAttribute('aria-hidden', 'true');
  function drawLink(edge: typeof layout.edges[number], path: SVGPathElement): void {
    const a = layout.positions.get(edge.from)!;
    const b = layout.positions.get(edge.to)!;
    const x1 = a.x + NODE_WIDTH;
    const y1 = a.y + NODE_HEIGHT / 2;
    const y2 = b.y + NODE_HEIGHT / 2;
    const bend = Math.max(24, (b.x - x1) / 2);
    path.setAttribute('d', b.x > x1
      ? `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${b.x - bend} ${y2}, ${b.x} ${y2}`
      : `M ${x1} ${y1} C ${x1 + 38} ${y1}, ${x1 + 38} ${y2 - 30}, ${b.x + NODE_WIDTH} ${y2 - 12}`);
  }
  const paths = layout.edges.map(edge => {
    const path = document.createElementNS(SVG, 'path');
    drawLink(edge, path);
    links.append(path);
    return path;
  });
  surface.append(links);

  const buttons = new Map<string, HTMLButtonElement>();
  function setPosition(button: HTMLButtonElement, { x, y }: NodePosition): void {
    button.style.left = `${x}px`;
    button.style.top = `${y}px`;
  }
  function move(id: string, button: HTMLButtonElement, x: number, y: number): void {
    const position = {
      x: Math.max(PADDING, Math.min(width - NODE_WIDTH - 48, x)),
      y: Math.max(PADDING, Math.min(height - NODE_HEIGHT - PADDING, y)),
    };
    layout.positions.set(id, position);
    overrides.set(id, position);
    setPosition(button, position);
    layout.edges.forEach((edge, index) => {
      if (edge.from === id || edge.to === id) drawLink(edge, paths[index]!);
    });
  }
  reset.onclick = () => {
    overrides.clear();
    for (const [id, position] of original) {
      layout.positions.set(id, position);
      setPosition(buttons.get(id)!, position);
    }
    layout.edges.forEach((edge, index) => drawLink(edge, paths[index]!));
  };
  let applying = false;
  function select(id: string, message = ''): void {
    if (applying) return;
    const node = nodes.get(id)!;
    for (const [key, button] of buttons) button.setAttribute('aria-pressed', String(key === id));
    layout.edges.forEach((edge, index) => paths[index]!.classList.toggle('active', edge.from === id || edge.to === id));
    const heading = document.createElement('h3');
    heading.textContent = `${node.id} · ${node.category} (${node.type})`;
    details.replaceChildren(heading);
    if (!node.inputs.length) details.append('Aucune entrée.');
    const parameters = new Map(editing?.parameters(id).map(parameter => [parameter.input, parameter]));
    const diagnostics = new Map(editing?.diagnostics(id).map(diagnostic => [diagnostic.input, diagnostic]));
    const form = document.createElement('form');
    const fields = document.createElement('fieldset');
    const editors: { parameter: MaterialParameter; controls: HTMLInputElement[] }[] = [];
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
    ): Promise<void> {
      if (applying) return;
      if (changesFromForm().size) {
        status.textContent = 'Applique les valeurs modifiées avant de modifier le graphe.';
        return;
      }
      applying = true;
      fields.disabled = true;
      exportButton.disabled = true;
      status.textContent = 'Modification du graphe…';
      try {
        const updated = await edit();
        if (!savedPositions.has(updated)) {
          savedPositions.set(updated, new Map([...overrides].filter(([key]) => updated.nodes.has(key))));
        }
        if (dialog.open && surface.isConnected) showMaterialGraph(dialog, updated, material, editing, {
          id: next(updated), message,
        });
      } catch (error) {
        status.textContent = `Échec : ${error instanceof Error ? error.message : String(error)}`;
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
          if (changesFromForm().size) {
            status.textContent = 'Applique les valeurs modifiées avant d’enregistrer la variante.';
            return;
          }
          try {
            editing.saveVariant(slot);
            comparison?.invalidate();
            select(id, `Variante ${slot} enregistrée.`);
            buttons.get(id)?.focus({ preventScroll: true });
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
        for (const [kind, name, owned] of [
          ['constant', 'Constant', parameter.constantFor !== undefined],
          ['multiply', 'Multiply', parameter.arithmeticFor?.kind === 'multiply'],
          ['add', 'Add', parameter.arithmeticFor?.kind === 'add'],
        ] as const) {
          if (!editing) continue;
          const insert = editing.canInsertConstant(id, input.name, kind);
          if (!insert && !owned) continue;
          const action = document.createElement('button');
          action.type = 'button';
          action.textContent = insert ? `Insérer un ${name}` : 'Revenir à une valeur littérale';
          action.setAttribute('aria-label', `${action.textContent} : ${input.name}`);
          if (!insert && layout.edges.filter(edge => edge.from === id).length > 1) {
            action.disabled = true;
            row.append(' Retire d’abord les liens supplémentaires.');
          }
          action.onclick = () => changeTopology(() => editing.setConstant(id, input.name, insert, kind), updated => {
            const binding = updated.nodes.get(id)?.inputs.find(candidate => candidate.name === input.name)?.source;
            return binding?.kind === 'connection' ? binding.nodeId
              : updated.terminals.find(terminal => terminal.name === 'surfaceshader')?.nodeId ?? id;
          }, insert ? `Nœud ${name} connecté.` : 'Valeur littérale restaurée.');
          row.append(' ', action);
        }
      } else if (source.kind === 'connection') {
        const upstream = buttons.get(source.nodeId);
        const label = `${source.nodeId}${source.output ? `.${source.output}` : ''}`;
        if (upstream) {
          const link = document.createElement('button');
          link.type = 'button';
          link.textContent = label;
          link.onclick = () => { select(source.nodeId); upstream.focus(); };
          row.append(link);
        } else row.append(`${label} (indisponible)`);
        if (editing?.canUnlinkConstant(id, input.name)) {
          const unlink = document.createElement('button');
          unlink.type = 'button';
          unlink.textContent = 'Retirer le lien';
          unlink.setAttribute('aria-label', `Retirer le lien : ${input.name}`);
          unlink.onclick = () => changeTopology(() => editing.setConstantLink(id, input.name, null), () => id, 'Lien retiré. Valeur précédente restaurée.');
          row.append(' ', unlink);
        }
      } else {
        row.append(source.kind === 'value' ? source.value
          : source.kind === 'interface' ? `interface ${source.name}` : 'valeur par défaut');
      }
      const candidates = (parameter || source.kind === 'connection') ? editing?.constantSources(id, input.name) ?? [] : [];
      if (editing && candidates.length) {
        const replacing = source.kind === 'connection';
        const sources = document.createElement('select');
        sources.setAttribute('aria-label', `Constant existant : ${input.name}`);
        sources.add(new Option(replacing ? 'Choisir un autre Constant…' : 'Choisir un Constant…', ''));
        for (const candidate of candidates) sources.add(new Option(candidate, candidate));
        const connect = document.createElement('button');
        connect.type = 'button';
        connect.textContent = replacing ? 'Remplacer le lien' : 'Connecter';
        connect.setAttribute('aria-label', `${replacing ? 'Remplacer le lien' : 'Connecter un Constant'} : ${input.name}`);
        connect.disabled = true;
        sources.onchange = () => { connect.disabled = !sources.value; };
        connect.onclick = () => changeTopology(() => editing.setConstantLink(id, input.name, sources.value), () => id,
          replacing ? 'Lien remplacé.' : 'Lien créé.');
        row.append(' ', sources, ' ', connect);
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
      try {
        const updated = await editing.apply(changes);
        if (updated) {
          currentGraph = updated;
          nodes = updated.nodes;
          savedPositions.set(updated, overrides);
        }
      } catch (error) {
        status.textContent = `Échec : ${error instanceof Error ? error.message : String(error)}`;
        return;
      } finally {
        applying = false;
        fields.disabled = false;
        if (surface.isConnected) exportButton.disabled = exporting;
      }
      if (dialog.open && surface.isConnected) {
        refreshBackendDiagnostics();
        select(id, 'Valeurs appliquées.');
        buttons.get(id)?.focus({ preventScroll: true });
      }
    };
  }

  for (const node of nodes.values()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'material-graph-node';
    setPosition(button, layout.positions.get(node.id)!);
    button.title = `${node.id} · ${node.category}`;
    button.setAttribute('aria-describedby', 'material-graph-help');
    const label = document.createElement('strong');
    label.textContent = node.id;
    const terminalNames = terminals.filter(terminal => terminal.nodeId === node.id).map(terminal => terminal.name);
    const category = document.createElement('span');
    category.textContent = terminalNames.length ? `Sortie : ${terminalNames.join(', ')}` : node.category;
    button.append(label, category);
    button.onclick = () => select(node.id);
    let drag: { pointerId: number; offset: NodePosition; client: NodePosition; moved: boolean } | undefined;
    button.onpointerdown = event => {
      if (event.button !== 0 || !event.isPrimary) return;
      const bounds = button.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId, moved: false,
        offset: { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        client: { x: event.clientX, y: event.clientY },
      };
      button.setPointerCapture(event.pointerId);
    };
    button.onpointermove = event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!drag.moved && Math.hypot(event.clientX - drag.client.x, event.clientY - drag.client.y) < 4) return;
      drag.moved = true;
      const bounds = surface.getBoundingClientRect();
      move(node.id, button, event.clientX - bounds.left - drag.offset.x, event.clientY - bounds.top - drag.offset.y);
    };
    button.onlostpointercapture = event => {
      if (drag?.pointerId === event.pointerId) drag = undefined;
    };
    button.onkeydown = event => {
      const delta = ({ ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] } as const);
      if (!(event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown')) return;
      event.preventDefault();
      const [dx, dy] = delta[event.key];
      const { x, y } = layout.positions.get(node.id)!;
      move(node.id, button, x + dx, y + dy);
    };
    buttons.set(node.id, button);
    surface.append(button);
  }
  diagram.append(surface);
  const selected = selection && buttons.has(selection.id) ? selection.id
    : terminals.find(terminal => terminal.nodeId && buttons.has(terminal.nodeId))?.nodeId ?? buttons.keys().next().value!;
  select(selected, selection?.message);
  if (!dialog.open) dialog.showModal();
  else buttons.get(selected)?.focus();
}
