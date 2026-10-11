// Reusable WebGPU compute harness for the per-node conformance run (T034d). The
// WGSL backend emits `fn mx_shade(vary: MxVaryings) -> MxOutputs`; this module
// wraps it in a `@compute` entry that bakes deterministic varyings, calls the
// node, and writes the single output into a storage buffer that is read back.
// Composition (string level) is pure and Node-testable; runNodeOnGpu performs
// the actual device work and runs in the browser / on the connected mobile.

import { hashString } from '../compiler/cache.ts';
import { emitWgsl, type WgslModule } from '../compiler/wgsl.ts';
import type { IrType, ShaderIr } from '../compiler/ir.ts';
import { PipelineCache } from './pipelines.ts';

export const COMPUTE_ENTRY = 'mx_exec';
const RESULT_GROUP = 3;

export interface VaryingValues {
  position: readonly [number, number, number];
  normal: readonly [number, number, number];
  tangent: readonly [number, number, number];
  bitangent: readonly [number, number, number];
  texcoord: readonly [number, number];
  viewDir: readonly [number, number, number];
}

export const DEFAULT_VARYINGS: VaryingValues = {
  position: [0.25, -0.5, 0.75],
  normal: [0, 0, 1],
  tangent: [1, 0, 0],
  bitangent: [0, 1, 0],
  texcoord: [0.3, 0.7],
  viewDir: [0, 0, 1],
};

export interface VaryingField {
  name: string;
  wgslType: string;
  width: number;
}
export interface VaryingFields {
  primvars: VaryingField[];
  inputs: VaryingField[];
}

export interface ExecOverrides {
  varyings?: Partial<VaryingValues>;
  primvars?: Readonly<Record<string, readonly number[]>>;
  inputs?: Readonly<Record<string, readonly number[]>>;
}

const KNOWN_VARYINGS = new Set(['position', 'normal', 'tangent', 'bitangent', 'texcoord']);
const isViewName = (n: string): boolean => n === 'view' || n === 'viewdir' || n === 'viewdirection';

function widthOf(type: IrType): number {
  return type.kind === 'vector' ? type.size : 1;
}
function wgslOf(type: IrType): string {
  if (type.kind === 'scalar') return type.scalar === 'float' ? 'f32' : type.scalar === 'int' ? 'i32' : 'bool';
  if (type.kind === 'vector') return `vec${type.size}${type.scalar === 'float' ? 'f' : type.scalar === 'int' ? 'i' : 'u'}`;
  return 'f32';
}

/** Collect the dynamic MxVaryings fields (primvars + non-varying inputs) the emitter adds. */
export function collectVaryingFields(ir: ShaderIr): VaryingFields {
  // Mirror emitWgsl: v_<name> comes from 'primvar' expr nodes, in_<name> from non-varying 'input' nodes.
  const primvars: VaryingField[] = [];
  const inputs: VaryingField[] = [];
  for (const expr of ir.exprs.values()) {
    if (expr.kind === 'primvar') {
      if (primvars.some((p) => p.name === expr.name)) continue;
      primvars.push({ name: expr.name, wgslType: wgslOf(expr.type), width: widthOf(expr.type) });
      continue;
    }
    if (expr.kind !== 'input') continue;
    const lower = expr.name.toLowerCase();
    if (KNOWN_VARYINGS.has(lower) || isViewName(lower)) continue;
    if (inputs.some((i) => i.name === expr.name)) continue;
    inputs.push({ name: expr.name, wgslType: wgslOf(expr.type), width: widthOf(expr.type) });
  }
  return { primvars, inputs };
}

function litFloat(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`non-finite varying literal ${n}`);
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}
function litVec(values: readonly number[]): string {
  if (values.length === 1) return litFloat(values[0]!);
  return `vec${values.length}f(${values.map(litFloat).join(', ')})`;
}

export function outputComponentCount(wgslType: string): number {
  switch (wgslType) {
    case 'f32':
      return 1;
    case 'vec2f':
      return 2;
    case 'vec3f':
      return 3;
    case 'vec4f':
      return 4;
    case 'Closure':
      return 4; // color.xyz + weight
    default:
      throw new Error(`unsupported output type ${wgslType}`);
  }
}

function resultWrites(field: string, wgslType: string): string[] {
  const src = `mxOut.${field}`;
  switch (wgslType) {
    case 'f32':
      return [`mxResult[0] = ${src};`];
    case 'vec2f':
      return [`mxResult[0] = ${src}.x;`, `mxResult[1] = ${src}.y;`];
    case 'vec3f':
      return [`mxResult[0] = ${src}.x;`, `mxResult[1] = ${src}.y;`, `mxResult[2] = ${src}.z;`];
    case 'vec4f':
      return ['x', 'y', 'z', 'w'].map((c, i) => `mxResult[${i}] = ${src}.${c};`);
    case 'Closure':
      return [
        `mxResult[0] = ${src}.color.x;`,
        `mxResult[1] = ${src}.color.y;`,
        `mxResult[2] = ${src}.color.z;`,
        `mxResult[3] = ${src}.weight;`,
      ];
    default:
      throw new Error(`unsupported output type ${wgslType}`);
  }
}

