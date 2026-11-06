# MaterialX Light Support Integration

## Overview
This document describes the adaptation of the materialx-webgpu-engine to support MaterialX light types:
- **point_light**: Point light source with position, color, intensity, and decay_rate
- **spot_light**: Spotlight with position, direction, color, intensity, decay_rate, inner_angle, and outer_angle
- **directional_light**: Directional light (mapped to USD's DistantLight)

## Changes Made

### 1. USD Light Type Support (src/usd/lights.ts)

#### Type Definitions
- Extended `LightType` union to include `'point'` and `'spot'` types
- Added new optional fields to `SceneLight`:
  - `decayRate?: number`: Decay exponent for point/spot lights (defaults to 2.0 for quadratic falloff)
  - `innerAngle?: number`: Inner cone angle in degrees for spot lights
  - `outerAngle?: number`: Outer cone angle in degrees for spot lights

#### USD Parsing (importLights)
- Updated `TYPE_MAP` to include:
  - `PointLight: 'point'`
  - `SpotLight: 'spot'`
- Added parsing for MaterialX-specific attributes:
  - `inputs:decayRate` (point and spot lights)
  - `inputs:shaping:cone:innerAngle` (spot lights)
  - `inputs:shaping:cone:outerAngle` (spot lights)

### 2. Path Tracing Support (src/render/pathtracing/analytic-lights.ts)

#### Light Packing Format
- Increased `PT_LIGHT_FLOATS` from 20 to 28 to accommodate new light types
- Light data layout (7 vec4 = 28 floats):
  ```
  [0] position.xyz | type (0=rect, 1=sphere, 2=distant, 3=point, 4=spot)
  [1] color.rgb | area
  [2] u.xyz | radius (for sphere) / unused (for point/spot)
  [3] v.xyz | decayRate
  [4] normal.xyz | unused
  [5] direction.xyz | unused (for point/spot, stores light direction)
  [6] cosInner | cosOuter | unused | unused
  ```

#### Light Type Mapping
- Type 0: Rectangular light
- Type 1: Sphere light
- Type 2: Distant light (directional)
- Type 3: Point light (new)
- Type 4: Spot light (new)

#### WGSL Functions
- **mx_sample_light()**: Updated to sample from point and spot lights
  - Point lights: Uniform hemisphere sampling
  - Spot lights: Cone-weighted sampling using inner/outer angles
- **mx_intersect_lights()**: Currently skips point/spot lights (ray-surface intersections not needed for punctual lights)

### 3. Forward Raster Lighting (src/render/raster/lighting.ts)

#### Cluster Light System
- `ClusterLightType` already supports `'point'` and `'spot'` types
- `lightArea()` function updated to return 0 for point/spot lights (no area normalization)
- Lights are already routed to clusters based on their view-space depth and screen-space bounds

### 4. Forward Shader (src/render/raster/ir-forward.ts)
- Current implementation uses a single dominant directional light
- Point and spot lights can be added as additional local lights in the fragment shader
- Environment IBL provides diffuse and specular contributions

## Implementation Path for Full Support

### Phase 1: Basic Support (Current)
- ✅ Parse point and spot lights from USD/MaterialX
- ✅ Pack lights for path tracer
- ✅ WGSL code for path tracer light sampling and intersection
- ⚠️  Forward raster: dominant directional light only

### Phase 2: Forward+ Clustering (Future)
- Create light culling compute shader
- Assign point/spot lights to screen-space clusters
- Generate per-cluster light lists
- Use in fragment shader light loops

### Phase 3: Shadow Mapping (Future)
- Point lights: Omnidirectional shadow maps (cubemaps)
- Spot lights: Standard directional shadow maps
- Cascade/atlas management

## WGSL Shader Integration

### Path Tracer (ANALYTIC_LIGHTS_WGSL)
Point and spot lights are sampled in `mx_sample_light()`:
```wgsl
// For point lights (type 3):
let theta = 2.0 * PI * u.x;
let phi = acos(1.0 - 2.0 * u.y);
normal = vec3f(sin(phi) * cos(theta), sin(phi) * sin(theta), cos(phi));

// For spot lights (type 4):
let cosAngle = mix(cosOuter, cosInner, u.y);
let sinAngle = sqrt(max(0.0, 1.0 - cosAngle * cosAngle));
// Sample within cone...
```

### Forward Raster (ir-forward.ts)
Current single directional light evaluation can be extended with:
- Deferred light clustering
- Per-cluster light lists in storage buffers
- Fragment shader light loops over assigned lights

## Material Definition Schema

MaterialX light nodes are defined in `lights_defs.mtlx`:

```xml
<nodedef name="ND_point_light" node="point_light" nodegroup="light">
  <input name="position" type="vector3" />
  <input name="color" type="color3" />
  <input name="intensity" type="float" />
  <input name="decay_rate" type="float" value="2.0" />
  <output name="out" type="lightshader" />
</nodedef>

<nodedef name="ND_spot_light" node="spot_light" nodegroup="light">
  <input name="position" type="vector3" />
  <input name="direction" type="vector3" />
  <input name="color" type="color3" />
  <input name="intensity" type="float" />
  <input name="decay_rate" type="float" value="2.0" />
  <input name="inner_angle" type="float" />
  <input name="outer_angle" type="float" />
  <output name="out" type="lightshader" />
</nodedef>

<nodedef name="ND_directional_light" node="directional_light" nodegroup="light">
  <input name="direction" type="vector3" />
  <input name="color" type="color3" />
  <input name="intensity" type="float" />
  <output name="out" type="lightshader" />
</nodedef>
```

## Testing

### Unit Tests
- Light parsing from USD scenes
- Light packing for path tracer
- WGSL shader compilation

### Integration Tests
- Path tracer rendering with point lights
- Path tracer rendering with spot lights
- Forward raster with directional fallback

### Visual Tests
- Compare point light behavior with reference implementations
- Verify cone angle attenuation for spot lights
- Check decay rate falloff curves

## Future Enhancements

1. **Efficiency**: Implement GPU-driven light culling
2. **Shadows**: Add shadow maps for point/spot lights
3. **Profiles**: Support IES photometric profiles
4. **Advanced Sampling**: Implement importance sampling for light selection
5. **GPU Resident**: Full light data in GPU buffers for dynamic updates
