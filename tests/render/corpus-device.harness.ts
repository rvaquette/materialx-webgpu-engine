// Real-GPU corpus harness (T034e). Loaded in Chrome on the connected mobile
// (SM-F731B) through `adb reverse` + Vite: it requests a WebGPU device, runs
// every runnable corpus node (T034a cases) as a compute dispatch via the shared
// harness (src/gpu/exec.ts), and collects the read-back outputs. The results are
// POSTed to the orchestration collector (T034g) and compared against the CPU
// oracle (T034f). Nothing here runs under Node: it is served to the device.

import { NODE_CASES, CLOSURE_LOBE_CASES, type NodeCase, type ClosureLobeCase } from '../fixtures/node-cases.ts';
import { buildNodeIr, buildLobeIr, isRunnableOnGpu } from '../fixtures/node-ir.ts';
import { runNodeOnGpu, type NodeExecInputs } from '../../src/gpu/exec.ts';
import { PipelineCache } from '../../src/gpu/pipelines.ts';

export interface DeviceNodeResult {
  readonly category: string;
  readonly exec: NodeCase['exec'];
  readonly out: NodeCase['out'];
  readonly output: readonly number[] | null;
  readonly error?: string;
}

export interface DeviceLobeResult {
  readonly category: string;
  readonly kind: ClosureLobeCase['kind'];
  readonly output: readonly number[] | null;
  readonly error?: string;
}

export interface DeviceReport {
  readonly userAgent: string;
  readonly adapter: Record<string, string>;
  readonly results: readonly DeviceNodeResult[];
  readonly lobes?: readonly DeviceLobeResult[];
}

/** Bind the deterministic 1x1 texel (opaque) for texture cases; nothing otherwise. */
function execInputs(c: NodeCase): NodeExecInputs {
  if (c.exec === 'texture') {
    const t = c.inputs[0]!;
    const texel: [number, number, number, number] = [t[0]!, t[1]!, t[2]!, 1];
    return { textures: { tex: texel } };
  }
  return {};
}

/** Run every runnable corpus node once on a real device and collect read-backs. */
export async function runCorpusOnDevice(device: GPUDevice): Promise<DeviceNodeResult[]> {
  const cache = new PipelineCache<GPUComputePipeline>();
  const results: DeviceNodeResult[] = [];
  for (const c of NODE_CASES) {
    if (!isRunnableOnGpu(c)) continue;
    const head = { category: c.category, exec: c.exec, out: c.out };
    try {
      const ir = buildNodeIr(c);
      const { output } = await runNodeOnGpu(device, ir, execInputs(c), cache);
      results.push({ ...head, output: Array.from(output) });
    } catch (err) {
      results.push({ ...head, output: null, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

/** Run every per-lobe closure case (T042) on the device with the default lighting
 * context, so the read-back can be compared to the analytic reference oracle. */
export async function runLobesOnDevice(device: GPUDevice): Promise<DeviceLobeResult[]> {
  const cache = new PipelineCache<GPUComputePipeline>();
  const results: DeviceLobeResult[] = [];
  for (const c of CLOSURE_LOBE_CASES) {
    const head = { category: c.category, kind: c.kind };
    try {
      const ir = buildLobeIr(c);
      // No overrides: the harness binds DEFAULT_VARYINGS + DEFAULT_LIGHTING, which
      // the reference oracle (CLOSURE_LOBE_GEOM / defaultLighting) mirrors exactly.
      const { output } = await runNodeOnGpu(device, ir, {}, cache);
      results.push({ ...head, output: Array.from(output) });
    } catch (err) {
      results.push({ ...head, output: null, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

function adapterFields(adapter: GPUAdapter): Record<string, string> {
  const info = adapter.info;
  if (!info) return {};
  return {
    vendor: info.vendor,
    architecture: info.architecture,
    device: info.device,
    description: info.description,
  };
}

/** Browser entry: acquire the device, run the corpus, render a table and POST the report. */
export async function bootstrap(): Promise<DeviceReport> {
  const root = typeof document !== 'undefined' ? document.getElementById('log') ?? document.body : undefined;
  const line = (msg: string): void => {
    if (!root) return;
    const p = document.createElement('p');
    p.textContent = msg;
    root.appendChild(p);
  };

  if (typeof navigator === 'undefined' || !navigator.gpu) {
    const report: DeviceReport = { userAgent: ua(), adapter: {}, results: [] };
    line('WebGPU indisponible sur cet appareil.');
    await post(report);
    return report;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    const report: DeviceReport = { userAgent: ua(), adapter: {}, results: [] };
    line('Aucun adaptateur WebGPU.');
    await post(report);
    return report;
  }
  const device = await adapter.requestDevice();

  line('Execution du corpus sur le GPU...');
  const results = await runCorpusOnDevice(device);
  line('Execution des lobes closure sur le GPU...');
  const lobes = await runLobesOnDevice(device);
  const report: DeviceReport = { userAgent: ua(), adapter: adapterFields(adapter), results, lobes };

  renderTable(root, results);
  renderLobeTable(root, lobes);
  const ok = results.filter((r) => r.output && !r.error).length;
  const lobeOk = lobes.filter((r) => r.output && !r.error).length;
  line(`${ok}/${results.length} noeuds, ${lobeOk}/${lobes.length} lobes executes, envoi du rapport...`);
  (globalThis as { __MX_REPORT__?: DeviceReport }).__MX_REPORT__ = report;
  await post(report);
  line('Rapport envoye.');
  return report;
}

function ua(): string {
  return typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
}

function renderTable(root: HTMLElement | undefined, results: readonly DeviceNodeResult[]): void {
  if (!root) return;
  const table = document.createElement('table');
  table.border = '1';
  for (const r of results) {
    const row = table.insertRow();
    row.insertCell().textContent = r.category;
    row.insertCell().textContent = r.error ? `ERR: ${r.error}` : (r.output ?? []).map((n) => n.toFixed(4)).join(', ');
  }
  root.appendChild(table);
}

function renderLobeTable(root: HTMLElement | undefined, lobes: readonly DeviceLobeResult[]): void {
  if (!root) return;
  const heading = document.createElement('h2');
  heading.textContent = 'Lobes closure (T042)';
  root.appendChild(heading);
  const table = document.createElement('table');
  table.border = '1';
  for (const r of lobes) {
    const row = table.insertRow();
    row.insertCell().textContent = `${r.category} (${r.kind})`;
    row.insertCell().textContent = r.error ? `ERR: ${r.error}` : (r.output ?? []).map((n) => n.toFixed(4)).join(', ');
  }
  root.appendChild(table);
}

async function post(report: DeviceReport): Promise<void> {
  try {
    await fetch('/collect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
    });
  } catch {
    // The collector (T034g) may be absent during a manual run; the on-page table still shows results.
  }
}
