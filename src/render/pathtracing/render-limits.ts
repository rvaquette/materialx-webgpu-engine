import { PT_ADAPTIVE_MIN_SAMPLES, type PathTraceConvergence } from './convergence.ts';

export interface PathTraceRenderLimits {
  readonly stopOnConvergence: boolean;
  /** Zero leaves the active rendering time unlimited. */
  readonly timeBudgetSeconds: number;
  readonly targetRelativeError: number;
}

export interface PathTraceProgress {
  elapsedSeconds: number;
  stopReason: 'convergence' | 'time-budget' | undefined;
}

export interface PathTraceMetrics {
  sweepsPerSecond?: number;
  budgetRemainingSeconds?: number;
  convergenceRemainingSeconds?: number;
  relativeNoise?: number;
  maximumRelativeNoise?: number;
  relativeVariance?: number;
}

export function pathTraceMetrics(
  progress: PathTraceProgress,
  limits: PathTraceRenderLimits,
  samples: number,
  adaptive: boolean,
  convergence: PathTraceConvergence | undefined,
): PathTraceMetrics {
  const metrics: PathTraceMetrics = {};
  const rate = samples / progress.elapsedSeconds;
  if (samples > 0 && rate > 0 && Number.isFinite(rate)) metrics.sweepsPerSecond = rate;
  if (limits.timeBudgetSeconds > 0) {
    metrics.budgetRemainingSeconds = Math.max(0, limits.timeBudgetSeconds - progress.elapsedSeconds);
  }
  if (!convergence || convergence.samples > samples
    || convergence.zones.length === 0 || convergence.zones.length !== convergence.columns * convergence.rows
    || !convergence.zones.every(zone => zone.validFraction === 1
      && Number.isFinite(zone.relativeError) && zone.relativeError >= 0
      && Number.isFinite(zone.maximumRelativeError) && zone.maximumRelativeError >= 0)) return metrics;

  const squaredNoise = convergence.zones.reduce((sum, zone) => sum + zone.relativeError ** 2, 0)
    / convergence.zones.length;
  const maximumNoise = Math.max(...convergence.zones.map(zone => zone.maximumRelativeError));
  if (!Number.isFinite(squaredNoise)) return metrics;
  metrics.relativeNoise = Math.sqrt(squaredNoise);
  metrics.maximumRelativeNoise = maximumNoise;
  if (adaptive) return metrics;

  // Undo the 95% interval's sample-count scaling; luminance uses the estimator's floor.
  const variance = squaredNoise * convergence.samples / 1.96 ** 2;
  if (Number.isFinite(variance)) metrics.relativeVariance = variance;
  if (convergence.samples >= PT_ADAPTIVE_MIN_SAMPLES && metrics.sweepsPerSecond !== undefined
    && Number.isFinite(convergence.targetRelativeError) && convergence.targetRelativeError > 0) {
    const targetSamples = Math.max(PT_ADAPTIVE_MIN_SAMPLES,
      convergence.samples * (maximumNoise / convergence.targetRelativeError) ** 2);
    const remaining = Math.max(0, targetSamples - samples) / metrics.sweepsPerSecond;
    if (Number.isFinite(remaining)) metrics.convergenceRemainingSeconds = remaining;
  }
  return metrics;
}

export class PathTraceStopping {
  #limits: PathTraceRenderLimits;
  #milliseconds = 0;
  #stableMeasurements = 0;
  #lastSamples = 0;
  #stopReason: PathTraceProgress['stopReason'];

  constructor(limits: PathTraceRenderLimits) {
    this.#limits = limits;
  }

  get progress(): PathTraceProgress {
    return { elapsedSeconds: this.#milliseconds / 1000, stopReason: this.#stopReason };
  }

  configure(limits: PathTraceRenderLimits): void {
    this.#limits = limits;
    this.#stableMeasurements = 0;
    this.#stopReason = undefined;
    this.#checkTimeBudget();
  }

  reset(): void {
    this.#milliseconds = 0;
    this.#stableMeasurements = 0;
    this.#lastSamples = 0;
    this.#stopReason = undefined;
  }

  recordBatch(milliseconds: number): void {
    this.#milliseconds += milliseconds;
    this.#checkTimeBudget();
  }

  observe(convergence: PathTraceConvergence | undefined): void {
    if (!convergence) {
      this.#stableMeasurements = 0;
      return;
    }
    if (convergence.targetRelativeError !== this.#limits.targetRelativeError) {
      this.#stableMeasurements = 0;
      return;
    }
    if (!this.#limits.stopOnConvergence || this.#stopReason || convergence.samples <= this.#lastSamples) return;
    this.#lastSamples = convergence.samples;
    const converged = convergence.samples >= PT_ADAPTIVE_MIN_SAMPLES
      && convergence.zones.length === convergence.columns * convergence.rows
      && convergence.zones.length > 0
      && convergence.zones.every(zone => zone.validFraction === 1 && zone.convergedFraction === 1
        && Number.isFinite(zone.maximumRelativeError) && zone.maximumRelativeError >= 0
        && zone.maximumRelativeError <= this.#limits.targetRelativeError);
    this.#stableMeasurements = converged ? this.#stableMeasurements + 1 : 0;
    if (this.#stableMeasurements >= 3) this.#stopReason = 'convergence';
  }

  #checkTimeBudget(): void {
    if (!this.#stopReason && this.#limits.timeBudgetSeconds > 0
      && this.#milliseconds >= this.#limits.timeBudgetSeconds * 1000) {
      this.#stopReason = 'time-budget';
    }
  }
}
