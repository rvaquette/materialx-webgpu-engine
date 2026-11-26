import type { HdrImage } from '../assets/hdr.ts';

export const ENGINE_SHADER_LIBRARY_XML = `<materialx version="1.39">
  <typedef name="engine_environment_shader" semantic="shader" context="environment" />
  <typedef name="engine_image_shader" semantic="shader" context="image" />
  <nodedef name="ND_engine_environment_shader" node="environment_shader" doc="Procedural environment, evaluated by direction and baked to a lat-long HDR image for rendering.">
    <input name="model" type="string" value="sky" enum="gradient,sky,studio" />
    <input name="zenithColor" type="color3" value="0.16, 0.34, 0.72" />
    <input name="horizonColor" type="color3" value="0.72, 0.82, 1" />
    <input name="groundColor" type="color3" value="0.12, 0.1, 0.08" />
    <input name="sunColor" type="color3" value="1, 0.78, 0.48" />
    <input name="sunDirection" type="vector3" value="0.3, 0.82, 0.48" />
    <input name="sunIntensity" type="float" value="8" uimin="0" uimax="100" />
    <input name="sunAngularDiameter" type="float" value="0.53" uimin="0.01" uimax="30" />
    <input name="exposure" type="float" value="0" uimin="-10" uimax="10" />
    <input name="rotation" type="float" value="0" uimin="-360" uimax="360" />
    <input name="animationSpeed" type="float" value="0" uimin="-360" uimax="360" />
    <output name="out" type="engine_environment_shader" />
  </nodedef>
  <nodedef name="ND_engine_image_shader" node="image_shader" doc="Screen-space color grading and vignette applied after display rendering, including path-tracing AOVs.">
    <input name="exposure" type="float" value="0" uimin="-10" uimax="10" />
    <input name="contrast" type="float" value="1" uimin="0" uimax="4" />
    <input name="saturation" type="float" value="1" uimin="0" uimax="4" />
    <input name="vignette" type="float" value="0" uimin="0" uimax="1" />
    <output name="out" type="engine_image_shader" />
  </nodedef>
</materialx>`;

export type Rgb = readonly [number, number, number];
export type Vector3 = readonly [number, number, number];

export interface EnvironmentShaderSettings {
  model: 'gradient' | 'sky' | 'studio';
  zenithColor: Rgb;
  horizonColor: Rgb;
  groundColor: Rgb;
  sunColor: Rgb;
  sunDirection: Vector3;
  sunIntensity: number;
  sunAngularDiameter: number;
  exposure: number;
  rotation: number;
  animationSpeed: number;
}

export interface ImageShaderSettings {
  exposure: number;
  contrast: number;
  saturation: number;
  vignette: number;
}

export const DEFAULT_ENVIRONMENT_SHADER: EnvironmentShaderSettings = {
  model: 'sky',
  zenithColor: [0.16, 0.34, 0.72],
  horizonColor: [0.72, 0.82, 1],
  groundColor: [0.12, 0.1, 0.08],
  sunColor: [1, 0.78, 0.48],
  sunDirection: [0.3, 0.82, 0.48],
  sunIntensity: 8,
  sunAngularDiameter: 0.53,
  exposure: 0,
  rotation: 0,
  animationSpeed: 0,
};

