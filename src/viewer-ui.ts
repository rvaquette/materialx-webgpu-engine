import { ImGui, ImGuiImplWeb, ImVec2, ImVec4, ImGuiCol, ImGuiWindowFlags, ImGuiComboFlags, ImGuiConfigFlags, ImGuiMouseSource } from '@mori2003/jsimgui';
import type { ViewerStatus, BackendKind } from './render/viewer.ts';
import type { RasterQuality } from './render/raster/ir-forward.ts';
import type { MaterialParameterEditor } from './material-parameter-editor.ts';
import type { MaterialFolder } from './scene/material-tree.ts';
import { PATH_TRACE_VIEWS, parseCustomAov, type PathTraceView } from './render/pathtracing/display.ts';
import type { LightingPreset } from './render/lighting-presets.ts';
import type { TurntableTarget } from './render/turntable.ts';

export interface ViewerUiState {
  entry: string;
  scenes: Array<{ label: string; entry: string }>;
  resolution: number | '1024x768';
  pathTracingDepth: number;
  rasterQuality: RasterQuality;
  backend: BackendKind;
  environmentEnabled: boolean;
  denoise: boolean;
  exposure: number;
  tonemap: 'none' | 'reinhard' | 'acesFilmic';
  status: ViewerStatus | undefined;
  busy: boolean;
  busyMessage: string;
  error: string;
  shaderErrors: string;
  warnings: string;
  objectPath: string;
  objects: ReadonlyArray<{ path: string; material: string; assetPath?: string }>;
  materialFolderPath: string[];
  materialTree: MaterialFolder;
  materialPath: string;
  history?: { undo?: string; redo?: string; notice?: string; busy: boolean };
  turntable?: { lights: ReadonlyArray<{ path: string; type: string }>; running: boolean; message: string };
  /** Present when the scene has a time range or variant sets. */
  animation?: ViewerUiAnimation | undefined;
}

export interface ViewerUiAnimation {
  timeline?: { start: number; end: number; timeCodesPerSecond: number };
  time: number;
  playing: boolean;
  temporalHistory: number;
  variantSets: ReadonlyArray<{ path: string; set: string; variants: readonly string[]; selection?: string }>;
}

export interface ViewerUiActions {
  undo?: () => void;
  redo?: () => void;
  scene: (entry: string) => void;
  resolution: (size: number | '1024x768') => void;
  pathTracingDepth: (depth: number) => void;
  quality: (quality: RasterQuality) => void;
  backend: (backend: BackendKind) => void;
  environment: (enabled: boolean) => void;
  lightingPreset?: (preset: LightingPreset | 'scene') => void;
  turntable?: (options: { target: TurntableTarget; path: string; angle: number; frames: number; samples: number }) => void;
  cancelTurntable?: () => void;
  denoise: (enabled: boolean) => void;
  compareDenoiser: (enabled: boolean) => void;
  adaptive: (enabled: boolean) => void;
  pathTracingView: (view: PathTraceView) => void;
  exportAov: () => void;
  exportAovHdr: () => void;
  limits: (limits: ViewerStatus['pathTracingLimits']) => void;
  restartPathTracing: () => void;
  exposure: (value: number) => void;
  tonemap: (value: 'none' | 'reinhard' | 'acesFilmic') => void;
  pause: () => void;
  openFiles: (folder: boolean) => void;
  object: (path: string) => void;
  material: (path: string) => void;
  time?: (time: number) => void;
  play?: (playing: boolean) => void;
  temporalHistory?: (samples: number) => void;
  variant?: (path: string, set: string, variant: string) => void;
}

