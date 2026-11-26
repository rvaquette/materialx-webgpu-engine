import { DEFAULT_ENVIRONMENT_SHADER, type EnvironmentShaderSettings } from '../materialx/engine-shaders.ts';

/** Presets are procedural HDR environments, not bundled photographic HDRIs. */
export const LIGHTING_PRESETS = {
  studio: {
    ...DEFAULT_ENVIRONMENT_SHADER, model: 'studio',
    horizonColor: [0.18, 0.18, 0.18], groundColor: [0.04, 0.04, 0.04],
    sunIntensity: 6,
  },
  exterior: { ...DEFAULT_ENVIRONMENT_SHADER, model: 'sky' },
  gradient: {
    ...DEFAULT_ENVIRONMENT_SHADER, model: 'gradient',
    zenithColor: [0.3, 0.38, 0.5], horizonColor: [0.65, 0.68, 0.72],
    groundColor: [0.1, 0.1, 0.1], sunIntensity: 0,
  },
} satisfies Record<string, EnvironmentShaderSettings>;

export type LightingPreset = keyof typeof LIGHTING_PRESETS;

/** Return an independent copy so later edits cannot mutate a preset. */
export function lightingPreset(name: LightingPreset): EnvironmentShaderSettings {
  const preset: EnvironmentShaderSettings = LIGHTING_PRESETS[name];
  if (!preset) throw new Error(`Unknown lighting preset: ${name}`);
  return {
    ...preset,
    zenithColor: [...preset.zenithColor], horizonColor: [...preset.horizonColor],
    groundColor: [...preset.groundColor], sunColor: [...preset.sunColor],
    sunDirection: [...preset.sunDirection],
  };
}
