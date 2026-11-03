import { LAYERED_CLOSURE_PRELUDE } from '../../compiler/surface-wgsl.ts';

export const SHADING_PROFILE_EVENTS = 64;
export const SHADING_PROFILE_HEADER_WORDS = 4;

interface ScalarField { path: string; type: 'u32' | 'f32' }

function closureFields(maxLobes: number): ScalarField[] {
  if (!Number.isInteger(maxLobes) || maxLobes < 1 || maxLobes > 8) {
    throw new Error('Shading profile lobe capacity must be an integer from 1 to 8.');
  }
  const structs = new Map([...LAYERED_CLOSURE_PRELUDE.matchAll(/struct (\w+)\s*\{([^}]+)\}/g)]
    .map(match => [match[1]!, match[2]!]));
  const expand = (type: string, path: string): ScalarField[] => {
    if (type === 'f32' || type === 'u32') return [{ path, type }];
    if (type === 'vec3f') return ['x', 'y', 'z'].map(axis => ({ path: `${path}.${axis}`, type: 'f32' }));
    if (type === 'array<MxBsdfLobe, MX_MAX_LOBES>') {
      return Array.from({ length: maxLobes }, (_, i) => expand('MxBsdfLobe', `${path}[${i}]`)).flat();
    }
    const body = structs.get(type);
    if (!body) throw new Error(`Unsupported shading profile field type: ${type}`);
    const members = [...body.matchAll(/(\w+)\s*:\s*(array<MxBsdfLobe,\s*MX_MAX_LOBES>|\w+)\s*(?:[,;]|$)/g)];
    if (members.map(match => match[0]).join('').replace(/\s/g, '') !== body.replace(/\s/g, '')) {
      throw new Error(`Unsupported shading profile struct schema: ${type}`);
    }
    return members
      .flatMap(match => expand(match[2]!.trim(), `${path}.${match[1]}`));
  };
  return expand('LayeredClosure', 'c');
}

export function shadingProfileLayout(maxLobes: number) {
  const closureWords = closureFields(maxLobes).length;
  const inputWords = 7 + closureWords;
  const eventWords = inputWords + 8;
  return { closureWords, inputWords, eventWords,
    sampleWords: SHADING_PROFILE_HEADER_WORDS + SHADING_PROFILE_EVENTS * eventWords };
}

export function shadingProfileBytes(width: number, height: number, samples: number, maxLobes: number): number {
  if (![width, height, samples].every(n => Number.isSafeInteger(n) && n > 0)) {
    throw new Error('Shading profile dimensions and samples must be positive safe integers.');
  }
  const bytes = width * height * samples * shadingProfileLayout(maxLobes).sampleWords * 4;
  if (!Number.isSafeInteger(bytes) || bytes > 128 * 1024 * 1024) {
    throw new Error('Shading profile exceeds its 128 MiB memory budget; reduce resolution or spp.');
  }
  return bytes;
}

export interface ShadingWorkload {
  samples: number;
  calls: number;
  evalCalls: number;
  specularEvalCalls: number;
  sampleCalls: number;
  activeLobes: number;
  maxEventsPerSample: number;
  bytes: number;
}

export function readShadingProfile(words: Uint32Array, samples: number, maxLobes: number, replayed = false): ShadingWorkload {
  const fields = closureFields(maxLobes), layout = shadingProfileLayout(maxLobes);
  if (!Number.isSafeInteger(samples) || samples < 1 || words.length !== samples * layout.sampleWords) {
    throw new Error('Shading profile buffer shape differs from expected sample count.');
  }
  const floats = new Float32Array(words.buffer, words.byteOffset, words.length);
  const lobeCountField = fields.findIndex(field => field.path === 'c.lobeCount');
  if (lobeCountField < 0 || fields[lobeCountField]!.type !== 'u32') {
    throw new Error('Shading profile schema requires a uint lobe count.');
  }
  const workload: ShadingWorkload = { samples, calls: 0, evalCalls: 0, specularEvalCalls: 0, sampleCalls: 0,
    activeLobes: 0, maxEventsPerSample: 0, bytes: words.byteLength };
  for (let sample = 0; sample < samples; sample++) {
    const base = sample * layout.sampleWords, count = words[base]!;
    if (words[base + 1] !== 0 || count > SHADING_PROFILE_EVENTS) throw new Error(`Shading log overflow at sample ${sample}.`);
    if (replayed && (words[base + 2] !== 0 || words[base + 3] !== count)) {
      throw new Error(`Shading replay input/count mismatch at sample ${sample}.`);
    }
    workload.calls += count;
    workload.maxEventsPerSample = Math.max(workload.maxEventsPerSample, count);
    for (let call = 0; call < count; call++) {
      const slot = base + SHADING_PROFILE_HEADER_WORDS + call * layout.eventWords;
      const kind = words[slot]!;
      if (kind > 2) throw new Error('Invalid shading profile call kind.');
      if (kind === 0) workload.evalCalls++;
      else if (kind === 1) workload.specularEvalCalls++;
      else workload.sampleCalls++;
      const lobes = words[slot + 7 + lobeCountField]!;
      if (lobes > maxLobes) throw new Error('Invalid shading profile lobe count.');
      workload.activeLobes += lobes;
      const finite = (index: number) => {
        if (!Number.isFinite(floats[index])) throw new Error('Non-finite shading profile input/output.');
      };
      for (let i = 1; i < 7; i++) finite(slot + i);
      for (const [i, field] of fields.entries()) if (field.type === 'f32') finite(slot + 7 + i);
      const output = slot + layout.inputWords;
      for (let i = 0; i < 7; i++) finite(output + i);
      if (words[output + 7]! > 1 || floats[output + 6]! < 0) throw new Error('Invalid shading profile output flags/pdf.');
    }
  }
  return workload;
}