function combo(label: string, value: string, options: readonly { label: string; value: string }[], change: (value: string) => void, largePopup = false): void {
  const displayLabel = (text: string): string => largePopup ? text
    .replace(/^Lama - (?:Lama)?/, 'Lama ')
    .replace(/^Lama(?:Generalized)?(?=[A-Z])/, '')
    .replace(/^OpenPBR Shader Playground/, 'OpenPBR')
    .replace(/^Pathtracer - /, 'PT - ')
    .replace(/ \(engine equivalent\)/g, ' (approx.)')
    .replace(/ - NOT SUPPORTED$/, ' [N/S]') : text;
  const selected = options.find(option => option.value === value);
  ImGui.SetNextItemWidth(-1);
  ImGui.PushStyleColorImVec4(ImGuiCol.ScrollbarBg, new ImVec4(0.06, 0.06, 0.06, 0.95));
  ImGui.PushStyleColorImVec4(ImGuiCol.ScrollbarGrab, new ImVec4(0.48, 0.48, 0.48, 1));
  ImGui.PushStyleColorImVec4(ImGuiCol.ScrollbarGrabHovered, new ImVec4(0.64, 0.64, 0.64, 1));
  ImGui.PushStyleColorImVec4(ImGuiCol.ScrollbarGrabActive, new ImVec4(0.78, 0.78, 0.78, 1));
  if (largePopup) {
    const width = ImGui.GetContentRegionAvail().x;
    const height = ImGui.GetTextLineHeightWithSpacing() * 20 + ImGui.GetStyle().WindowPadding.y * 2;
    ImGui.SetNextWindowSizeConstraints(new ImVec2(width, 0), new ImVec2(width, height));
  }
  if (ImGui.BeginCombo(label, displayLabel(selected?.label ?? value), largePopup ? ImGuiComboFlags.HeightLarge : ImGuiComboFlags.None)) {
    for (const option of options) {
      if (ImGui.Selectable(`${displayLabel(option.label)}##${option.value}`, option.value === value, 0, new ImVec2(0, 0))) change(option.value);
      if (largePopup) ImGui.SetItemTooltip(option.label);
      if (option.value === value) ImGui.SetItemDefaultFocus();
    }
    ImGui.EndCombo();
  }
  ImGui.PopStyleColor(4);
}

function attachPointerInput(canvas: HTMLCanvasElement, enableTouch: () => void): () => void {
  const io = ImGui.GetIO();
  const pointer = (event: PointerEvent): void => {
    // jsimgui already handles touchstart/move/end (including the virtual keyboard).
    // Do not also enqueue the same gesture through its pointer listeners.
    if (event.pointerType === 'touch') {
      event.stopImmediatePropagation();
      return;
    }
    io.AddMouseSourceEvent(event.pointerType === 'pen' ? ImGuiMouseSource._Pen : ImGuiMouseSource._Mouse);
    const rect = canvas.getBoundingClientRect();
    io.AddMousePosEvent(event.clientX - rect.left, event.clientY - rect.top);
  };
  const touch = (): void => {
    enableTouch();
    io.AddMouseSourceEvent(ImGuiMouseSource._TouchScreen);
  };
  const capture = { capture: true };
  canvas.addEventListener('pointerdown', pointer, capture);
  canvas.addEventListener('pointermove', pointer, capture);
  canvas.addEventListener('pointerup', pointer, capture);
  canvas.addEventListener('touchstart', touch, capture);
  return () => {
    canvas.removeEventListener('pointerdown', pointer, capture);
    canvas.removeEventListener('pointermove', pointer, capture);
    canvas.removeEventListener('pointerup', pointer, capture);
    canvas.removeEventListener('touchstart', touch, capture);
  };
}

