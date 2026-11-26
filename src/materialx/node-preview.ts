import { fromResolvedGraph, nodeType, toScriptProgram, type ScriptNodeDef, type ScriptLibrary, type ScriptNode } from './script-api.ts';
import type { ResolvedGraph } from './graph.ts';

function constructor(def: ScriptNodeDef, library: ScriptLibrary): string {
  const variant = library.variantArgument(def);
  return `new ${def.className}(${variant === undefined ? '' : JSON.stringify(variant)})`;
}

/** Rebuild the selected node's ancestors and connect its output to a preview surface. */
export function nodePreviewScript(
  resolved: ResolvedGraph, nodeId: string, outputName: string, library: ScriptLibrary,
): string {
  const entries = [...resolved.nodes];
  const index = entries.findIndex(([id]) => id === nodeId);
  if (index < 0) throw new Error(`Unknown MaterialX node "${nodeId}".`);
  const graph = fromResolvedGraph(resolved, library);
  const sourceNodes = graph.nodes.slice(0, entries.length);
  const selected = sourceNodes[index];
  if (!selected) throw new Error(`Cannot resolve MaterialX node "${nodeId}" for preview.`);
  const output = selected.def.outputs.find(candidate => candidate.name === outputName);
  if (!output) throw new Error(`Unknown output "${outputName}" on "${nodeId}".`);

  const ancestors = new Set<ScriptNode>();
  const visit = (node: ScriptNode): void => {
    if (ancestors.has(node)) return;
    ancestors.add(node);
    for (const input of node.inputs.values()) if ('node' in input) visit(input.node);
  };
  visit(selected);
  const generated = toScriptProgram({ nodes: sourceNodes.filter(node => ancestors.has(node)) }, library);
  const selectedName = generated.names.get(selected);
  if (!selectedName) throw new Error(`Cannot generate MaterialX preview for "${nodeId}".`);
  const lines = [generated.code.trimEnd()];
  const used = new Set(generated.names.values());
  const variable = (base: string): string => {
    let name = base;
    for (let suffix = 2; used.has(name); suffix++) name = `${base}${suffix}`;
    used.add(name);
    return name;
  };
  const shaderName = variable('mxPreviewShader');
  const materialName = variable('mxPreviewMaterial');
  const sphereName = variable('mxPreviewSphere');
  const value = `${selectedName}.${outputName}`;

  if (output.type === 'material') {
    lines.push(`${sphereName} = new Sphere();`, `${sphereName}.material = ${value};`);
    return `${lines.join('\n')}\n`;
  }

  let surfaceExpression: string;
  if (output.type === 'surfaceshader') {
    surfaceExpression = value;
  } else if (output.type === 'displacementshader') {
    const surface = library.resolve('standard_surface');
    lines.push(`${shaderName} = ${constructor(surface, library)};`);
    surfaceExpression = `${shaderName}.out`;
  } else if (output.type.toLowerCase() === 'bsdf') {
    const surface = library.resolve('surface');
    const input = surface.inputs.find(candidate => candidate.type === output.type);
    if (!input) throw new Error(`MaterialX cannot preview ${output.type} outputs.`);
    lines.push(`${shaderName} = ${constructor(surface, library)};`, `${shaderName}.${input.name} = ${value};`);
    surfaceExpression = `${shaderName}.out`;
  } else {
    const surface = library.resolve('standard_surface');
    const targetInput = output.type === 'color3' ? 'base_color'
      : output.type === 'float' ? 'base'
        : output.type === 'vector3' ? 'normal'
          : undefined;
    if (targetInput && surface.inputs.some(input => input.name === targetInput && input.type === output.type)) {
      lines.push(`${shaderName} = ${constructor(surface, library)};`, `${shaderName}.${targetInput} = ${value};`);
    } else if (output.type === 'color4' || output.type === 'vector4') {
      const targetType = output.type === 'color4' ? 'color3' : 'vector3';
      const target = targetType === 'color3' ? 'base_color' : 'normal';
      const convert = library.variants('convert').find(candidate =>
        nodeType(candidate) === targetType && candidate.inputs[0]?.type === output.type);
      if (!convert) throw new Error(`MaterialX has no ${output.type} to ${targetType} conversion for a preview.`);
      const convertName = variable('mxPreviewConvert');
      lines.push(
        `${convertName} = ${constructor(convert, library)};`,
        `${convertName}.${convert.inputs[0]!.name} = ${value};`,
        `${shaderName} = ${constructor(surface, library)};`,
        `${shaderName}.${target} = ${convertName}.${convert.outputs[0]!.name};`,
      );
    } else {
      throw new Error(`MaterialX cannot preview ${output.type} outputs as a surface.`);
    }
    surfaceExpression = `${shaderName}.out`;
  }

  const material = library.resolve('surfacematerial');
  lines.push(`${materialName} = ${constructor(material, library)};`);
  if (output.type === 'displacementshader') {
    lines.push(
      `${materialName}.surfaceshader = ${surfaceExpression};`,
      `${materialName}.displacementshader = ${value};`,
    );
  } else {
    lines.push(`${materialName}.surfaceshader = ${surfaceExpression};`);
  }
  lines.push(`${sphereName} = new Sphere();`, `${sphereName}.material = ${materialName};`);
  return `${lines.join('\n')}\n`;
}
