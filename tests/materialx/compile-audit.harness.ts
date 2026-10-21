import { loadMaterialXCore } from '../../src/materialx/wasm.ts';
import { defaultLibrarySources, MaterialXLibraries } from '../../src/materialx/libraries.ts';
import { loadMaterialXDocuments } from '../../src/materialx/document-source.ts';
import { createGraphMaterialCompiler } from '../../src/render/graph-material-compiler.ts';
import { assembleIrForwardShader } from '../../src/render/raster/ir-forward.ts';
import { SCENE_IR_VERTEX_LAYOUTS } from '../../src/render/raster/backend.ts';
import { buildMaterialDispatch } from '../../src/render/pathtracing/material-variant.ts';
import { pathTraceComputeWgsl, PT_COMPUTE_ENTRY } from '../../src/render/pathtracing/compute.ts';
import { compileShaderWithDiagnostics, type ShaderCompilationError } from '../../src/gpu/shader-diagnostics.ts';
import type { Diagnostic } from '../../src/core/diagnostics.ts';

export type AuditStatus = 'compiled' | 'incomplete' | 'failed' | 'skipped';
export interface AuditDiagnostic { level: string; message: string }
export interface AuditShader {
  backend: 'raster' | 'pathtracing';
  errors: ShaderCompilationError[];
  failure: string | null;
}
export interface AuditMaterial {
  material: string;
  status: AuditStatus;
  diagnostics: AuditDiagnostic[];
  shaders: AuditShader[];
  nodes: { category: string; nodeDef: string | null; inputs: string[] }[];
}
export interface AuditFile {
  file: string;
  status: AuditStatus;
  reason?: string;
  materials: AuditMaterial[];
  diagnostics: AuditDiagnostic[];
}

export function compilationStatus(shaders: readonly AuditShader[], diagnostics: readonly AuditDiagnostic[]): AuditStatus {
  if (shaders.length !== 2 || shaders.some((shader) => shader.errors.length > 0 || shader.failure !== null) || diagnostics.some((diagnostic) => diagnostic.level === 'error')) return 'failed';
  return diagnostics.some((diagnostic) => /unsupported|no WGSL lowering|no implementation|not covered|neutral constant|would be lost/i.test(diagnostic.message)) ? 'incomplete' : 'compiled';
}

export function summarizeCompilation(files: readonly AuditFile[]): Record<AuditStatus, number> {
  const summary = { compiled: 0, incomplete: 0, failed: 0, skipped: 0 };
  for (const file of files) summary[file.status]++;
  return summary;
}

export async function createCompilationAudit() {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  const device = await adapter.requestDevice();
  let lost: string | undefined;
  void device.lost.then((info) => { lost = info.message; });
  const base = new URL(`${import.meta.env.BASE_URL}materialx/`, document.baseURI).href;
  const core = await loadMaterialXCore({ moduleUrl: `${base}JsMaterialXCore.js`, locateFile: (path) => base + path });
  const libraries = new MaterialXLibraries(core);
  await libraries.load({
    sources: defaultLibrarySources(`${base}libraries`),
    fetchText: async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      return response.text();
    },
  });

  async function compile(backend: AuditShader['backend'], code: string, label: string): Promise<AuditShader> {
    const result: AuditShader = { backend, errors: [], failure: null };
    device.pushErrorScope('validation');
    try {
      const checked = await compileShaderWithDiagnostics(device, code, label);
      result.errors = checked.errors;
      if (checked.errors.length === 0) {
        if (backend === 'raster') {
          await device.createRenderPipelineAsync({
            label, layout: 'auto',
            vertex: { module: checked.module, entryPoint: 'vs_forward', buffers: SCENE_IR_VERTEX_LAYOUTS },
            fragment: { module: checked.module, entryPoint: 'fs_forward', targets: [{ format: 'rgba16float' }] },
            primitive: { topology: 'triangle-list' },
            depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
          });
        } else {
          await device.createComputePipelineAsync({ label, layout: 'auto', compute: { module: checked.module, entryPoint: PT_COMPUTE_ENTRY } });
        }
      }
    } catch (error) {
      result.failure = error instanceof Error ? error.message : String(error);
    } finally {
      const validation = await device.popErrorScope();
      if (validation && result.errors.length === 0) result.failure ??= validation.message;
    }
    return result;
  }

  async function runFile(file: string): Promise<AuditFile> {
    if (lost !== undefined) throw new Error(`WebGPU device lost: ${lost}`);
    const diagnostics: AuditDiagnostic[] = [];
    const sink = ({ level, message }: Diagnostic): void => { diagnostics.push({ level, message }); };
    const result: AuditFile = { file, status: 'failed', materials: [], diagnostics };
    const response = await fetch(new URL(file, document.baseURI));
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${file}`);
    const text = await response.text();
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    const parseError = xml.querySelector('parsererror');
    if (parseError) throw new Error(parseError.textContent ?? 'Invalid MaterialX XML');
    const names = [...xml.querySelectorAll('surfacematerial')].map((element) => element.getAttribute('name') ?? '');
    if (names.length === 0) return { ...result, status: 'skipped', reason: 'No surfacematerial terminal' };
    const documents = await loadMaterialXDocuments({ core, libraries, texts: new Map([[file, text]]), sink });
    try {
      const compiler = createGraphMaterialCompiler({ documents, sink, surfaceOptions: { onDiagnostic: sink } });
      for (const material of names) {
        const start = diagnostics.length;
        const build = await compiler.compile({ assetPath: file, materialName: material, referencedPrimPath: material, boundPrims: [] });
        const shaders: AuditShader[] = [];
        if (build?.layered && build.graph && build.surface) {
          for (const backend of ['raster', 'pathtracing'] as const) {
            try {
              const code = backend === 'raster'
                ? assembleIrForwardShader(build.layered, { displacement: build.displacement !== undefined }).code
                : pathTraceComputeWgsl({ dispatch: buildMaterialDispatch([{ materialIndex: 0, graph: build.graph, surface: build.surface }]) });
              shaders.push(await compile(backend, code, `${file}:${material}:${backend}`));
            } catch (error) {
              shaders.push({ backend, errors: [], failure: String(error) });
            }
          }
        }
        const messages = diagnostics.slice(start);
        result.materials.push({
          material,
          status: compilationStatus(shaders, messages),
          diagnostics: messages,
          shaders,
          nodes: [...(build?.graph?.nodes.values() ?? [])].map((node) => ({
            category: node.category,
            nodeDef: node.nodeDef?.name ?? null,
            inputs: node.inputs.map((input) => input.name),
          })),
        });
      }
      result.status = diagnostics.some((diagnostic) => diagnostic.level === 'error') || result.materials.some((material) => material.status === 'failed') ? 'failed'
        : result.materials.some((material) => material.status === 'incomplete') ? 'incomplete' : 'compiled';
      return result;
    } finally {
      documents.delete();
    }
  }

  return {
    adapter: { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description, userAgent: navigator.userAgent },
    runFile,
    close: () => { libraries.delete(); device.destroy(); },
  };
}