/** Rendering/input backend is isolated here; controls and callbacks use plain engine state. */
export async function startViewerUi(
  canvas: HTMLCanvasElement, state: ViewerUiState, actions: ViewerUiActions, parameters: MaterialParameterEditor,
): Promise<() => void> {
  await ImGuiImplWeb.Init({ canvas, backend: 'webgl2' });
  ImGui.StyleColorsDark();
  ImGui.GetIO().ConfigFlags |= ImGuiConfigFlags.NavEnableKeyboard;
  const style = ImGui.GetStyle();
  style.ScrollbarSize = 20;
  style.GrabMinSize = 24;
  let touchControls = false;
  const enableTouch = (): void => {
    if (touchControls) return;
    touchControls = true;
    style.ScrollbarSize = 28;
    style.GrabMinSize = 28;
  };
  if (globalThis.matchMedia?.('(pointer: coarse)').matches) enableTouch();
  const detachInput = attachPointerInput(canvas, enableTouch);
  let stopped = false;
  let frame = 0;
  let turntableTarget: TurntableTarget = 'object';
  let turntablePath = '';
  let turntableAngle = 0;
  let turntableFrames = 12;
  let turntableSamples = 16;
  const render = (): void => {
    if (stopped) return;
    try {
      const dpr = devicePixelRatio || 1;
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ImGuiImplWeb.BeginRender();
      ImGui.SetNextWindowPos(new ImVec2(0, 0));
      ImGui.SetNextWindowSize(new ImVec2(canvas.clientWidth, canvas.clientHeight));
      if (ImGui.Begin('MaterialX', undefined, ImGuiWindowFlags.NoMove | ImGuiWindowFlags.NoResize | ImGuiWindowFlags.NoCollapse | ImGuiWindowFlags.NoSavedSettings)) {
        ImGui.BeginDisabled(state.busy);
        if (state.history) {
          ImGui.BeginDisabled(state.history.busy || !state.history.undo);
          if (ImGui.Button('Annuler')) actions.undo?.();
          ImGui.SetItemTooltip(state.history.undo ?? 'Aucune opération à annuler');
          ImGui.EndDisabled();
          ImGui.SameLine();
          ImGui.BeginDisabled(state.history.busy || !state.history.redo);
          if (ImGui.Button('Rétablir')) actions.redo?.();
          ImGui.SetItemTooltip(state.history.redo ?? 'Aucune opération à rétablir');
          ImGui.EndDisabled();
          ImGui.TextWrapped(state.history.notice ?? 'Historique limité : voir Scripts de matériaux > Annuler / rétablir.');
        }
        ImGui.SeparatorText('Scene');
        combo('##scene', state.entry, state.scenes.map(scene => ({ label: scene.label, value: scene.entry })), actions.scene, true);
        ImGui.SeparatorText('Rendu');
        combo('##resolution', String(state.resolution), [
          ...[128, 256, 512, 1024].map(size => ({ label: `${size} x ${size}`, value: String(size) })),
          { label: '1024 x 768', value: '1024x768' },
        ], value => actions.resolution(value === '1024x768' ? value : Number(value)));
        ImGui.Text('Profondeur du path tracing');
        const depthOptions = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64].map(depth => ({
          label: `${depth} rebonds`, value: String(depth),
        }));
        if (!depthOptions.some(option => Number(option.value) === state.pathTracingDepth)) {
          const label = state.pathTracingDepth === 0
            ? '0 rebond (scène, fond seulement)'
            : `${state.pathTracingDepth} rebonds (scène)`;
          depthOptions.unshift({ label, value: String(state.pathTracingDepth) });
        }
        combo('##path-tracing-depth', String(state.pathTracingDepth), depthOptions,
          value => actions.pathTracingDepth(Number(value)));
        combo('##quality', state.rasterQuality, [
          { label: 'Interactive (filtered IBL)', value: 'interactive' },
          { label: 'Reference (64 samples)', value: 'reference' },
        ], value => { if (value === 'interactive' || value === 'reference') actions.quality(value); });
        if (ImGui.RadioButton('Raster', state.backend === 'raster')) actions.backend('raster');
        ImGui.SameLine();
        if (ImGui.RadioButton('Path tracing', state.backend === 'pathtracing')) actions.backend('pathtracing');
        ImGui.SameLine();
        if (ImGui.RadioButton('Disney', state.backend === 'disney')) actions.backend('disney');
        const environment: [boolean] = [state.environmentEnabled];
        if (ImGui.Checkbox('Envmap', environment)) actions.environment(environment[0]);
        ImGui.SameLine();
        const denoise: [boolean] = [state.denoise];
        ImGui.BeginDisabled(state.backend === 'disney');
        if (ImGui.Checkbox('Denoiser JS (neural)', denoise)) actions.denoise(denoise[0]);
        ImGui.EndDisabled();
        if (actions.lightingPreset) {
          ImGui.Text('Éclairage');
          combo('##lighting-preset', '', [
            { label: 'Choisir un éclairage…', value: '' },
            { label: 'Environnement de la scène', value: 'scene' },
            { label: 'Studio procédural HDR', value: 'studio' },
            { label: 'Extérieur procédural HDR', value: 'exterior' },
            { label: 'Dégradé procédural HDR', value: 'gradient' },
          ], value => {
            if (value === 'scene' || value === 'studio' || value === 'exterior' || value === 'gradient') actions.lightingPreset?.(value);
          });
        }
        if (state.backend === 'pathtracing' && state.status?.pathTracer === 'ready') {
          const comparing = state.status.denoiserComparison === true;
          const canCompare = comparing || (state.status.pathTracingPaused && state.status.pathTracingDenoise
            && state.status.pathTracingView === 'beauty' && state.status.samples > 0);
          ImGui.BeginDisabled(!canCompare);
          if (ImGui.Button(comparing ? 'Terminer la comparaison' : 'Comparer brut / débruité')) {
            actions.compareDenoiser(!comparing);
          }
          ImGui.SetItemTooltip(comparing
            ? 'Affiche le rendu débruité seul. Reprendre le rendu quitte aussi la comparaison.'
            : 'Activez le débruiteur, mettez le rendu en pause, puis comparez la même accumulation.');
          ImGui.EndDisabled();
          if (comparing && state.status.denoiser.state !== 'ready') {
            ImGui.Text('Préparation de la comparaison...');
          }
        }
        ImGui.Text('Affichage');
        ImGui.SetNextItemWidth(-1);
        const exposureValue: [number] = [state.exposure];
        if (ImGui.SliderFloat('##exposure', exposureValue, -5, 5, `Exposition: ${exposureValue[0].toFixed(2)} EV`)) {
          actions.exposure(exposureValue[0]);
        }
        combo('##tonemap', state.tonemap, [
          { label: 'Aucun (linéaire)', value: 'none' },
          { label: 'Reinhard', value: 'reinhard' },
          { label: 'ACES Filmic (défaut)', value: 'acesFilmic' },
        ], value => {
          if (value === 'none' || value === 'reinhard' || value === 'acesFilmic') {
            actions.tonemap(value);
          }
        });
        ImGui.BeginDisabled(state.backend !== 'pathtracing' && state.backend !== 'disney');
        if (ImGui.Button(state.status?.pathTracingPaused ? 'Reprendre' : 'Pause')) actions.pause();
        ImGui.EndDisabled();
        if ((state.backend === 'pathtracing' || state.backend === 'disney') && state.status?.pathTracer === 'ready') {
          ImGui.SameLine();
          const unit = state.backend === 'pathtracing' && state.status.pathTracingAdaptive ? 'balayages' : 'spp';
          ImGui.Text(`${state.status.samples} ${unit}${state.status.pathTracingPaused ? ' (pause)' : ''}`);
        }
        if (state.backend === 'pathtracing' && state.status?.pathTracer === 'ready') {
          const customAov = parseCustomAov(state.status.pathTracingView);
          const views: readonly { value: PathTraceView; label: string }[] = customAov
            ? [...PATH_TRACE_VIEWS, { value: state.status.pathTracingView, label: `AOV : ${customAov.name}` }] : PATH_TRACE_VIEWS;
          combo('##path-tracing-view', state.status.pathTracingView, views, value => {
            const option = views.find(option => option.value === value);
            if (option) actions.pathTracingView(option.value);
          });
          ImGui.SetItemTooltip('Un seul AOV est stocké (+16 octets/pixel). Le choisir réinitialise l’accumulation ; si elle était en pause, reprenez-la. Beauté et variance n’ajoutent pas de sidecar.');
          if (state.status.pathTracingView !== 'beauty' && state.status.samples > 0) {
            if (ImGui.Button('Exporter AOV affiché (PNG)')) actions.exportAov();
            const selectedView = views.find(option => option.value === state.status?.pathTracingView);
            ImGui.SetItemTooltip(`Exporte ${selectedView?.label ?? 'l’AOV sélectionné'} tel qu’affiché, en PNG 8 bits.`);
            ImGui.SameLine();
            if (ImGui.Button('Exporter HDR (PFM)')) actions.exportAovHdr();
            ImGui.SetItemTooltip(`Exporte ${selectedView?.label ?? 'l’AOV sélectionné'} en valeurs flottantes brutes.`);
          }
          if (state.status.pathTracingView === 'albedo') {
            ImGui.Text('Albedo diffus : les surfaces purement speculaires sont noires.');
          } else if (state.status.pathTracingView === 'depth') {
            ImGui.Text('Distance depuis l\'origine du rayon : gris = 1 / (1 + distance).');
          } else if (state.status.pathTracingView === 'variance') {
            ImGui.Text('Variance HDR : gris = V / (1 + V), magenta = moins de 2 samples.');
          } else if (state.status.pathTracingView === 'emission') {
            ImGui.Text('Émission de la surface primaire uniquement ; dynamique HDR compressée.');
          } else if (state.status.pathTracingView === 'transmission') {
            ImGui.Text('Somme des teintes pondérées des lobes transmissifs ; sans Fresnel ni éclairage traversant.');
          }
          const limits = state.status.pathTracingLimits;
          const targetValuePercent = limits.targetRelativeError * 100;
          const targetPercent = `${targetValuePercent.toFixed(1)}%`;
          const adaptive: [boolean] = [state.status.pathTracingAdaptive];
          if (ImGui.Checkbox('Echantillonnage adaptatif', adaptive)) actions.adaptive(adaptive[0]);
          ImGui.SetItemTooltip(`Cible ${targetPercent}, minimum 64 samples/pixel, sonde tous les 8 balayages. Relance le rendu.`);
          const stopOnConvergence: [boolean] = [limits.stopOnConvergence];
          if (ImGui.Checkbox('Arret automatique (convergence)', stopOnConvergence)) {
            actions.limits({ ...limits, stopOnConvergence: stopOnConvergence[0] });
          }
          ImGui.SetItemTooltip(`Tous les pixels sous ${targetPercent}, apres 64 balayages et 3 mesures consecutives. Estimation, pas une garantie.`);
          const budget: [number] = [limits.timeBudgetSeconds];
          if (ImGui.InputFloat('Budget actif (secondes)', budget, 1, 10, '%.1f')) {
            actions.limits({ ...limits, timeBudgetSeconds: budget[0] });
          }
          ImGui.SetItemTooltip('0 = illimite. Temps des lots pleine resolution termines, hors pause et compilation. Depassement possible d\'un lot GPU.');
          const target: [number] = [limits.targetRelativeError * 100];
          if (ImGui.InputFloat('Cible de bruit (%)', target, 0.5, 1, '%.1f')) {
            actions.limits({ ...limits, targetRelativeError: Math.min(25, Math.max(0.5, target[0])) / 100 });
          }
          ImGui.SetItemTooltip('Seuil relatif de confiance à 95%, entre 0,5% et 25%. S’applique à l’adaptatif et à l’arrêt automatique.');
          const progress = state.status.pathTracingProgress;
          if (progress) {
            ImGui.Text(`Temps de rendu actif : ${progress.elapsedSeconds.toFixed(1)} s`);
            const metrics = state.status.pathTracingMetrics;
            const rateUnit = state.status.pathTracingAdaptive ? 'balayages/s' : 'spp/s';
            ImGui.Text(metrics?.sweepsPerSecond === undefined ? 'Debit moyen : en attente'
              : `Debit moyen : ${metrics.sweepsPerSecond.toFixed(2)} ${rateUnit}`);
            ImGui.Text(metrics?.budgetRemainingSeconds === undefined ? 'Budget restant : illimite'
              : `Budget restant : ${metrics.budgetRemainingSeconds.toFixed(1)} s actives`);
            ImGui.Text(metrics?.convergenceRemainingSeconds === undefined
              ? `Cible ${targetPercent} : estimation indisponible (${state.status.pathTracingAdaptive ? 'mode adaptatif' : 'mesure mature requise'})`
              : `Cible ${targetPercent} : ~${metrics.convergenceRemainingSeconds.toFixed(1)} s actives restantes`);
            ImGui.SetItemTooltip('Extrapolation du pire pixel en 1/racine(N), apres 64 spp uniformes. Hors confirmation des 3 mesures ; ni garantie, ni temps mural.');
            if (metrics?.relativeNoise !== undefined && metrics.maximumRelativeNoise !== undefined) {
              ImGui.Text(`Bruit RMS (zones) : ${(metrics.relativeNoise * 100).toFixed(2)}% ; max : ${(metrics.maximumRelativeNoise * 100).toFixed(2)}%`);
            }
            if (metrics?.relativeVariance !== undefined) {
              ImGui.Text(`Variance normalisee : ${metrics.relativeVariance.toExponential(3)}`);
              ImGui.SetItemTooltip('Moyenne des variances de luminance / max(|luminance|, 0.01)^2. Mesure uniforme uniquement ; pas la variance HDR absolue.');
            }
            if (progress.stopReason) {
              ImGui.Text(progress.stopReason === 'convergence'
                ? 'Arret auto : convergence estimee' : 'Arret auto : budget de temps atteint');
              if (ImGui.Button('Relancer le rendu')) actions.restartPathTracing();
            }
          }
          const convergence = state.status.convergence;
          if (state.status.convergenceError) {
            ImGui.Text(`Convergence indisponible : ${state.status.convergenceError}`);
          } else if (convergence) {
            const convergedWeight = convergence.zones.reduce(
              (sum, zone) => sum + zone.convergedFraction * zone.validFraction, 0,
            );
            const validWeight = convergence.zones.reduce((sum, zone) => sum + zone.validFraction, 0);
            const convergedPercent = validWeight > 0 ? Math.round(100 * convergedWeight / validWeight) : 0;
            const unit = state.status.pathTracingAdaptive ? 'balayages' : 'spp';
            ImGui.Text(`Convergence par zone (${convergence.samples} ${unit}) : ${convergedPercent}% des pixels mesurables`);
            for (let row = 0; row < convergence.rows; row++) {
              const cells = convergence.zones.slice(
                row * convergence.columns, (row + 1) * convergence.columns,
              ).map(zone => {
                if (zone.validFraction === 0) return '?';
                if (zone.relativeError <= convergence.targetRelativeError * 0.25) return '.';
                if (zone.relativeError <= convergence.targetRelativeError * 0.5) return ':';
                if (zone.relativeError <= convergence.targetRelativeError) return '+';
                return '#';
              }).join('');
              ImGui.Text(cells);
            }
            ImGui.Text(`Légende : . < ${(targetValuePercent * 0.25).toFixed(2)}%, : < ${(targetValuePercent * 0.5).toFixed(2)}%, `
              + `+ < ${targetPercent}, # >= ${targetPercent}, ? échantillons insuffisants`);
          }
        }
        const animation = state.animation;
        if (animation && ImGui.CollapsingHeader('Animation')) {
          const timeline = animation.timeline;
          if (timeline) {
            if (ImGui.Button(animation.playing ? 'Arrêter' : 'Lire')) actions.play?.(!animation.playing);
            ImGui.SameLine();
            ImGui.Text(`${timeline.timeCodesPerSecond} images/s`);
            ImGui.SetNextItemWidth(-1);
            const time: [number] = [animation.time];
            if (ImGui.SliderFloat('##time', time, timeline.start, timeline.end, `Temps : %.1f / ${timeline.end}`)) actions.time?.(time[0]);
            combo('##temporal-history', String(animation.temporalHistory), [
              { label: 'Path tracing : redémarrer à chaque image', value: '0' },
              ...[4, 16, 64].map(samples => ({ label: `Path tracing : garder ${samples} spp d'historique`, value: String(samples) })),
            ], value => actions.temporalHistory?.(Number(value)));
            ImGui.SetItemTooltip('Accumulation temporelle : réutilise une partie des échantillons après un changement (traînées possibles).');
          }
          for (const variantSet of animation.variantSets) {
            ImGui.Text(`${variantSet.path.split('/').at(-1)} : ${variantSet.set}`);
            combo(`##variant-${variantSet.path}-${variantSet.set}`, variantSet.selection ?? '', [
              ...(variantSet.selection === undefined ? [{ label: 'Aucune variante', value: '' }] : []),
              ...variantSet.variants.map(variant => ({ label: variant, value: variant })),
            ], value => { if (value && value !== variantSet.selection) actions.variant?.(variantSet.path, variantSet.set, value); });
          }
        }
        if (state.turntable && actions.turntable && ImGui.CollapsingHeader('Turntable / capture')) {
          combo('##turntable-target', turntableTarget, [
            { label: 'Objet', value: 'object' }, { label: 'Lumière', value: 'light' },
          ], value => { turntableTarget = value as TurntableTarget; turntablePath = ''; });
          const targets = turntableTarget === 'object' ? state.objects : state.turntable.lights;
          if (!targets.some(item => item.path === turntablePath)) turntablePath = targets[0]?.path ?? '';
          combo('##turntable-path', turntablePath, targets.map(item => ({ label: item.path, value: item.path })),
            value => { turntablePath = value; });
          combo('##turntable-angle', String(turntableAngle), [0, 45, 90, 135, 180, 225, 270, 315]
            .map(value => ({ label: `Angle initial : ${value}°`, value: String(value) })), value => { turntableAngle = Number(value); });
          combo('##turntable-frames', String(turntableFrames), [8, 12, 24, 36]
            .map(value => ({ label: `Séquence : ${value} images`, value: String(value) })), value => { turntableFrames = Number(value); });
          combo('##turntable-samples', String(turntableSamples), [1, 4, 16, 64, 256]
            .map(value => ({ label: `${value} échantillons / image`, value: String(value) })), value => { turntableSamples = Number(value); });
          ImGui.TextWrapped('Capture path tracing ; rotation Y, scène restaurée après capture.');
          ImGui.BeginDisabled(!turntablePath || state.backend !== 'pathtracing');
          const start = (frames: number): void => actions.turntable?.({
            target: turntableTarget, path: turntablePath, angle: turntableAngle, frames, samples: turntableSamples,
          });
          if (ImGui.Button('Capturer une image')) start(1);
          if (ImGui.Button('Capturer la séquence (ZIP)')) start(turntableFrames);
          ImGui.EndDisabled();
        }
        if (ImGui.CollapsingHeader('Materiaux')) {
          ImGui.BeginDisabled(!state.objects.length);
          combo('##object', state.objectPath, state.objects.map(object => ({
            label: `${object.path.split('/').at(-1)} (${object.material})`, value: object.path,
          })), actions.object);
          let folder = state.materialTree;
          for (let depth = 0; folder.folders.size; depth++) {
            const index = depth;
            combo(`##folder-${depth}`, state.materialFolderPath[depth] ?? '', [
              { label: 'Choisir un dossier...', value: '' },
              ...[...folder.folders.keys()].sort().map(name => ({ label: name, value: name })),
            ], value => { state.materialFolderPath = [...state.materialFolderPath.slice(0, index), ...(value ? [value] : [])]; });
            const child = folder.folders.get(state.materialFolderPath[depth] ?? '');
            if (!child) break;
            folder = child;
          }
          combo('##material', state.materialPath, [
            { label: "Materiau d'origine", value: '' },
            ...folder.materials.map(material => ({ label: material.label, value: material.path })),
          ], actions.material);
          if (ImGui.CollapsingHeader('Parametres du materiau')) parameters.draw();
          if (ImGui.CollapsingHeader('Graphe du matériau')) parameters.drawGraph();
          ImGui.EndDisabled();
        }
        ImGui.EndDisabled();
        if (state.turntable?.message) ImGui.TextWrapped(state.turntable.message);
        if (state.turntable?.running && ImGui.Button('Annuler la capture')) actions.cancelTurntable?.();
      }
      ImGui.End();
      ImGuiImplWeb.EndRender();
      frame = requestAnimationFrame(render);
    } catch (error) {
      stopped = true;
      detachInput();
      console.error('ImGui rendering failed:', error);
      document.getElementById('app')?.classList.remove('ui-ready');
      const output = document.getElementById('status');
      if (output) { output.hidden = false; output.textContent = `Echec ImGui : ${String(error)}`; }
    }
  };
  frame = requestAnimationFrame(render);
  return () => { stopped = true; cancelAnimationFrame(frame); detachInput(); ImGui.DestroyContext(); };
}