export const DEFAULT_IMAGE_SHADER: ImageShaderSettings = {
  exposure: 0,
  contrast: 1,
  saturation: 1,
  vignette: 0,
};

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function normalize(value: Vector3): [number, number, number] {
  const length = Math.hypot(...value);
  return length > 0 ? [value[0] / length, value[1] / length, value[2] / length] : [0, 1, 0];
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Bake the procedural environment to the same top-down lat-long layout used by the path tracer. */
export function bakeEnvironmentShader(
  settings: EnvironmentShaderSettings, time = 0, width = 512, height = width / 2,
): HdrImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 4 || height < 2) {
    throw new RangeError('Environment dimensions must be integers of at least 4x2.');
  }
  if (!['gradient', 'sky', 'studio'].includes(settings.model) ||
      ![time, settings.sunIntensity, settings.sunAngularDiameter, settings.exposure, settings.rotation, settings.animationSpeed,
        ...settings.zenithColor, ...settings.horizonColor, ...settings.groundColor, ...settings.sunColor, ...settings.sunDirection]
        .every(Number.isFinite) ||
      settings.sunIntensity < 0 || settings.sunIntensity > 100 ||
      settings.sunAngularDiameter < 0.01 || settings.sunAngularDiameter > 30 ||
      Math.abs(settings.exposure) > 10 ||
      [settings.zenithColor, settings.horizonColor, settings.groundColor, settings.sunColor]
        .some(color => color.some(component => component < 0 || component > 10_000))) {
    throw new RangeError('Environment shader inputs must be finite and within their declared NodeDef ranges.');
  }
  const data = new Float32Array(width * height * 3);
  const angle = ((settings.rotation % 360) + (settings.animationSpeed % 360) * (time % 360)) * Math.PI / 180;
  const [sunX, sunY, sunZ] = normalize(settings.sunDirection);
  const cosRotation = Math.cos(angle);
  const sinRotation = Math.sin(angle);
  const rotatedSun: [number, number, number] = [
    sunX * cosRotation + sunZ * sinRotation,
    sunY,
    -sunX * sinRotation + sunZ * cosRotation,
  ];
  const sunCos = Math.cos(Math.max(0.01, settings.sunAngularDiameter) * Math.PI / 360);
  const exposure = 2 ** settings.exposure;
  const studioBoxes: readonly { direction: Vector3; sharpness: number; color: Rgb }[] = [
    { direction: [-0.55, 0.62, 0.56], sharpness: 90, color: [1, 0.88, 0.72] },
    { direction: [0.65, 0.42, 0.62], sharpness: 120, color: [0.62, 0.76, 1] },
    { direction: [0.05, 0.98, -0.15], sharpness: 70, color: [1, 1, 1] },
  ];
  const softboxes: readonly { direction: Vector3; sharpness: number; color: Rgb }[] = settings.model === 'studio'
    ? studioBoxes.map(box => {
      const [x, y, z] = normalize(box.direction);
      const direction: Vector3 = [x * cosRotation + z * sinRotation, y, -x * sinRotation + z * cosRotation];
      return {
        ...box,
        direction,
      };
    })
    : [];

  for (let y = 0; y < height; y++) {
    const theta = Math.PI * (y + 0.5) / height;
    const vertical = Math.cos(theta);
    const radius = Math.sin(theta);
    for (let x = 0; x < width; x++) {
      const phi = 2 * Math.PI * (x + 0.5) / width;
      const direction: [number, number, number] = [
        -radius * Math.cos(phi),
        vertical,
        -radius * Math.sin(phi),
      ];
      const cosSun = direction[0] * rotatedSun[0] + direction[1] * rotatedSun[1] + direction[2] * rotatedSun[2];
      const aboveHorizon = smoothstep(-0.08, 0.16, vertical);
      const horizon = smoothstep(-0.12, 0.12, vertical);
      const skyBlend = settings.model === 'gradient' ? aboveHorizon : smoothstep(0.015, 0.9, aboveHorizon);
      const base = settings.model === 'studio'
        ? settings.groundColor.map((component, channel) =>
          mix(component, settings.horizonColor[channel]!, smoothstep(-0.35, 0.45, vertical)))
        : settings.groundColor.map((component, channel) =>
          mix(mix(component, settings.horizonColor[channel]!, horizon), settings.zenithColor[channel]!, skyBlend));
      const glow = settings.model === 'gradient' || settings.model === 'studio'
        ? 0 : Math.pow(Math.max(0, cosSun), 10) * 0.28;
      const sunDisk = settings.model === 'gradient' || settings.model === 'studio'
        ? 0 : smoothstep(sunCos - 0.0007, sunCos + 0.0007, cosSun);
      const softbox: [number, number, number] = [0, 0, 0];
      for (const box of softboxes) {
        const lobe = Math.pow(Math.max(0,
          direction[0] * box.direction[0] + direction[1] * box.direction[1] + direction[2] * box.direction[2]), box.sharpness);
        for (let channel = 0; channel < 3; channel++) {
          softbox[channel] = softbox[channel]! + box.color[channel]! * lobe * settings.sunIntensity;
        }
      }
      const offset = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel++) {
        const radiance = base![channel]! +
          settings.sunColor[channel]! * (glow * settings.sunIntensity + sunDisk * settings.sunIntensity) +
          softbox[channel]!;
        data[offset + channel] = Math.max(0, radiance * exposure);
      }
    }
  }
  return { width, height, data };
}
