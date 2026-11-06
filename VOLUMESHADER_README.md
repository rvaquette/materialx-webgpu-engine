# Support des volumes MaterialX

## Statut actuel

- `anisotropic_vdf` : absorption/scattering `vector3`, anisotropie dans (-1, 1).
- `volume` de type `volumeshader`, seul ou avec une surface.
- `uniform_edf` connecte au volume : emission RGB par unite de distance monde,
  y compris lorsque l'extinction est nulle.
- Path tracer CPU/GPU : transport RGB par delta tracking pondere pour les
  milieux explicites. Les anciennes voies verre/SSS restent disponibles.
- Raster GPU : integration Beer-Lambert, emission et diffusion simple avec
  ombres, sur les frontieres reelles du maillage, puis composition en HDR avant
  le tonemapping. Les frontieres des volumes purs ne sont pas dessinees opaques.
- Champs proceduraux : echantillonnage en coordonnees monde sur une grille
  32 x 32 x 32 par materiau, interpolation trilineaire commune aux deux backends,
  majorant calculé sur le champ reconstruit. Les changements des parametres
  d'un materiau surface + volume reconstruisent aussi son champ.

Les anciens carres blancs uniformes etaient des scenes sans geometrie :
ils ne prouvaient pas le fonctionnement des volumes.

## Scenes de verification

Avec le serveur statique servant `dist` :

1. Raster homogene :
   `?entry=./scenes/pathtracer/volume_cube.usda&backend=raster&res=512`
2. Heterogene, bandes de densite spatiale :
   `?entry=./scenes/pathtracer/volume_heterogeneous.usda&backend=pathtracing&res=512`
3. Emission, sphere sans luminaire :
   `?entry=./scenes/pathtracer/volume_emission.usda&backend=pathtracing&res=512`

Les deux nouvelles scenes sont aussi utilisables avec `backend=raster`.
Les geometries sont des `Mesh`/OBJ, avec de vraies references MaterialX.

## Limites explicites

- Maillages fermes et correctement orientes ; pas de pile de milieux imbriques.
- Raster : diffusion simple, sans trajet refracte pour le verre + volume ni
  diffusion multiple. 64 pas par segment camera, 12 pour l'attenuation lumineuse.
- Le champ rendu est la grille reconstruite, pas le procede continu exact :
  les details plus fins que la grille peuvent etre perdus.
- Seul `uniform_edf` est accepte ; le constructeur demande encore un VDF
  (qui peut avoir une absorption et une diffusion nulles).
- Images volumetriques/3D non prises en charge ; les textures du volume et les
  operations sans interpreteur CPU sont refusees, sans remplacement neutre.
- Les espaces autres que les coordonnees monde et les primvars par instance
  ne sont pas une representation volumetrique prise en charge.
- Le parcours GPU borne les segments au domaine fini et utilise un seuil
  d'intersection reduit apres une collision, sans plafond silencieux de collisions.

## Historique (obsolete, conserve pour contexte)

Les sections suivantes decrivent la premiere architecture, pas le statut actuel.

> **Status**: ✅ Phase 1 Complete - Architectural foundation ready for rendering

This directory contains the implementation of volumeshader (volumetric rendering) support for the MaterialX WebGPU engine.

## Quick Summary

The engine can now detect, compile, and prepare volumetric materials from MaterialX documents. The compilation pipeline routes volumeshaders through a dedicated path parallel to surface shaders, enabling participating media rendering in both the path tracer and raster backends.

**Original Question** (French): "Est-ce que materialx est capable de gérer des shaders volume?"  
**Answer**: ✅ **Yes!** Volumeshader support is now implemented in the compiler pipeline.

## Documentation

Start with these files in order:

1. **[VOLUMESHADER_RECAP_FR.md](./VOLUMESHADER_RECAP_FR.md)** (French, 10KB)
   - Complete overview in the original user's language
   - Architecture summary
   - Status and next steps

2. **[VOLUMESHADER_IMPLEMENTATION_SUMMARY.md](./VOLUMESHADER_IMPLEMENTATION_SUMMARY.md)** (English, 12KB)
   - Detailed architecture documentation
   - How the system works
   - Technical deep dive

3. **[VOLUMESHADER_CHANGES.md](./VOLUMESHADER_CHANGES.md)** (English, 9KB)
   - Visual summary of all modifications
   - File-by-file breakdown
   - Pipeline architecture diagrams

4. **[VOLUMESHADER_TASKS.md](./VOLUMESHADER_TASKS.md)** (English, 10KB)
   - Detailed task breakdown for remaining work
   - Phase 2, 3, 4 implementation plans
   - Success criteria and dependencies

5. **[VOLUME_SHADER_ANALYSIS.md](./VOLUME_SHADER_ANALYSIS.md)** (English, 6KB)
   - Original root cause analysis
   - Problem statement
   - Solution options evaluated

## Key Files Changed

### Core Implementation (NEW)
- `src/materialx/volume-graph.ts` - Volumeshader terminal detection and resolution
- `src/compiler/volume-ir.ts` - IR lowering for volumeshader inputs

