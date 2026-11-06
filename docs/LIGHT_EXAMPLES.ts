// Example: Using MaterialX Light Types with the WebGPU Engine
// This example demonstrates how to work with point and spot lights

import type { SceneLight } from './src/usd/lights';
import { packAnalyticLights } from './src/render/pathtracing/analytic-lights';

/**
 * Example 1: Creating a point light programmatically
 * 
 * Point lights emit light in all directions from a single position.
 * They use quadratic decay by default (falloff = 1/distance²)
 */
function createPointLightExample(): SceneLight {
  return {
    path: '/lights/table_lamp',
    type: 'point',
    usdType: 'PointLight',
    color: [1.0, 0.95, 0.8],      // Warm white
    intensity: 500,                 // Typical bulb intensity
    exposure: 0,
    normalize: false,
    decayRate: 2.0,                 // Quadratic falloff
    transform: [
      1, 0, 0, 0,                   // Identity rotation
      0, 1, 0, 0,
      0, 0, 1, 0,
      2, 3, 1, 1                    // Position: (2, 3, 1)
    ],
  };
}

/**
 * Example 2: Creating a spot light programmatically
 * 
 * Spot lights emit a cone of light from a position in a specific direction.
 * Inner angle: soft edge transition zone
 * Outer angle: hard edge of the light cone
 */
function createSpotLightExample(): SceneLight {
  return {
    path: '/lights/stage_spotlight',
    type: 'spot',
    usdType: 'SpotLight',
    color: [1.0, 1.0, 1.0],        // White
    intensity: 1000,                // Stage lighting is bright
    exposure: 0,
    normalize: false,
    decayRate: 2.0,                 // Quadratic falloff
    innerAngle: 15,                 // Cone inner edge (degrees)
    outerAngle: 30,                 // Cone outer edge (degrees)
    transform: [
      1, 0, 0, 0,                   // Identity rotation
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 10, 5, 1                   // Position: (0, 10, 5) - high up
    ],
  };
}

/**
 * Example 3: Creating a directional light (equivalent to DistantLight)
 * 
 * Directional lights represent infinitely distant sources (like the sun).
 * Direction is specified as transform and doesn't decay with distance.
 */
function createDirectionalLightExample(): SceneLight {
  // Create a transform that points downward (-Z direction)
  const angle = 45 * Math.PI / 180;
  const transform: [number, number, number, number,
                    number, number, number, number,
                    number, number, number, number,
                    number, number, number, number] = [
    Math.cos(angle), 0, Math.sin(angle), 0,
    0, 1, 0, 0,
    -Math.sin(angle), 0, Math.cos(angle), 0,
    0, 0, 0, 1
  ];

  return {
    path: '/lights/sun',
    type: 'distant',
    usdType: 'DistantLight',
    color: [1.0, 0.95, 0.9],       // Slightly warm daylight
    intensity: 1,
    exposure: 2,                    // 2 stops brighter (for realistic outdoor)
    normalize: false,
    transform,
  };
}

/**
 * Example 4: Using lights with the path tracer
 * 
 * Pack multiple lights into the GPU buffer format used by the path tracer.
 */
function packLightsForPathTracer() {
  const lights: SceneLight[] = [
    createPointLightExample(),
    createSpotLightExample(),
    createDirectionalLightExample(),
  ];

  // Pack lights into a format the GPU path tracer understands
  const packedData = packAnalyticLights(lights);
  console.log(`Packed ${lights.length} lights into ${packedData.length} floats`);
  console.log(`Each light uses ${packedData.length / lights.length} floats`);
  
  return packedData;
}

/**
 * Example 5: Light configuration from USD/MaterialX files
 * 
 * When loading USD scenes, lights are automatically parsed from:
 * - UsdLux::PointLight prims → type: 'point'
 * - UsdLux::SpotLight prims → type: 'spot'
 * - UsdLux::DistantLight prims → type: 'distant'
 * 
 * USD Input attributes parsed:
 * - inputs:position (implicit from prim transform)
 * - inputs:direction (implicit from prim transform, for spot/distant)
 * - inputs:color
 * - inputs:intensity
 * - inputs:exposure
 * - inputs:normalize
 * - inputs:decayRate (point/spot only)
 * - inputs:shaping:cone:innerAngle (spot only)
 * - inputs:shaping:cone:outerAngle (spot only)
 */

/**
 * Example 6: Forward rendering with point/spot lights
 * 
 * The raster forward renderer currently uses a single dominant directional light,
 * but the light clustering infrastructure is ready for full Forward+ support.
 * Point and spot lights are assigned to screen-space clusters and can be
 * evaluated in the fragment shader.
 */

/**
 * Example 7: Light decay rates and falloff
 * 
 * The decay rate controls how light intensity falls off with distance:
 * - decay_rate = 1.0: Linear falloff (1/distance)
 * - decay_rate = 2.0: Quadratic falloff (1/distance²) - physically correct
 * - decay_rate = 0.0: No falloff (constant intensity)
 * 
 * intensity_at_distance = base_intensity / (distance ^ decay_rate)
 */

export { createPointLightExample, createSpotLightExample, createDirectionalLightExample };
