import type { DisneyRenderSettings } from './disney-render.ts';

export type DisneyShaderSpecialization = Pick<DisneyRenderSettings,
  | 'lightCount' | 'rrDepth' | 'russianRoulette' | 'uniformLight' | 'hideEmitters'
  | 'transparentBackground' | 'alphaTest' | 'medium' | 'volumeMis' | 'flipNormalY'
  | 'mollify' | 'environmentLinear'>;

const SPECIALIZATION_OPTION_KEYS = [
  'lightCount', 'rrDepth', 'russianRoulette', 'uniformLight', 'hideEmitters',
  'transparentBackground', 'alphaTest', 'medium', 'volumeMis', 'flipNormalY', 'mollify', 'environmentLinear',
] as const satisfies readonly (keyof DisneyShaderSpecialization)[];

const SPECIALIZED_FIELDS = {
  disneyPathTrace: [
    'lightCount', 'rrDepth', 'russianRoulette', 'uniformLight', 'hideEmitters',
    'transparentBackground', 'alphaTest', 'medium', 'volumeMis', 'flipNormalY', 'mollify', 'environmentLinear',
  ],
  disneyPathDirect: ['lightCount', 'uniformLight', 'medium', 'volumeMis'],
  disneyPathShadow: ['lightCount', 'alphaTest', 'medium'],
  disneyPathEvaluateScatter: ['medium', 'volumeMis'],
} as const satisfies Record<string, readonly (keyof DisneyShaderSpecialization)[]>;

export function assertDisneyShaderSpecialization(
  settings: DisneyShaderSpecialization, specialization: DisneyShaderSpecialization,
): void {
  for (const field of SPECIALIZATION_OPTION_KEYS) {
    if (settings[field] !== specialization[field]) {
      throw new Error(`Disney render option ${field} differs from its compiled shader specialization.`);
    }
  }
}

function optionLiteral(field: keyof DisneyShaderSpecialization, value: number | boolean): string {
  if (field === 'lightCount' || field === 'rrDepth') {
    if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 0 || value > 0x7fffffff) {
      throw new Error(`Invalid Disney shader specialization for ${field}.`);
    }
    return `${value}u`;
  }
  if (typeof value !== 'boolean') throw new Error(`Invalid Disney shader specialization for ${field}.`);
  return value ? 'true' : 'false';
}

function replaceFunctionOptions(
  source: string, functionName: string, options: DisneyShaderSpecialization,
  fields: readonly (keyof DisneyShaderSpecialization)[],
): string {
  const marker = `fn ${functionName}(`;
  const start = source.indexOf(marker);
  const open = start < 0 ? -1 : source.indexOf('{', start);
  if (start < 0 || open < 0) throw new Error(`Cannot specialize missing Disney WGSL function ${functionName}.`);

  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end < 0) throw new Error(`Cannot parse Disney WGSL function ${functionName}.`);

  let body = source.slice(start, end);
  for (const field of fields) {
    const expression = new RegExp(`options\\.${field}\\b`, 'g');
    const count = (body.match(expression) || []).length;
    if (count === 0) throw new Error(`Cannot specialize unused Disney WGSL option ${functionName}.${field}.`);
    body = body.replace(expression, optionLiteral(field, options[field]));
  }
  return source.slice(0, start) + body + source.slice(end);
}

export function specializeDisneyShader(source: string, options: DisneyShaderSpecialization): string {
  let result = source;
  for (const [functionName, fields] of Object.entries(SPECIALIZED_FIELDS)) {
    result = replaceFunctionOptions(result, functionName, options, fields);
  }
  return result;
}
