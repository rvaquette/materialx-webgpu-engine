# Integration Guide: MaterialX Light Support

This guide explains how to integrate and use the new MaterialX light types (point and spot lights) in the WebGPU engine.

## Quick Start

### 1. Creating Lights from USD Scenes

Lights are automatically parsed from USD files. Simply create USD prims with the correct types:

```usda
def PointLight "table_lamp" {
    float3 xformOp:translate = (2, 3, 1)
    uniform token[] xformOpOrder = ["xformOp:translate"]
    
    color3f inputs:color = (1.0, 0.95, 0.8)
    float inputs:intensity = 500
    float inputs:exposure = 0
    float inputs:decayRate = 2.0
}

def SpotLight "stage_light" {
    float3 xformOp:translate = (0, 10, 5)
    uniform token[] xformOpOrder = ["xformOp:translate"]
    
    color3f inputs:color = (1, 1, 1)
    float inputs:intensity = 1000
    float inputs:exposure = 0
    float inputs:decayRate = 2.0
    float inputs:shaping:cone:innerAngle = 15
    float inputs:shaping:cone:outerAngle = 30
}

def DistantLight "sun" {
    vector3f inputs:direction = (0.3, 0.5, 0.8)
    color3f inputs:color = (1, 1, 1)
    float inputs:intensity = 1
    float inputs:exposure = 2
}
```

### 2. Path Tracing Support

The path tracer automatically handles all light types. When rendering with path tracing:

```typescript
import { importLights } from 'src/usd/lights';
import { packAnalyticLights } from 'src/render/pathtracing/analytic-lights';

// Import lights from USD scene
const lights = importLights(scene);

// Pack for GPU
const packedLights = packAnalyticLights(lights);

// Upload to GPU buffer and use in path tracer
```

**Path Tracer Light Types:**
- Type 0: Rectangular light
- Type 1: Sphere light
- Type 2: Distant light (directional)
- Type 3: Point light (new)
- Type 4: Spot light (new)

### 3. Forward Raster Support

Currently, the forward raster renderer uses a dominant directional light:

```typescript
import { directionalLightFrom, environmentFrom } from 'src/render/raster/scene-frame';

// Automatically picks the first DistantLight or uses a fallback
const dominantLight = directionalLightFrom(lights);
const environment = environmentFrom(lights);
```

For full Forward+ support with multiple point/spot lights, the infrastructure is ready:
- Lights are already classified as `ClusterLight` types
- Cluster grid assignment is computed
- Fragment shader can be extended to loop over assigned lights

### 4. Light Attributes Reference

#### PointLight

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `inputs:color` | color3 | (1,1,1) | Light color (RGB) |
| `inputs:intensity` | float | 1 | Light intensity |
| `inputs:exposure` | float | 0 | Intensity multiplier as 2^exposure |
| `inputs:normalize` | bool | false | Normalize by light area |
| `inputs:decayRate` | float | 2.0 | Falloff exponent (2 = quadratic) |

**Position:** Derived from the prim's `xformOp:translate` transform

#### SpotLight

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `inputs:color` | color3 | (1,1,1) | Light color (RGB) |
| `inputs:intensity` | float | 1 | Light intensity |
| `inputs:exposure` | float | 0 | Intensity multiplier |
| `inputs:decayRate` | float | 2.0 | Falloff exponent |
| `inputs:shaping:cone:innerAngle` | float | 0 | Inner cone angle (degrees) |
| `inputs:shaping:cone:outerAngle` | float | 45 | Outer cone angle (degrees) |

**Position & Direction:** Derived from prim transform (direction = -Z local axis)

#### DistantLight

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `inputs:color` | color3 | (1,1,1) | Light color |
| `inputs:intensity` | float | 1 | Light intensity |
| `inputs:exposure` | float | 0 | Intensity multiplier |
| `inputs:angle` | float | 0 | Angular diameter (for sun disk) |

**Direction:** Derived from prim transform (direction = -Z local axis)

### 5. Physical Parameters

#### Decay Rates

The decay rate controls how light intensity falls off with distance:

```
intensity(distance) = base_intensity / (distance ^ decay_rate)
```

Common values:
- `0.0`: No falloff (stage light effect)
- `1.0`: Linear falloff
- `2.0`: **Quadratic falloff** (physically correct for point sources)
- `3.0`: Cubic falloff (for special effects)

#### Cone Angles (Spot Lights)

Two cone angles define a spotlight's shape:

