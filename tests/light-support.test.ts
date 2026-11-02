// Test file for MaterialX light support
import { describe, it, expect } from 'vitest';
import type { SceneLight } from '../src/usd/lights';
import { packAnalyticLights, PT_LIGHT_FLOATS } from '../src/render/pathtracing/analytic-lights';

describe('MaterialX Light Support', () => {
  it('should pack point lights correctly', () => {
    const pointLight: SceneLight = {
      path: '/lights/point1',
      type: 'point',
      usdType: 'PointLight',
      color: [1, 1, 1],
      intensity: 100,
      exposure: 0,
      normalize: false,
      decayRate: 2.0,
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 5, 5, 1],
    };

    const data = packAnalyticLights([pointLight]);
    
    expect(data.length).toBe(PT_LIGHT_FLOATS);
    
    // Check type (should be 3 for point light)
    expect(data[3]).toBe(3);
    
    // Check position
    expect(data[0]).toBe(5);
    expect(data[1]).toBe(5);
    expect(data[2]).toBe(5);
    
    // Check color and intensity
    expect(data[4]).toBe(100); // color.r * gain
    expect(data[5]).toBe(100); // color.g * gain
    expect(data[6]).toBe(100); // color.b * gain
    expect(data[7]).toBe(0);   // area (0 for point light)
    
    // Check decay rate
    expect(data[15]).toBe(2.0);
  });

  it('should pack spot lights correctly', () => {
    const spotLight: SceneLight = {
      path: '/lights/spot1',
      type: 'spot',
      usdType: 'SpotLight',
      color: [1, 1, 1],
      intensity: 200,
      exposure: 0,
      normalize: false,
      decayRate: 2.0,
      innerAngle: 15,
      outerAngle: 30,
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 10, 0, 1],
    };

    const data = packAnalyticLights([spotLight]);
    
    expect(data.length).toBe(PT_LIGHT_FLOATS);
    
    // Check type (should be 4 for spot light)
    expect(data[3]).toBe(4);
    
    // Check position
    expect(data[0]).toBe(0);
    expect(data[1]).toBe(10);
    expect(data[2]).toBe(0);
    
    // Check decay rate
    expect(data[15]).toBe(2.0);
    
    // Check cone angles (stored as cosines)
    const innerAngleCos = Math.cos(15 * Math.PI / 180);
    const outerAngleCos = Math.cos(30 * Math.PI / 180);
    expect(data[24]).toBeCloseTo(innerAngleCos, 5);
    expect(data[25]).toBeCloseTo(outerAngleCos, 5);
  });

  it('should pack distant lights correctly', () => {
    const distantLight: SceneLight = {
      path: '/lights/sun',
      type: 'distant',
      usdType: 'DistantLight',
      color: [1, 1, 1],
      intensity: 1,
      exposure: 1,
      normalize: false,
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    };

    const data = packAnalyticLights([distantLight]);
    
    expect(data.length).toBe(PT_LIGHT_FLOATS);
    
    // Check type (should be 2 for distant light)
    expect(data[3]).toBe(2);
  });

  it('should pack multiple lights of different types', () => {
    const lights: SceneLight[] = [
      {
        path: '/lights/point1',
        type: 'point',
        usdType: 'PointLight',
        color: [1, 1, 1],
        intensity: 100,
        exposure: 0,
        normalize: false,
        decayRate: 2.0,
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      },
      {
        path: '/lights/spot1',
        type: 'spot',
        usdType: 'SpotLight',
        color: [1, 0.8, 0.6],
        intensity: 200,
        exposure: 0,
        normalize: false,
        decayRate: 2.0,
        innerAngle: 15,
        outerAngle: 30,
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      },
      {
        path: '/lights/sun',
        type: 'distant',
        usdType: 'DistantLight',
        color: [1, 1, 1],
        intensity: 1,
        exposure: 1,
        normalize: false,
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      },
    ];

    const data = packAnalyticLights(lights);
    
    expect(data.length).toBe(PT_LIGHT_FLOATS * 3);
    
    // Check each light's type
    expect(data[3]).toBe(3);  // First light: point
    expect(data[31]).toBe(4); // Second light: spot (at offset 28 + 3)
    expect(data[59]).toBe(2); // Third light: distant (at offset 56 + 3)
  });

  it('should throw error for invalid point light decay rate', () => {
    const invalidLight: SceneLight = {
      path: '/lights/invalid',
      type: 'point',
      usdType: 'PointLight',
      color: [1, 1, 1],
      intensity: 100,
      exposure: 0,
      normalize: false,
      decayRate: -1.0, // Invalid: negative decay rate
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    };

    expect(() => packAnalyticLights([invalidLight])).toThrow('Invalid decay rate');
  });

  it('should throw error for invalid spot light cone angles', () => {
    const invalidLight: SceneLight = {
      path: '/lights/invalid',
      type: 'spot',
      usdType: 'SpotLight',
      color: [1, 1, 1],
      intensity: 100,
      exposure: 0,
      normalize: false,
      decayRate: 2.0,
      innerAngle: NaN, // Invalid: NaN angle
      outerAngle: 30,
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    };

    expect(() => packAnalyticLights([invalidLight])).toThrow('Invalid cone angles');
  });
});
