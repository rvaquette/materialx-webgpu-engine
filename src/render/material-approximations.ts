// Per-material approximations of the MaterialX raster and path-tracing backends,
// shown next to the material graph like the Disney conversion report. Lowering
// warnings are recomputed from the material's resolved graph (no pipeline is
// compiled) and are shared by both backends, which consume the same layered
// closure; raster-only approximations follow from the closure features and the
// raster pass the object is drawn in.

import type { Diagnostic } from '../core/diagnostics.ts';
import { SURFACE_IR_UPSTREAM } from '../compiler/surface-ir.ts';
import { emitLayeredSurface } from '../compiler/surface-wgsl.ts';
import { isSpatialVolumeIr } from '../compiler/volume-ir.ts';
import { resolveSurface } from '../materialx/surface-graph.ts';
import type { ScenePassKind } from './raster/backend.ts';
import type { MaterialResource } from './scene-resources.ts';
import { VOLUME_GRID_SIZE } from './volume-field.ts';

const MX_LOBE_SUBSURFACE = 7;
const MX_LOBE_DIELECTRIC_TRANSMISSION = 8;

/** Warnings and errors emitted while lowering the material graph to WGSL. */
export function materialLoweringWarnings(material: MaterialResource): string[] {
  const graph = material.surfaceGraph;
  if (!graph) return [];
  const messages = new Set<string>();
  const sink = (diagnostic: Diagnostic): void => { if (diagnostic.level !== 'info') messages.add(diagnostic.message); };
  try {
    const surface = resolveSurface(graph, { onDiagnostic: sink, supportedUpstream: SURFACE_IR_UPSTREAM });
    if (surface) emitLayeredSurface(graph, surface, sink);
  } catch (error) {
    messages.add(`Compilation impossible : ${error instanceof Error ? error.message : String(error)}`);
  }
  return [...messages];
}

/**
 * Approximations of a material in the MaterialX `raster` or `pathtracing` backend.
 * `rasterPass` is the raster pass the object is drawn in (ignored for path tracing).
 */
export function materialBackendApproximations(
  material: MaterialResource, backend: 'raster' | 'pathtracing', rasterPass?: ScenePassKind,
): string[] {
  const messages = materialLoweringWarnings(material);
  if (material.displacement) {
    messages.push('Le déplacement est appliqué aux sommets du maillage, sans subdivision : son détail est limité par la densité du maillage.');
  }
  if (material.volumeIr && isSpatialVolumeIr(material.volumeIr)) {
    messages.push(`Le volume hétérogène est échantillonné sur une grille ${VOLUME_GRID_SIZE}³ englobant l’objet.`);
  }
  if (backend === 'pathtracing') return messages;

  const lobes = material.surfaceModule?.features?.lobeKinds;
  if (rasterPass === 'transmission') {
    messages.push('Surface transparente : mélange alpha sans tri ni écriture de profondeur ; les recouvrements entre surfaces transparentes peuvent être faux.');
  }
  if (lobes?.includes(MX_LOBE_DIELECTRIC_TRANSMISSION)) {
    messages.push('Transmission : la réfraction ne montre que l’environnement, pas les objets situés derrière la surface.');
  }
  if (lobes?.includes(MX_LOBE_SUBSURFACE)) {
    messages.push('Subsurface réduit à sa réponse diffuse : la lumière ne se propage pas sous la surface (rayon, échelle et anisotropie sans effet).');
  }
  if (material.volumeIr) {
    messages.push('Volume : diffusion simple uniquement, sans diffusion multiple dans le milieu.');
  }
  // surface-wgsl.ts only sets hasEmission when an emission term is authored with a weight.
  if (material.surfaceModule?.code.includes('.hasEmission = 1u;')) {
    messages.push('L’émission est visible mais n’éclaire pas les autres objets.');
  }
  return messages;
}