### Integration (MODIFIED)
- `src/render/graph-material-compiler.ts` - Compiler routing logic
- `src/render/scene-resources.ts` - MaterialBuild interface extended

### Test Scenes (NEW)
- `scenes/pathtracer/volumetric_cube_hybrid.mtlx` - Example material
- `scenes/pathtracer/volumetric_cube_hybrid.usda` - USD scene binding

## Architecture Overview

```
MaterialX Document
    ↓
Detect volumeshader terminal → hasVolumeTerminal()
    ↓
Resolve VDF connections → resolveVolume()
    ↓
Lower inputs to IR → lowerVolumeInputsToIr()
    ↓
Generate neutral IR → neutralVolumeIr()
    ↓
Extract features → extractFeatures()
    ├─ Detect VDF closures
    ├─ Set volume flag
    └─ Add 'volume' render pass
    ↓
MaterialBuild with .volume field
    ↓
Path Tracer/Raster backends (ready for WGSL)
```

## Current Status

### ✅ Phase 1: Architecture (COMPLETE)
- [x] Volumeshader terminal detection
- [x] VDF graph resolution
- [x] IR expression lowering
- [x] Compiler integration
- [x] MaterialBuild contract updated
- [x] Feature detection working
- [x] All TypeScript checks pass
- [x] Compilation successful

### ⏳ Phase 2: WGSL Emission (READY)
- [ ] Create `volume-wgsl.ts`
- [ ] Emit shader code for VDF closures
- [ ] Integrate with `wgsl.ts`

**Effort**: ~4-5 hours  
**Blocker**: None - all infrastructure ready

### ⏳ Phase 3: Backend Integration (READY)
- [ ] Path tracer volumetric transport
- [ ] Raster volume ray marching pass

**Effort**: ~6-8 hours  
**Blocker**: Phase 2 must complete first

### ⏳ Phase 4: volumematerial Support (OPTIONAL)
- [ ] WASM Core enhancement for volumematerial nodes
- [ ] Material detection improvements

**Effort**: ~2-3 hours  
**Blocker**: None - Phase 1 works with hybrid materials

## How to Use

### View Volumeshader Support Status
```bash
npm run build  # Compiles successfully ✅
```

### Test Compilation
```bash
# The compiler now detects and routes volumeshaders
# Check console for volumeshader detection logs
# MaterialBuild.volume field will be populated
```

### Test Scenes
```
scenes/pathtracer/
├── volumeshader_cube.mtlx       # Pure volumeshader example
├── volumetric_cube_hybrid.mtlx   # Transmissive surface + volume
└── volumetric_cube_hybrid.usda   # USD scene with material binding
```

## Technical Details

### VDF vs BSDF
- **BSDF**: Describes light scattering at surface boundaries
- **VDF**: Describes light scattering within volumetric media

### Parameters
Each volumeshader can specify:
- **absorption**: How much light is absorbed (per channel)
- **scattering**: How much light is scattered (per channel)
- **anisotropy**: Phase function directionality (-1 to 1)

### Integration
The system automatically:
- Detects volumeshader vs surfaceshader terminals
- Routes to appropriate compiler pipeline
- Preserves the complete MaterialX graph for backend access
- Maintains backward compatibility with existing materials

## Compilation Verification

```bash
$ npm run build
  ✓ tsc --noEmit      (TypeScript: 0 errors)
  ✓ vite build        (Bundling: success)
  ✓ vite plugin       (Static packaging: success)

Build Time: ~7.1 seconds
Bundle Size: ~2.7 MB (gzipped)
Status: ✅ SUCCESS
```

## Next Steps

For developers continuing this work:

1. **Read [VOLUMESHADER_TASKS.md](./VOLUMESHADER_TASKS.md)** for detailed implementation guide
2. **Create `src/compiler/volume-wgsl.ts`** following the `surface-wgsl.ts` pattern
3. **Implement backend integration** in path tracer and raster renderers
4. **Add tests** in `tests/render/volume-integration.test.ts`
5. **Validate rendering** with volumetric test scenes

## References

- [MaterialX Specification](https://materialx.org/documents/spec/MaterialX.v1.39.html)
- Path Tracer volumetric code: `src/render/pathtracing/media.ts`
- Raster volumetric code: `src/render/raster/volume.ts`
- Surface shader example: `src/materialx/surface-graph.ts`

## Questions?

- **Architecture decisions**: See VOLUMESHADER_IMPLEMENTATION_SUMMARY.md
- **Remaining work**: See VOLUMESHADER_TASKS.md  
- **Changes made**: See VOLUMESHADER_CHANGES.md
- **Root cause analysis**: See VOLUME_SHADER_ANALYSIS.md

---

**Summary**: The MaterialX WebGPU engine now has complete architectural support for volumeshaders. The compiler detects and routes volumetric materials through a dedicated pipeline. The rendering backends already have volumetric infrastructure. WGSL code generation (Phase 2) is the next step to enable full rendering.

**Commit**: `dc5eb9e` - feat: Add volumeshader compilation support  
**Status**: Ready for Phase 2 implementation
