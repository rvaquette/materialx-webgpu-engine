# Volumeshader Support: Remaining Implementation Tasks

## Phase 2: WGSL Emission (Next Priority)

### Task: Create Volume WGSL Emitter
**File**: `src/compiler/volume-wgsl.ts` (NEW)
**Effort**: ~2-3 hours
**Status**: PENDING

This file mirrors `surface-wgsl.ts` but generates WGSL code for VDF closures instead of layered BSDF stacks.

#### Requirements:
1. Import dependencies:
   - `lowerVolumeInputsToIr` from `volume-ir.ts`
   - `ResolvedVolume` from `volume-graph.ts`
   - `ResolvedGraph` from graph resolution
   - WGSL generation utilities from `wgsl.ts`

2. Define VDF closure structure constants (parallel to `LAYERED_CLOSURE_PRELUDE`):
   ```wgsl
   struct MxVolumeMedium {
     absorption: vec3f,
     scattering: vec3f,
     anisotropy: f32,
   }
   ```

3. Implement `emitVolumeWgsl()` function:
   - Input: `(graph: ResolvedGraph, volume: ResolvedVolume, emit: DiagnosticSink)`
   - Output: `VolumeWgslModule` (parallel to `LayeredSurfaceModule`)
   - Process:
     a. Call `lowerVolumeInputsToIr()` to get IR input expressions
     b. Emit helper functions for extinction/albedo/phase
     c. Generate `mx_volume_medium()` function:
        - Takes ivaryings as parameter
        - Returns `MxVolumeMedium` struct
        - Evaluates each input (absorption, scattering, anisotropy) from IR refs
     d. Return VDF closure reference from `getVdfClosureRef()`

4. Handle both direct and constructed VDF:
   - **Direct**: VDF node is connected → resolve and emit node's output
   - **Constructed**: Parameters only → build VDF from absorption/scattering/anisotropy

5. Diagnostic reporting:
   - Warn if expected VDF inputs are missing
   - Diagnose unsupported upstream nodes

#### Expected Output Structure:
```typescript
export interface VolumeWgslModule {
  /** WGSL source: struct + mx_volume_medium() function + helpers */
  source: string;
  /** Map from input name to emitted WGSL variable reference */
  inputVars: ReadonlyMap<string, string>;
}
```

#### Reference: Surface WGSL Pattern
- `surface-wgsl.ts` lines 140-280: LayeredClosure struct definition
- `surface-wgsl.ts` lines 450-600: mx_surface_layered() function generation
- Follow same diagnostic/state-machine approach

---

### Task: Update WGSL Emitter to Include Volume
**File**: `src/compiler/wgsl.ts` (MODIFIED)
**Effort**: ~1-2 hours
**Status**: PENDING

The central WGSL emitter needs to integrate volume shader code when present.

#### Changes:
1. Import `emitVolumeWgsl` from `volume-wgsl.ts`
2. In `emitWgsl()` function:
   - Check if `ShaderIr.outputs` contains volumeshader output
   - If yes: call `emitVolumeWgsl()` 
   - Include VolumeWgslModule source in final output
   - Wire VDF closure reference into main shader output

3. Module composition:
   ```wgsl
   // Volume module (if present)
   const MxVolumeMedium = struct { ... }
   fn mx_volume_medium(...) -> MxVolumeMedium { ... }
   
   // Surface module (if present)
   const MxBsdfLobe = struct { ... }
   fn mx_surface_layered(...) -> LayeredClosure { ... }
   
   // Main shader (routes to both if needed)
   @fragment fn materialX(...) -> vec4f { ... }
   ```

#### Key Consideration:
- Support both volume-only and surface+volume hybrid materials
- If both present: surface describes boundary, volume describes interior

---

### Task: Add Volume Module Type to IR
**File**: `src/compiler/ir.ts` (MODIFIED)
**Effort**: ~30 minutes
**Status**: PENDING

Parallel to existing `WgslModule` for surfaces, add optional volume module.

#### Changes:
1. Add to `ShaderIr` interface:
   ```typescript
   volumeModule?: VolumeWgslModule;
   ```

2. Define `VolumeWgslModule` type if not in volume-wgsl.ts

---

## Phase 3: Backend Integration

### Task: Path Tracer Volume Rendering
**File**: `src/render/pathtracing/compute.ts` or new `volumetracing.ts`
**Effort**: ~4-6 hours
**Status**: PENDING - Infrastructure exists, needs glue code

The path tracer already has complete volumetric transport in `media.ts`. Needs to integrate with resolved volumes.

#### Requirements:
1. Read `MaterialBuild.volume` when present
2. Extract absorption/scattering/anisotropy from resolved volume inputs
3. Generate megakernel variant code for VDF evaluation
4. Wire medium sampling into path tracing integrator

#### Reference:
- `src/render/pathtracing/media.ts` - Homogeneous medium interface
- `src/render/pathtracing/integrator.ts` - Path tracing entry point

---

### Task: Raster Volume Rendering Pass
**File**: `src/render/raster/renderer.ts` (MODIFIED)
**Effort**: ~4-6 hours
**Status**: PENDING - Infrastructure exists, needs glue code

The raster backend has ray march implementation in `volume.ts`. Needs to wire resolved volumes into render pass generation.

#### Requirements:
1. In `RendererResources`, detect materials with `build.volume`
2. Create "volume" render pass in render graph
3. Extract VolumeMaterial from resolved volume inputs:
   ```typescript
   {
     absorption: [a_r, a_g, a_b],
     scattering: [s_r, s_g, s_b],
     anisotropy: g
   }
   ```
4. Call `marchVolume()` reference implementation for each ray segment
5. Composite with surface rendering

