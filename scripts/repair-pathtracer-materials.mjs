import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultLibraryRoot, simplifyMaterialXml, surfaceDefaults } from './simplify-pathtracer-materials.mjs';

const ROOT = fileURLToPath(new URL('../scenes/pathtracer/', import.meta.url));
const id = name => name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const format = value => {
  if (!Number.isFinite(value)) throw new Error(`Invalid material number: ${value}`);
  return String(Number(value.toPrecision(12)));
};

export function materialBlocks(text) {
  const clean = text.replace(/#.*|\/\/[^\n]*/g, '');
  return [...clean.matchAll(/^\s*material\s+(\S+)\s*\{([^{}]*)\}/gm)].map(([, name, body]) => {
    const ignored = [];
    const values = Object.fromEntries(body.split(/\r?\n/).map(line => line.trim()).filter(Boolean).flatMap(line => {
      const match = /^(\S+)\s+(.+)$/.exec(line);
      if (!match) {
        ignored.push(line);
        return [];
      }
      return [[match[1], match[2]]];
    }));
    return { name: id(name), values, ignored };
  });
}

export function standardMaterial(name, v, { flipNormalY = true } = {}) {
  const scalar = (key, fallback) => {
    const result = Number(v[key] ?? fallback);
    if (!Number.isFinite(result)) throw new Error(`${name}: invalid ${key}`);
    return result;
  };
  const rgb = (key, fallback) => {
    const result = v[key] === undefined ? fallback : v[key].split(/\s+/).map(Number);
    if (result.length !== 3 || !result.every(Number.isFinite)) throw new Error(`${name}: invalid ${key}`);
    return result;
  };
  if (v.mediumtype && !['none', 'absorb'].includes(v.mediumtype)) {
    throw new Error(`${name}: ${v.mediumtype} participating medium is not supported by the surface compiler`);
  }
  const nodes = [], inputs = [];
  const literal = (key, type, value) => `<input name="${key}" type="${type}" value="${escape(Array.isArray(value) ? value.map(format).join(', ') : typeof value === 'number' ? format(value) : value)}" />`;
  const link = (key, type, node, output) => `<input name="${key}" type="${type}" nodename="${node}"${output ? ` output="${output}"` : ''} />`;
  const node = (category, suffix, type, args) => {
    const nodeName = `${name}_${suffix}`;
    nodes.push(`  <${category} name="${nodeName}" type="${type}">\n${args.map(arg => `    ${arg}`).join('\n')}\n  </${category}>`);
    return nodeName;
  };
  const image = (slot, type) => node('image', `${slot}_${type}`, type, [literal('file', 'filename', v[slot])]);
  const texture = slot => v[slot] && v[slot] !== 'none';
  const color = rgb('color', [1, 1, 1]);
  let baseColor;
  if (texture('albedotexture')) {
    const raw = image('albedotexture', 'color3');
    const linear = node('power', 'albedo_linear', 'color3', [link('in1', 'color3', raw), literal('in2', 'color3', [2.2, 2.2, 2.2])]);
    baseColor = node('multiply', 'albedo_factor', 'color3', [link('in1', 'color3', linear), literal('in2', 'color3', color)]);
  }
  const baseInput = key => baseColor ? link(key, 'color3', baseColor) : literal(key, 'color3', color);
  // The source stores GGX alpha, whereas MaterialX expects perceptual roughness.
  const roughness = Math.sqrt(Math.max(0.001, scalar('roughness', 0.5)));
  const thin = scalar('thinwalled', 0) > 0;
  const family = thin ? 'open_pbr_surface' : 'standard_surface';
  const key = (standard, open) => thin ? open : standard;
  inputs.push(literal(key('base', 'base_weight'), 'float', 1), baseInput('base_color'));
  let diffuseRoughness;
  if (texture('metallicroughnesstexture')) {
    const raw = image('metallicroughnesstexture', 'color3');
    const channels = node('separate3', 'metallic_roughness_channels', 'multioutput', [link('in', 'color3', raw)]);
    inputs.push(link(key('metalness', 'base_metalness'), 'float', channels, 'outz'));
    const perceptual = node('max', 'roughness_minimum', 'float', [link('in1', 'float', channels, 'outy'), literal('in2', 'float', Math.sqrt(0.001))]);
    inputs.push(link('specular_roughness', 'float', perceptual));
    diffuseRoughness = node('multiply', 'diffuse_roughness', 'float', [link('in1', 'float', perceptual), link('in2', 'float', perceptual)]);
  } else {
    inputs.push(literal(key('metalness', 'base_metalness'), 'float', scalar('metallic', 0)));
    inputs.push(literal('specular_roughness', 'float', roughness));
  }
  inputs.push(diffuseRoughness
    ? link(key('diffuse_roughness', 'base_diffuse_roughness'), 'float', diffuseRoughness)
    : literal(key('diffuse_roughness', 'base_diffuse_roughness'), 'float', Math.max(0.001, scalar('roughness', 0.5))));
  inputs.push(literal(key('specular', 'specular_weight'), 'float', scalar('specular', 1)));
  inputs.push(literal(key('specular_IOR', 'specular_ior'), 'float', scalar('ior', 1.5)));
  inputs.push(literal(key('specular_anisotropy', 'specular_roughness_anisotropy'), 'float', scalar('anisotropic', 0)));
  inputs.push(literal(key('transmission', 'transmission_weight'), 'float', scalar('spectrans', 0)));
  let transColor = rgb('transmissioncolor', color), depth = 0;
  if (v.mediumtype === 'absorb') {
    const density = scalar('mediumdensity', 0);
    if (density < 0) throw new Error(`${name}: negative medium density`);
    if (density > 0) {
      // exp(-sigmaA * distance), with sigmaA = (1 - source color) * density.
      transColor = rgb('mediumcolor', [1, 1, 1]).map(c => Math.exp(-(1 - c)));
      depth = 1 / density;
    }
  }
  inputs.push(literal('transmission_color', 'color3', transColor), literal('transmission_depth', 'float', depth));
  inputs.push(literal(key('subsurface', 'subsurface_weight'), 'float', scalar('subsurface', 0)), baseInput('subsurface_color'));
  inputs.push(literal(key('coat', 'coat_weight'), 'float', scalar('clearcoat', 0)));
  inputs.push(literal('coat_roughness', 'float', Math.sqrt(Math.max(0.001, 0.1 - 0.099 * scalar('clearcoatgloss', 0)))));
  inputs.push(literal(key('coat_IOR', 'coat_ior'), 'float', 1.5));
  if (thin) inputs.push(literal('geometry_thin_walled', 'boolean', 'true'));
  if (scalar('sheen', 0) > 0) {
    inputs.push(literal(key('sheen', 'fuzz_weight'), 'float', scalar('sheen', 0)));
    inputs.push(literal(key('sheen_roughness', 'fuzz_roughness'), 'float', 0.3));
  }
  for (const [source, target] of [['speculartint', 'specular_color'], ['sheentint', key('sheen_color', 'fuzz_color')]]) {
    if (scalar(source, 0) === 0) continue;
    const baseVector = node('convert', `${source}_base_vector`, 'vector3', [baseInput('in')]);
    const luminance = node('dotproduct', `${source}_luminance`, 'float', [link('in1', 'vector3', baseVector), literal('in2', 'vector3', [0.3, 0.6, 0.1])]);
    const lum = node('convert', `${source}_luminance_color`, 'color3', [link('in', 'float', luminance)]);
    const safe = node('max', `${source}_safe`, 'color3', [link('in1', 'color3', lum), literal('in2', 'color3', [1e-6, 1e-6, 1e-6])]);
    const tint = node('divide', `${source}_tint`, 'color3', [baseInput('in1'), link('in2', 'color3', safe)]);
    const mixed = node('mix', `${source}_mixed`, 'color3', [link('fg', 'color3', tint), literal('bg', 'color3', [1, 1, 1]), literal('mix', 'float', scalar(source, 0))]);
    inputs.push(link(target, 'color3', mixed));
  }
  if (texture('normaltexture')) {
    let normal = image('normaltexture', 'vector3');
    if (flipNormalY) {
      const flipped = node('multiply', 'normal_flip', 'vector3', [link('in1', 'vector3', normal), literal('in2', 'vector3', [1, -1, 1])]);
      normal = node('add', 'normal_encoded', 'vector3', [link('in1', 'vector3', flipped), literal('in2', 'vector3', [0, 1, 0])]);
    }
    const mapped = node('normalmap', 'normal_mapped', 'vector3', [link('in', 'vector3', normal)]);
    inputs.push(link(key('normal', 'geometry_normal'), 'vector3', mapped));
  }
  const emission = rgb('emission', [0, 0, 0]);
  inputs.push(literal(key('emission', 'emission_luminance'), 'float', 1), literal('emission_color', 'color3', emission));
  let opacity = scalar('opacity', 1);
  if (!v.alphamode || v.alphamode === 'opaque') opacity = 1;
  if (v.alphamode && !['opaque', 'blend', 'mask'].includes(v.alphamode)) throw new Error(`${name}: invalid alpha mode`);
  let alpha;
  if (v.alphamode !== 'opaque' && v.alphamode && texture('albedotexture')) {
    const raw = image('albedotexture', 'color4');
    const channels = node('separate4', 'alpha_channels', 'multioutput', [link('in', 'color4', raw)]);
    alpha = node('multiply', 'alpha_factor', 'float', [link('in1', 'float', channels, 'outw'), literal('in2', 'float', opacity)]);
  }
  if (v.alphamode === 'mask') {
    alpha = node('ifgreatereq', 'alpha_mask', 'float', [
      alpha ? link('value1', 'float', alpha) : literal('value1', 'float', opacity),
      literal('value2', 'float', scalar('alphacutoff', 0)), literal('in1', 'float', 1), literal('in2', 'float', 0),
    ]);
  }
  if (alpha) {
    if (!thin) alpha = node('convert', 'opacity_color', 'color3', [link('in', 'float', alpha)]);
    inputs.push(link(key('opacity', 'geometry_opacity'), thin ? 'float' : 'color3', alpha));
  } else inputs.push(literal(key('opacity', 'geometry_opacity'), thin ? 'float' : 'color3', thin ? opacity : [opacity, opacity, opacity]));
  return `  <${family} name="${name}_surface" type="surfaceshader">\n${inputs.map(input => `    ${input}`).join('\n')}\n  </${family}>\n${nodes.join('\n')}${nodes.length ? '\n' : ''}  <surfacematerial name="${name}" type="material">\n    ${link('surfaceshader', 'surfaceshader', `${name}_surface`)}\n  </surfacematerial>`;
}

export function repairMaterials(sourceRoot, outputRoot = ROOT, apply = false) {
  const defaults = surfaceDefaults(defaultLibraryRoot);
  const reports = [];
  for (const scene of readdirSync(outputRoot).filter(name => name.endsWith('.usda')).sort()) {
    const source = readFileSync(join(sourceRoot, scene.replace('.usda', '.scene')), 'utf8');
    const materials = materialBlocks(source);
    const seen = new Set();
    const warnings = [], pieces = [];
    const xmlPath = join(outputRoot, scene.replace('.usda', '.mtlx'));
    const oldXml = readFileSync(xmlPath, 'utf8');
    let stage = readFileSync(join(outputRoot, scene), 'utf8');
    const flipNormalY = !/^\s*openglnormalmap\s+false\b/m.test(source.replace(/#.*|\/\/[^\n]*/g, ''));
    for (const { name, values, ignored } of materials) {
      for (const line of ignored) warnings.push(`${name}: malformed source line "${line}" is ignored by the source loader`);
      if (seen.has(name)) throw new Error(`${scene}: duplicate material ${name}`);
      seen.add(name);
      for (const [slot, path] of Object.entries(values).filter(([key]) => key.endsWith('texture'))) {
        if (path !== 'none' && !existsSync(join(outputRoot, path))) throw new Error(`${scene}/${name}: missing ${slot} ${path}`);
      }
      if (values.materialx_document) {
        const relative = values.materialx_document.replace('../materialx/materials/', '../mtlx-library/');
        const original = readFileSync(join(outputRoot, relative), 'utf8');
        const materialNames = [...original.matchAll(/<surfacematerial\s+name="([^"]+)"/g)].map(match => match[1]);
        if (materialNames.length !== 1) throw new Error(`${scene}/${name}: ambiguous original MaterialX material`);
        const reference = new RegExp(`(@[^@]+@</MaterialX/Materials/)${name}>`);
        const restored = `@${relative}@</MaterialX/Materials/${materialNames[0]}>`;
        if (reference.test(stage)) stage = stage.replace(reference, restored);
        else if (!stage.includes(restored)) throw new Error(`${scene}/${name}: missing USDA binding`);
        continue;
      }
      const unsupported = Object.keys(values).filter(key => ![
        'color', 'roughness', 'metallic', 'specular', 'ior', 'anisotropic', 'subsurface', 'speculartint',
        'sheen', 'sheentint', 'clearcoat', 'clearcoatgloss', 'spectrans', 'transmissioncolor', 'thinwalled',
        'thickness', 'doublesided', 'albedotexture', 'metallicroughnesstexture', 'normaltexture',
        'emission', 'opacity', 'alphamode', 'alphacutoff', 'mediumtype', 'mediumcolor', 'mediumdensity',
        'materialType',
      ].includes(key));
      if (unsupported.length) throw new Error(`${scene}/${name}: unhandled fields ${unsupported.join(', ')}`);
      if (values.mediumtype && !['none', 'absorb'].includes(values.mediumtype)) {
        const message = `${name}: ${values.mediumtype} volume remains uncorrected; surface-only conversion cannot preserve it`;
        warnings.push(message);
        const surface = new RegExp(`  <disney_principled name="${name}_surface"[\\s\\S]*?</disney_principled>`).exec(oldXml)?.[0];
        const material = new RegExp(`  <surfacematerial name="${name}"[\\s\\S]*?</surfacematerial>`).exec(oldXml)?.[0];
        if (!surface || !material) throw new Error(`${scene}/${name}: cannot preserve unsupported material`);
        pieces.push(`  <!-- ${escape(message)} -->\n${surface}\n${material}`);
      } else pieces.push(standardMaterial(name, values, { flipNormalY }));
    }
    if (!materials.length) {
      warnings.push('No named source materials: embedded glTF material bindings remain uncorrected');
    }
    const extraMaterials = [...oldXml.matchAll(/<surfacematerial name="([^"]+)"/g)].map(match => match[1]).filter(name => !seen.has(name));
    if (materials.length && extraMaterials.length) throw new Error(`${scene}: unhandled implicit materials ${extraMaterials.join(', ')}`);
    const xml = simplifyMaterialXml(`<?xml version="1.0"?>\n<materialx version="1.39" colorspace="lin_rec709">\n${pieces.join('\n')}\n</materialx>\n`, defaults).text;
    const changed = pieces.length > 0 && xml !== oldXml;
    const stageChanged = stage !== readFileSync(join(outputRoot, scene), 'utf8');
    if (apply && changed) writeFileSync(xmlPath, xml);
    if (apply && stageChanged) writeFileSync(join(outputRoot, scene), stage);
    reports.push({ scene, materials: materials.length, changed, stageChanged, warnings });
  }
  return reports;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourceRoot = process.argv[2];
  if (!sourceRoot || process.argv.slice(3).some(arg => arg !== '--apply')) {
    throw new Error(`Usage: node ${basename(process.argv[1])} <source-scene-directory> [--apply]`);
  }
  const reports = repairMaterials(resolve(sourceRoot), ROOT, process.argv.includes('--apply'));
  for (const report of reports) {
    console.log(`${report.scene}: ${report.materials} materials${report.changed || report.stageChanged ? ' (changed)' : ''}`);
    for (const warning of report.warnings) console.warn(`${report.scene}: ${warning}`);
  }
  console.log(`Audited ${reports.length} scenes, ${reports.reduce((sum, report) => sum + report.materials, 0)} materials.`);
}
