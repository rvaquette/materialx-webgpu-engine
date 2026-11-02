"""
MaterialX Light Support System Architecture
=============================================

High-Level Overview
-------------------

USD Scene File (.usda)
    ↓
    ├─ PointLight prim → {type: 'point', position, intensity, decayRate}
    ├─ SpotLight prim  → {type: 'spot', position, direction, angles}
    └─ DistantLight    → {type: 'distant', direction, intensity}
    
Parse Layer (src/usd/lights.ts)
    ├─ importLights(scene) → SceneLight[]
    └─ Validates all parameters
    
Decision Point: Render Backend
    ├─ Path Tracer
    │  ├─ packAnalyticLights() → Float32Array (GPU buffer)
    │  ├─ Upload to GPU
    │  └─ ANALYTIC_LIGHTS_WGSL shader
    │       ├─ mx_sample_light() → sample direction
    │       ├─ mx_light_pdf() → probability density
    │       └─ mx_intersect_lights() → ray intersections
    │
    └─ Forward Raster
       ├─ Single dominant directional light (current)
       ├─ Light clustering system (ready)
       └─ Future: Forward+ multi-light per fragment


GPU Light Buffer Format (Path Tracer)
=====================================

Each light occupies 28 floats (7 × vec4):

Offset  | Data Structure           | Type0   | Type1   | Type2   | Type3   | Type4
--------|--------------------------|---------|---------|---------|---------|----------
0-2     | position.xyz             | rect    | sphere  | dir     | pos     | pos
3       | light_type               | 0       | 1       | 2       | 3       | 4
--------|--------------------------|---------|---------|---------|---------|----------
4-6     | color.rgb                | color   | color   | color   | color   | color
7       | area                     | w*h     | 4πr²    | 0       | 0       | 0
--------|--------------------------|---------|---------|---------|---------|----------
8-10    | u.xyz or axis            | u_edge  | axis0   | —       | —       | —
11      | radius / decay_rate      | —       | radius  | —       | decay   | decay
--------|--------------------------|---------|---------|---------|---------|----------
12-14   | v.xyz or axis            | v_edge  | axis1   | —       | —       | —
15      | (reserved)               | —       | —       | —       | —       | —
--------|--------------------------|---------|---------|---------|---------|----------
16-18   | normal.xyz               | normal  | normal  | —       | —       | —
19      | (reserved)               | —       | —       | —       | —       | —
--------|--------------------------|---------|---------|---------|---------|----------
20-22   | direction.xyz            | —       | —       | dir     | —       | dir
23      | (reserved)               | —       | —       | —       | —       | —
--------|--------------------------|---------|---------|---------|---------|----------
24      | cos(inner_angle)         | —       | —       | —       | —       | cos_in
25      | cos(outer_angle)         | —       | —       | —       | —       | cos_out
26-27   | (reserved)               | —       | —       | —       | —       | —


Light Type Enumeration
======================

Type 0: Rectangular Light (Existing)
  - Area light with defined width and height
  - Samples uniformly over rectangle
  - Direct ray intersection test
  - Usage: Area lighting, panels, screens

Type 1: Sphere Light (Existing)
  - Area light with sphere geometry
  - Samples uniformly over sphere surface
  - Direct ray intersection test
  - Usage: Glowing objects, ambient spheres

Type 2: Distant Light (Existing)
  - Infinite parallel rays (like sun)
  - Direction stored in transform
  - No ray intersection (parallel rays)
  - Usage: Sky lighting, directional shadows

Type 3: Point Light (NEW)
  - Punctual source at single position
  - Isotropic emission in all directions
  - Quadratic decay by default
  - No ray intersection (punctual)
  - Usage: Bulbs, lamps, local illumination

Type 4: Spot Light (NEW)
  - Punctual source with cone constraint
  - Direction and cone angles stored
  - Quadratic decay by default
  - Cone falloff between inner/outer angles
  - No ray intersection (punctual)
  - Usage: Stage lights, flashlights, focused beam


Sampling Pipeline (Path Tracer)
================================

for each path bounce:
  select_light(u.z)  →  index ∈ [0, light_count)
  
  switch light[index].type:
    case 0 (rect):
      point = position + u.x * u_vec + u.y * v_vec
      normal = rect_normal
      
    case 1 (sphere):
      θ = 2π * u.x
      φ = acos(1 - 2u.y)
      point = center + radius * (sin φ cos θ, sin φ sin θ, cos φ)
      normal = (point - center) / radius
      
    case 2 (distant):
      direction = normalize(stored_direction)
      distance = ∞
      pdf = 1 / light_count
      
    case 3 (point):
      θ = 2π * u.x
      φ = acos(1 - 2u.y)
      normal = (sin φ cos θ, sin φ sin θ, cos φ)  ← direction on sphere
      distance = length(point - origin)
      decay = base_intensity / distance^decay_rate
      
    case 4 (spot):
      θ = 2π * u.x
      cosθ_angle = mix(cos_outer, cos_inner, u.y)
      sinθ_angle = sqrt(1 - cosθ_angle²)
      point_on_cone = position + direction_vector * cone_point
      decay = base_intensity / distance^decay_rate


Data Flow (Complete Path)
=========================

1. IMPORT PHASE
   └─ importLights(scene, options)
      ├─ Loop each prim in scene
      ├─ Match USD type to LightType
      ├─ Read inputs (position, color, intensity, etc.)
      ├─ Apply world transform
      └─ Return SceneLight[]

2. VALIDATION PHASE
   └─ packAnalyticLights(lights)
      ├─ Filter out dome lights
      ├─ For each light:
      │  ├─ Validate position/direction (finite)
      │  ├─ Validate colors (>= 0)
      │  ├─ Validate intensity (>= 0)
      │  ├─ For point lights:
      │  │  └─ Validate decay_rate >= 0
      │  ├─ For spot lights:
      │  │  ├─ Normalize direction
      │  │  └─ Validate angles (finite)
      │  └─ Compute radiometric gain
      └─ Return packed Float32Array

3. GPU UPLOAD PHASE
   └─ GPU buffer creation
      ├─ Create GPUBuffer (storage buffer)
      ├─ writeBuffer(packed_data)
      └─ Bind to shader

4. RENDER PHASE (Path Tracer)
   └─ Render loop
      ├─ For each sample
      ├─ mx_sample_light() reads from buffer
      ├─ Compute contribution
      └─ Accumulate
      
5. RENDER PHASE (Forward Raster)
   └─ Choose dominant light
      ├─ Prefer DistantLight
      ├─ Fall back to first light
      └─ Evaluate single directional component


Configuration Examples
======================

POINT LIGHT - Warm Table Lamp:
{
  type: 'point',
  position: (2, 1, 0),
  color: (1.0, 0.95, 0.8),
  intensity: 200,
  decay_rate: 2.0
}
Effect: Warm white light fading with distance

SPOT LIGHT - Stage Spotlight:
{
  type: 'spot',
  position: (0, 10, 5),
  direction: (0, -1, 0),
  color: (1, 1, 1),
  intensity: 1000,
  decay_rate: 2.0,
  inner_angle: 15°,
  outer_angle: 30°
}
Effect: Bright cone with soft edges

DISTANT LIGHT - Outdoor Sun:
{
  type: 'distant',
  direction: (0.3, 0.5, 0.8).normalized(),
  color: (1, 0.95, 0.9),
  intensity: 1,
  exposure: 2
}
Effect: Parallel rays, no falloff, 4× brighter


Performance Characteristics
============================

Memory:
  - Per-light storage: 112 bytes (7 floats × 16-bit align)
  - Bandwidth: 1 light per 112 bytes
  - 1000 lights: 112 KB GPU buffer

Compute:
  - Light selection: O(1) binary search on u.z
  - Point light sampling: O(1)
  - Spot light sampling: O(1) + cone masking
  - Total per-sample: O(light_count) traversal

Clustering (Forward+):
  - Grid: 32×32×24 = 24,576 clusters (typical)
  - Per-cluster lights: typically 4-16 lights
  - Overhead: O(lights × clusters) preprocessing


Troubleshooting Guide
====================

Issue: Point light appears too dim
  → Check intensity value (try 100+)
  → Check exposure value (try 1 for 2× brighter)
  → Verify position is reasonable distance from objects

Issue: Spot light cone is elliptical/wrong
  → Ensure innerAngle < outerAngle
  → Check both angles are in [0°, 180°)
  → Verify direction vector is normalized

Issue: Path tracer crashes with lights
  → Validate all positions are finite (no NaN/Inf)
  → Check decay_rate >= 0 for point/spot
  → Verify cone angles are finite and positive

Issue: Forward raster doesn't show point/spot lights
  → Expected: current implementation uses dominant light
  → Forward+ support coming in Phase 2
  → Point/spot lights available in path tracer now


Future Roadmap
==============

Phase 1: Basic Support (✅ DONE)
  - Parse USD lights → SceneLight
  - Pack for GPU buffer
  - WGSL shader code

Phase 2: Forward+ Multi-Light (IN PROGRESS)
  - Light culling compute shader
  - Per-cluster light lists
  - Fragment shader light loops

Phase 3: Advanced Rendering (PLANNED)
  - Shadow mapping (point/spot cubemaps)
  - IES photometric profiles
  - Volumetric light effects
  - Light animation support

Phase 4: Optimization (FUTURE)
  - GPU-driven light management
  - Dynamic light batching
  - Importance sampling
  - Light tree structure
"""