function defaultPrimvar(width: number, v: VaryingValues): readonly number[] {
  if (width === 2) return v.texcoord;
  if (width === 3) return v.position;
  return new Array(width).fill(0);
}

/** Wrap an emitted node module into a full compute module that runs it once. */
export function composeComputeModule(
  module: WgslModule,
  fields: VaryingFields,
  overrides: ExecOverrides = {},
): string {
  const out = module.outputs[0];
  if (!out) throw new Error('module has no output to execute');
  const v: VaryingValues = { ...DEFAULT_VARYINGS, ...overrides.varyings };

  const assigns: string[] = [
    `  vary.position = ${litVec(v.position)};`,
    `  vary.normal = ${litVec(v.normal)};`,
    `  vary.tangent = ${litVec(v.tangent)};`,
    `  vary.bitangent = ${litVec(v.bitangent)};`,
    `  vary.texcoord = ${litVec(v.texcoord)};`,
    `  vary.viewDir = ${litVec(v.viewDir)};`,
  ];
  for (const f of fields.primvars) {
    const value = overrides.primvars?.[f.name] ?? defaultPrimvar(f.width, v);
    assigns.push(`  vary.v_${f.name} = ${litVec(value)};`);
  }
  for (const f of fields.inputs) {
    const value = overrides.inputs?.[f.name] ?? new Array(f.width).fill(0);
    assigns.push(`  vary.in_${f.name} = ${litVec(value)};`);
  }

  const wrapper = [
    '',
    '// --- compute execution harness (T034d) ---',
    `@group(${RESULT_GROUP}) @binding(0) var<storage, read_write> mxResult : array<f32>;`,
    '@compute @workgroup_size(1)',
    `fn ${COMPUTE_ENTRY}() {`,
    '  var vary : MxVaryings;',
    ...assigns,
    '  let mxOut = mx_shade(vary);',
    ...resultWrites(out.field, out.wgslType).map((w) => `  ${w}`),
    '}',
    '',
  ].join('\n');

  return module.code + wrapper;
}

// --- Device execution ---------------------------------------------------------

export interface NodeExecInputs extends ExecOverrides {
  /** Editable uniform values keyed by param name. */
  params?: Readonly<Record<string, number | readonly number[]>>;
  /** One texel (RGBA) per declared texture, sampled as a 1x1 image. */
  textures?: Readonly<Record<string, readonly [number, number, number, number]>>;
  /** Lighting context for surface nodes (directional lights + environment). */
  lighting?: LightingInput;
}

export interface LightInput {
  /** Direction the light travels (scene convention); L = normalize(-direction). */
  direction: readonly [number, number, number];
  color: readonly [number, number, number];
  intensity: number;
}

export interface LightingInput {
  /** Constant environment/ambient radiance. */
  environment?: readonly [number, number, number];
  lights?: readonly LightInput[];
}

/** Mirror of MX_MAX_LIGHTS in the WGSL surface prelude. */
export const MX_MAX_LIGHTS = 4;

export const DEFAULT_LIGHTING: Required<LightingInput> = {
  environment: [0.03, 0.03, 0.03],
  lights: [{ direction: [0, 0, -1], color: [1, 1, 1], intensity: 1 }],
};

/** Pack a LightingInput into the std140 MxLighting layout (params vec4 + MX_MAX_LIGHTS * MxLight). */
export function packLighting(input: LightingInput = {}): ArrayBuffer {
  const environment = input.environment ?? DEFAULT_LIGHTING.environment;
  const lights = input.lights ?? DEFAULT_LIGHTING.lights;
  const count = Math.min(lights.length, MX_MAX_LIGHTS);
  const data = new Float32Array(4 + MX_MAX_LIGHTS * 8);
  data[0] = count;
  data[1] = environment[0];
  data[2] = environment[1];
  data[3] = environment[2];
  for (let i = 0; i < count; i++) {
    const base = 4 + i * 8;
    const l = lights[i]!;
    data[base] = l.direction[0];
    data[base + 1] = l.direction[1];
    data[base + 2] = l.direction[2];
    data[base + 3] = l.intensity;
    data[base + 4] = l.color[0];
    data[base + 5] = l.color[1];
    data[base + 6] = l.color[2];
    data[base + 7] = 0;
  }
  return data.buffer;
}

const STD140_ALIGN: Readonly<Record<string, number>> = { f32: 4, i32: 4, vec2f: 8, vec3f: 16, vec4f: 16 };
const STD140_SIZE: Readonly<Record<string, number>> = { f32: 4, i32: 4, vec2f: 8, vec3f: 12, vec4f: 16 };