/** Wrap only integrator-facing calls; library-internal calls remain uninstrumented. */
export function shadingProfileWgsl(samples: number, maxLobes: number): string {
  shadingProfileBytes(1, 1, samples, maxLobes);
  const fields = closureFields(maxLobes), { inputWords, eventWords, sampleWords } = shadingProfileLayout(maxLobes);
  const inputs = ['kind', ...['wo.x', 'wo.y', 'wo.z', 'arg.x', 'arg.y', 'arg.z'].map(v => `bitcast<u32>(${v})`),
    ...fields.map(field => field.type === 'u32' ? field.path : `bitcast<u32>(${field.path})`)];
  const wrappers = [
    { name: 'mx_closure_eval', kind: 0, result: 'MxBsdfEval', call: 'wo, arg' },
    { name: 'mx_closure_specular_eval', kind: 1, result: 'MxBsdfEval', call: 'wo, arg' },
    { name: 'mx_closure_sample', kind: 2, result: 'MxBsdfSample', call: 'wo, arg' },
  ].map(({ name, kind, result, call }) => {
    const sampling = kind === 2;
    return `
fn profile_${name}(c: LayeredClosure, wo: vec3f, arg: vec3f) -> ${result} {
  if (U.profileMode == 0u) { return ${name}(c, ${call}); }
  let event = profileCursor;
  profileCursor++;
  if (event >= ${SHADING_PROFILE_EVENTS}u) {
    profileLog[profileBase + 1u] = 1u;
    return ${name}(c, ${call});
  }
  let slot = profileBase + ${SHADING_PROFILE_HEADER_WORDS}u + event * ${eventWords}u;
  if (U.profileMode == 1u || U.profileMode == 3u) { profile_shading_inputs(slot, ${kind}u, c, wo, arg); }
  if (U.profileMode == 1u) {
    let value = ${name}(c, ${call});
    let wi = ${sampling ? 'value.wi' : 'vec3f(0.0)'};
    profileLog[slot + ${inputWords}u] = bitcast<u32>(wi.x);
    profileLog[slot + ${inputWords + 1}u] = bitcast<u32>(wi.y);
    profileLog[slot + ${inputWords + 2}u] = bitcast<u32>(wi.z);
    profileLog[slot + ${inputWords + 3}u] = bitcast<u32>(value.value.x);
    profileLog[slot + ${inputWords + 4}u] = bitcast<u32>(value.value.y);
    profileLog[slot + ${inputWords + 5}u] = bitcast<u32>(value.value.z);
    profileLog[slot + ${inputWords + 6}u] = bitcast<u32>(value.pdf);
    profileLog[slot + ${inputWords + 7}u] = ${sampling ? 'u32(value.valid)' : '1u'};
    return value;
  }
  let wi = vec3f(bitcast<f32>(profileLog[slot + ${inputWords}u]),
                 bitcast<f32>(profileLog[slot + ${inputWords + 1}u]), bitcast<f32>(profileLog[slot + ${inputWords + 2}u]));
  let value = vec3f(bitcast<f32>(profileLog[slot + ${inputWords + 3}u]),
                    bitcast<f32>(profileLog[slot + ${inputWords + 4}u]), bitcast<f32>(profileLog[slot + ${inputWords + 5}u]));
  let pdf = bitcast<f32>(profileLog[slot + ${inputWords + 6}u]);
  return ${sampling ? `MxBsdfSample(wi, value, pdf, profileLog[slot + ${inputWords + 7}u] != 0u)` : 'MxBsdfEval(value, pdf)'};
}`;
  }).join('\n');
  return `
@group(0) @binding(11) var<storage, read_write> profileLog : array<u32>;
const PROFILE_SPP = ${samples}u;
const PROFILE_WORDS = ${sampleWords}u;
var<private> profileBase : u32;
var<private> profileCursor : u32;
fn profile_shading_inputs(slot: u32, kind: u32, c: LayeredClosure, wo: vec3f, arg: vec3f) {
${inputs.map((value, i) => `  if (U.profileMode == 1u) { profileLog[slot + ${i}u] = ${value}; }
  else if (profileLog[slot + ${i}u] != ${value}) { profileLog[profileBase + 2u] = 1u; }`).join('\n')}
}
${wrappers}`;
}

export function instrumentShadingIntegrator(code: string): string {
  for (const name of ['mx_closure_eval', 'mx_closure_specular_eval', 'mx_closure_sample']) {
    const pattern = new RegExp(`\\b${name}\\(`, 'g');
    if (!pattern.test(code) && name !== 'mx_closure_specular_eval') {
      throw new Error(`Shading instrumentation no longer matches integrator: ${name}`);
    }
    code = code.replace(pattern, `profile_${name}(`);
  }
  return code;
}