- **Inner angle:** Radius where light intensity is 100%
- **Outer angle:** Radius where light intensity is 0% (soft edge)
- **Transition:** Linear falloff between inner and outer angles

Example:
```
innerAngle = 15°  (bright cone)
outerAngle = 30°  (soft transition to darkness)
```

### 6. Rendering Backend Selection

**Path Tracer:**
- ✅ Full support for point/spot lights
- ✅ Physically accurate sampling
- ✅ Correct shadow interaction

**Forward Raster (Current):**
- ✅ Single dominant directional light (from DistantLight or fallback)
- ⚠️ Point/spot lights in cluster system (infrastructure ready)
- 🔲 Full Forward+ multi-light rendering (planned)

### 7. Exporting Lights

When exporting scenes from DCCs to USD:

**In Houdini:**
```python
# Create point light
light = hou.node("..").createNode("light")
light.parm("light_type").set("point")
light.parm("intensity").set(500)
light.parm("decay_rate").set(2.0)
```

**In Maya to USD:**
```python
cmds.pointLight(name="lamp", intensity=500)
# Export as USD PointLight prim
```

**In Blender to USD:**
```python
bpy.data.lights.new(name="lamp", type='POINT')
# Use the official USD add-on to export
```

### 8. Validation and Error Handling

The light parsing includes validation:

```typescript
// Throws error if:
// - Position has NaN values
// - Intensity is negative
// - Color channels are negative
// - Point light decay rate is invalid
// - Spot light cone angles are invalid
// - Direction vectors are degenerate (zero length)
```

Errors are logged with the full prim path for easy debugging:

```
Invalid decay rate for point light at /lights/lamp
Degenerate spot light direction at /lights/stage_light
```

### 9. Performance Considerations

**Memory:**
- Each light uses 112 bytes (28 floats × 4 bytes) in path tracer buffer
- Lights are stored in a single GPU storage buffer

**Compute:**
- Point light sampling: O(1) per sample
- Spot light sampling: O(1) per sample with cone masking
- Clustering: O(light_count × cluster_count) preprocessing

**Optimization Tips:**
1. Use decay_rate = 2.0 for physical accuracy
2. Limit outer cone angle for spotlights to avoid excessive sampling
3. Prefer distant lights for area-wide illumination
4. Group nearby point lights into mesh lights when possible

### 10. Troubleshooting

**Q: Lights appear too dim/bright**
A: Check intensity and exposure values. Exposure is log2 scale: `exposure = 1` means 2× brighter.

**Q: Spot light cone is wrong**
A: Verify innerAngle < outerAngle. Both should be positive and typically < 90°.

**Q: Path tracer crashes with point lights**
A: Ensure light position is finite (not NaN or infinity). Check for degenerate transforms.

**Q: Point lights don't appear in forward renderer**
A: Forward raster currently uses only the dominant directional light. The clustering system is ready for Forward+.

## Code Examples

### Loading and Rendering with Lights

```typescript
import { importLights } from 'src/usd/lights';
import { packAnalyticLights } from 'src/render/pathtracing/analytic-lights';
import { buildSceneFramePlan } from 'src/render/raster/scene-frame';

// Load USD scene
const scene = await loadUSDScene('scene.usda');

// Import lights
const lights = importLights(scene);

// For path tracing
const packedLights = packAnalyticLights(lights);
// ... upload packedLights to GPU buffer

// For forward raster
const framePlan = buildSceneFramePlan(resources, {
  lights,
  camera: scene.defaultCamera,
});
```

### Creating Lights Programmatically

```typescript
import type { SceneLight } from 'src/usd/lights';
import { packAnalyticLights } from 'src/render/pathtracing/analytic-lights';

const myLights: SceneLight[] = [
  {
    path: '/lights/accent',
    type: 'point',
    usdType: 'PointLight',
    color: [1, 0.8, 0.6],
    intensity: 200,
    exposure: 0,
    normalize: false,
    decayRate: 2.0,
    transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 2, 1, 1],
  },
];

const packed = packAnalyticLights(myLights);
```

## References

- [MaterialX Light Specification](lights_defs.mtlx)
- [USD Lux Schema](https://openusd.org/en/docs/manual/plugins/usdLux.html)
- [Physically Based Light Falloff](https://en.wikipedia.org/wiki/Inverse-square_law)
- [Forward+ Rendering](https://takahiroharada.wordpress.com/2012/12/12/forward-plus/)