#### Reference:
- `src/render/raster/volume.ts` - VolumeMaterial interface & marchVolume()
- `src/render/raster/renderer.ts` - Render pass orchestration

---

## Phase 4: Volumematerial Node Support

### Task: Update Material Detection for Volumematerials
**File**: `src/usd/materials.ts` (MODIFIED)
**Effort**: ~1-2 hours
**Status**: PENDING - Requires WASM Core support

The USD material loader needs to recognize both surfacematerial and volumematerial node types.

#### Requirements:
1. Extend `MtlxDocumentView` interface:
   ```typescript
   export interface MtlxDocumentView {
     getMaterialNode?(name: string): MtlxMaterialNode | null;
     getVolumeMaterialNode?(name: string): MtlxMaterialNode | null;  // NEW
     ...
   }
   ```

2. Update `findMaterialNode()` to search both surfacematerial and volumematerial
3. Update `materialGraphRoots()` to handle volumematerial types

#### Dependency:
- Requires MaterialX Core (WASM) to expose volumematerial node lookup
- May need enhancement to WASM bindings

---

## Phase 5: Test & Validation

### Task: Create Test Scenes
**Status**: PARTIAL - Test scenes created, need to render

Existing test scenes ready:
- `scenes/pathtracer/volumeshader_cube.mtlx` - Pure volumeshader
- `scenes/pathtracer/volumetric_cube_hybrid.mtlx` - Transmissive surface + volume
- `scenes/pathtracer/volumetric_cube_hybrid.usda` - Scene binding

#### Next:
1. Load volumetric_cube_hybrid.usda in harness
2. Verify scene loads without errors
3. Check render output shows volume effect

### Task: Runtime Validation Tests
**Status**: NOT STARTED
**Effort**: ~2-3 hours

Add tests for:
1. Volumeshader detection in graphs
2. Volume resolution from MaterialX documents  
3. IR lowering of volume inputs
4. Feature flag extraction with volume flag
5. Render pass generation includes 'volume' pass
6. WGSL emission generates valid volume code

#### Test File:
- `tests/render/volume-integration.test.ts` (NEW)
- Pattern: Follow existing surface shader tests

---

## Priority & Dependency Graph

```
Phase 2 (WGSL) - CRITICAL PATH
├─ volume-wgsl.ts (emitter)
├─ wgsl.ts (integration)
└─ ir.ts (module type) ← BLOCKS Phase 3

Phase 3 (Backends) - CAN PARALLELIZE  
├─ Path tracer integration ← uses WGSL module
└─ Raster integration ← uses WGSL module

Phase 4 (volumematerial support) - OPTIONAL FOR NOW
└─ Material detection → Only needed for pure volumeshaders
                        Hybrid surfaces work now

Phase 5 (Testing) - AFTER Phase 2
└─ End-to-end validation
```

---

## Implementation Checklist

- [ ] Phase 2a: Create `volume-wgsl.ts` (NEW)
  - [ ] VDF struct definition
  - [ ] `emitVolumeWgsl()` function
  - [ ] Input lowering & IR ref resolution
  - [ ] Direct vs. constructed VDF handling
  - [ ] Diagnostic reporting

- [ ] Phase 2b: Update `wgsl.ts` (MODIFIED)
  - [ ] Import volume emitter
  - [ ] Check for volumeshader in outputs
  - [ ] Compose volume module into result
  - [ ] Handle hybrid surface+volume

- [ ] Phase 2c: Update `ir.ts` (MODIFIED)
  - [ ] Add volumeModule field to ShaderIr
  - [ ] Type definition consistency

- [ ] Phase 3a: Path Tracer Integration (MODIFIED)
  - [ ] Detect build.volume in compilation
  - [ ] Extract medium parameters
  - [ ] Generate VDF evaluation code
  - [ ] Wire into integrator

- [ ] Phase 3b: Raster Integration (MODIFIED)
  - [ ] Detect build.volume in rendering
  - [ ] Generate volume render pass
  - [ ] Extract VolumeMaterial struct
  - [ ] Call marchVolume() for ray segments

- [ ] Phase 4: Volumematerial Support (MODIFIED)
  - [ ] Extend MtlxDocumentView interface
  - [ ] Update material detection
  - [ ] Add volumematerial lookup

- [ ] Phase 5: Testing
  - [ ] Create volumetric scenes
  - [ ] Write integration tests
  - [ ] Render validation
  - [ ] Performance profiling

---

## Success Criteria

✅ **Phase 1** (COMPLETE):
- Volumeshader detection in graphs
- Volume resolution infrastructure
- Compiler routing logic
- MaterialBuild carries volume data
- All TypeScript checks pass

✅ **Phase 2** (NEXT TARGET):
- WGSL code generates for volume shaders
- Features detected include volume flag
- Render pass includes 'volume' kind
- Shader variants key includes volume info

✅ **Phase 3** (FINAL):
- Path tracer renders volumetric effects
- Raster backend ray marches volumes
- Hybrid materials (surface + volume) work
- End-to-end visual validation passes

---

## Known Limitations & Future Work

### Current (By Design)
- Only homogeneous volumes supported
  - Heterogeneous densities deferred to Phase 2+
  - Would require 3D volume texture support
- No volumetric caustics
- Single-scattering approximation (path tracer does unbiased)

### Deferred (Phase 2+)
- VDF closure composition (mixing multiple VDFs)
- Nested volume boundaries (volume inside volume)
- Spectral volume rendering (per-wavelength extinction)
- Volume animation and temporal coherence

### Out of Scope
- OpenVDB support (requires GPU decoder)
- Volume mesh editing tools
- Real-time volumetric instancing

---

Generated: 2025-01-XX  
Author: MaterialX WebGPU Engine Contributors  
Status: ACTIVE DEVELOPMENT - Phase 2 Ready