function packParams(module: WgslModule, params: Readonly<Record<string, number | readonly number[]>>): ArrayBuffer {
  let offset = 0;
  const writes: { offset: number; values: number[] }[] = [];
  for (const u of module.uniforms) {
    const align = STD140_ALIGN[u.wgslType] ?? 4;
    const size = STD140_SIZE[u.wgslType] ?? 4;
    offset = Math.ceil(offset / align) * align;
    const raw = params[u.name];
    const values = raw === undefined ? [] : typeof raw === 'number' ? [raw] : [...raw];
    writes.push({ offset, values });
    offset += size;
  }
  const bytes = Math.max(16, Math.ceil(offset / 16) * 16);
  const buffer = new ArrayBuffer(bytes);
  const view = new Float32Array(buffer);
  for (const w of writes) w.values.forEach((val, i) => (view[w.offset / 4 + i] = val));
  return buffer;
}

export interface GpuExecResult {
  output: Float32Array;
  code: string;
}

/**
 * Compose, compile and run one node module on a real GPUDevice, returning the
 * read-back output components. Pure composition is reused on every backend.
 */
export async function runNodeOnGpu(
  device: GPUDevice,
  ir: ShaderIr,
  inputs: NodeExecInputs = {},
  cache?: PipelineCache<GPUComputePipeline>,
): Promise<GpuExecResult> {
  const module = emitWgsl(ir);
  const fields = collectVaryingFields(ir);
  const code = composeComputeModule(module, fields, inputs);
  const comps = outputComponentCount(module.outputs[0]!.wgslType);

  const build = async (): Promise<GPUComputePipeline> => {
    const shader = device.createShaderModule({ code });
    return device.createComputePipelineAsync({
      layout: 'auto',
      compute: { module: shader, entryPoint: COMPUTE_ENTRY },
    });
  };
  const pipeline = cache ? await cache.getOrCreate(hashString(code), build) : await build();

  const resultBuffer = device.createBuffer({
    size: comps * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const readback = device.createBuffer({ size: comps * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

  const cleanup: GPUTexture[] = [];
  const bindGroups: { index: number; group: GPUBindGroup }[] = [];

  if (module.uniforms.length > 0 || module.lighting) {
    const entries: GPUBindGroupEntry[] = [];
    if (module.uniforms.length > 0) {
      const data = packParams(module, inputs.params ?? {});
      const ubo = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(ubo, 0, data);
      entries.push({ binding: 0, resource: { buffer: ubo } });
    }
    if (module.lighting) {
      const data = packLighting(inputs.lighting);
      const lbo = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(lbo, 0, data);
      entries.push({ binding: module.lighting.binding, resource: { buffer: lbo } });
    }
    bindGroups.push({
      index: 0,
      group: device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries }),
    });
  }
  if (module.textures.length > 0) {
    const entries: GPUBindGroupEntry[] = module.textures.map((t) => {
      const texel = inputs.textures?.[t.name] ?? [0, 0, 0, 1];
      // rgba8unorm is filterable on every device; rgba32float needs float32-filterable (absent on most mobile GPUs).
      const texture = device.createTexture({
        size: [1, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      const bytes = Uint8Array.from(texel, (c) => Math.round(Math.min(Math.max(c, 0), 1) * 255));
      device.queue.writeTexture({ texture }, bytes, { bytesPerRow: 4 }, [1, 1]);
      cleanup.push(texture);
      return { binding: t.binding, resource: texture.createView() };
    });
    bindGroups.push({ index: 1, group: device.createBindGroup({ layout: pipeline.getBindGroupLayout(1), entries }) });
  }
  if (module.samplers.length > 0) {
    const sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
    const entries: GPUBindGroupEntry[] = module.samplers.map((s) => ({ binding: s.binding, resource: sampler }));
    bindGroups.push({ index: 2, group: device.createBindGroup({ layout: pipeline.getBindGroupLayout(2), entries }) });
  }
  bindGroups.push({
    index: RESULT_GROUP,
    group: device.createBindGroup({
      layout: pipeline.getBindGroupLayout(RESULT_GROUP),
      entries: [{ binding: 0, resource: { buffer: resultBuffer } }],
    }),
  });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  for (const bg of bindGroups) pass.setBindGroup(bg.index, bg.group);
  pass.dispatchWorkgroups(1, 1, 1);
  pass.end();
  encoder.copyBufferToBuffer(resultBuffer, 0, readback, 0, comps * 4);
  device.queue.submit([encoder.finish()]);

  await readback.mapAsync(GPUMapMode.READ);
  const output = new Float32Array(readback.getMappedRange().slice(0));
  readback.unmap();

  readback.destroy();
  resultBuffer.destroy();
  for (const t of cleanup) t.destroy();

  return { output, code };
}