# ASCII Architecture Diagram
architecture_diagram = r"""

┌─────────────────────────────────────────────────────────────────────────┐
│                    MaterialX Light Support System                        │
│                     materialx-webgpu-engine v0.0.0                      │
└─────────────────────────────────────────────────────────────────────────┘

INPUT LAYER
───────────
     USD Scene (.usda)
            │
            ├──────────────────┬──────────────────┬──────────────────┐
            │                  │                  │                  │
      PointLight          SpotLight         DistantLight          DomeLight
       prim tree           prim tree         prim tree             prim tree
            │                  │                  │                  │
            └────────────────────────────────────────────────────────┘
                            │
                  importLights()
                    (src/usd/)
                            │
                            ▼
                     SceneLight[]
            (point, spot, distant, dome, etc.)


PROCESSING LAYER
────────────────
            │
     ┌──────┴──────────┐
     │                 │
Path Tracer      Forward Raster
  Backend         Backend
     │                 │
     │         directionalLightFrom()
     │              +
     │         environmentFrom()
     │                 │
     ▼                 ▼
packAnalyticLights()  buildClusterGrid()
     │                 │
     │         assignLightsToClusters()
     │                 │
     ▼                 ▼


GPU LAYER (Path Tracer)
───────────────────────
  Float32Array Buffer
  ┌────────────────────────────────────────┐
  │ Light 0: [pos,type, col,area, ...]     │  28 floats
  ├────────────────────────────────────────┤
  │ Light 1: [pos,type, col,area, ...]     │  28 floats
  ├────────────────────────────────────────┤
  │ Light 2: [pos,type, col,area, ...]     │  28 floats
  └────────────────────────────────────────┘
           │
           ▼
  WGSL Shader (ANALYTIC_LIGHTS_WGSL)
  ┌────────────────────────────────────────┐
  │ @binding(9) analyticLights array<vec4f>│
  │ mx_sample_light()                      │
  │ mx_light_pdf()                         │
  │ mx_intersect_lights()                  │
  └────────────────────────────────────────┘
           │
           ▼
  Monte Carlo Path Tracer
  ┌────────────────────────────────────────┐
  │ Per-sample: select light, evaluate PDF  │
  │ Importance sampling based on light type │
  │ Accumulate radiance                     │
  └────────────────────────────────────────┘


GPU LAYER (Forward Raster)
──────────────────────────
  Cluster Grid Buffer
  ┌────────────────────────────────────────┐
  │ 32×32×24 = 24,576 clusters             │
  │ Per-cluster: light indices (stored)     │
  │ Global: directional + environment      │
  └────────────────────────────────────────┘
           │
           ▼
  Fragment Shader (ir-forward.ts)
  ┌────────────────────────────────────────┐
  │ Evaluate single dominant light          │
  │ Add environment IBL                     │
  │ [Future: Loop over cluster lights]      │
  └────────────────────────────────────────┘
           │
           ▼
  HDR Color Output


LIGHT TYPE HIERARCHY
────────────────────

        SceneLight
            │
     ┌──────┼──────────┬────────────┬──────────┐
     │      │          │            │          │
  rect   sphere    distant       point       spot
     │      │          │            │          │
  Type0  Type1       Type2        Type3      Type4
 (area)  (area)   (directional)  (punct.)   (punct.)


Maintained by: rvaquette
Last Updated: 2026-11-02
Status: Phase 1 Complete ✅
"""

print(architecture_diagram)
