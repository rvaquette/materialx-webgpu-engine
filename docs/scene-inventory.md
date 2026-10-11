# Scene and corpus inventory (T002)

Evidence-based inventory of the two local corpora the engine must render: the
OpenPBR USD reference scene and the MaterialX example material library. Node
coverage is detailed in [materialx-node-coverage.md](materialx-node-coverage.md).

- Generator: [tools/t002-inventory.mjs](../tools/t002-inventory.mjs) (uses the
  MaterialX Core WASM to parse every `.mtlx`).
- Machine-readable report: [docs/generated/t002-inventory.json](generated/t002-inventory.json).
- Qualified WASM APIs: [dependencies.md](dependencies.md).

## 1. USD reference scene

- Root: `D:\WebGL2\MaterialX\OpenPBRShaderPlayground\ShdrPlygrnd`
- Entry: `ShdrPlygrnd_OpenPBR.usda`
- Stage metadata: `defaultPrim = "World"`, `upAxis = "Y"`,
  `metersPerUnit = 0.01`, `timeCodesPerSecond = 30`, `startTimeCode = 0`,
  `endTimeCode = 100`. The scene is rendered statically (no animation per
  REQ-002); the time codes are metadata only.

### 1.1 Composition arcs

The entry stage exercises the main USD composition operators, which the loader
qualification (T003) must cover:

| Arc | Target |
| --- | --- |
| subLayer | `cameras/renderCams.usd` |
| subLayer | `materials/material_assignment.usda` |
| subLayer | `materials/materials_openPBR.usda` |
| subLayer | `assets/ShdrPlygrnd_Geo.usd` |
| payload | `lights/lightRig.usd` (under `/World/lightRig`) |

Material binding is split across a dedicated assignment layer plus `.mtlx`
material documents referenced from USD, so the loader must resolve USD material
bindings and MaterialX references.

### 1.2 Asset counts

| Area | Contents |
| --- | --- |
| `assets/` | 1 `.usd` (geometry) |
| `cameras/` | 1 `.usd` |
| `lights/` | 1 `.usd` (payload light rig) |
| `materials/` | 54 `.mtlx` + 42 `.usda` |
| `textures/` | 137 `.tif`, 74 `.png`, 6 `.exr`, 4 `.jpg` (221 total) |

Texture formats include `.tif` and `.exr`, confirming the HDR/16-bit decode
requirement (no silent 8-bit conversion, REQ per plan section 8) and the TIFF/EXR
dependency qualification tracked in T004.

## 2. MaterialX example corpus

- Root: `D:\WebGL2\MaterialX\MaterialX-rva\resources\Materials\Examples`
- 50 `.mtlx` documents across 6 shading-model families.
- 48 of 50 files declare at least one `surfacematerial`; the remaining 2 are USD
  `look`/material-assignment documents (no shading nodes):
  `StandardSurface/standard_surface_look_brass_tiled.mtlx` and
  `StandardSurface/standard_surface_look_wood_tiled.mtlx`.
- 62 texture references (`filename` inputs) across the corpus.

### 2.1 Families

| Family | Files | Materials | Root shader | Texture refs |
| --- | --- | --- | --- | --- |
| DisneyPrincipled | 5 | 5 | `disney_principled` | 0 |
| GltfPbr | 6 | 6 | `gltf_pbr` | 4 |
| OpenPbr | 10 | 10 | `open_pbr_surface` | 0 |
| SimpleHair | 1 | 1 | `simple_hair` (+ `surface`) | 0 |
| StandardSurface | 22 | 34 | `standard_surface` | 56 |
| UsdPreviewSurface | 6 | 6 | `UsdPreviewSurface` | 2 |

All six root shaders resolve to standard-library NodeDefs except `simple_hair`,
which is a corpus-local NodeDef (`ND_simple_hair_shader`, `nodegroup="pbr"`)
implemented by an inline nodegraph `NG_simple_hair_shader`.

### 2.2 Per-document summary

Format: materials / root shader category / declared node count / texture refs.

| Document | Mat | Shader | Nodes | Tex |
| --- | --- | --- | --- | --- |
| DisneyPrincipled/disney_principled_carpaint.mtlx | 1 | disney_principled | 2 | 0 |
| DisneyPrincipled/disney_principled_default.mtlx | 1 | disney_principled | 2 | 0 |
| DisneyPrincipled/disney_principled_glass.mtlx | 1 | disney_principled | 2 | 0 |
| DisneyPrincipled/disney_principled_gold.mtlx | 1 | disney_principled | 2 | 0 |
| DisneyPrincipled/disney_principled_plastic.mtlx | 1 | disney_principled | 2 | 0 |
| GltfPbr/gltf_pbr_boombox.mtlx | 1 | gltf_pbr | 7 | 4 |
| GltfPbr/gltf_pbr_carpaint.mtlx | 1 | gltf_pbr | 2 | 0 |
| GltfPbr/gltf_pbr_default.mtlx | 1 | gltf_pbr | 2 | 0 |
| GltfPbr/gltf_pbr_glass.mtlx | 1 | gltf_pbr | 2 | 0 |
| GltfPbr/gltf_pbr_gold.mtlx | 1 | gltf_pbr | 2 | 0 |
| GltfPbr/gltf_pbr_plastic.mtlx | 1 | gltf_pbr | 2 | 0 |
| OpenPbr/open_pbr_aluminum_brushed.mtlx | 1 | open_pbr_surface | 2 | 0 |
| OpenPbr/open_pbr_carpaint.mtlx | 1 | open_pbr_surface | 2 | 0 |
| OpenPbr/open_pbr_default.mtlx | 1 | open_pbr_surface | 2 | 0 |
| OpenPbr/open_pbr_glass.mtlx | 1 | open_pbr_surface | 2 | 0 |
| OpenPbr/open_pbr_honey.mtlx | 1 | open_pbr_surface | 2 | 0 |
| OpenPbr/open_pbr_ketchup.mtlx | 1 | open_pbr_surface | 2 | 0 |
| OpenPbr/open_pbr_lightbulb.mtlx | 1 | open_pbr_surface | 2 | 0 |
| OpenPbr/open_pbr_pearl.mtlx | 1 | open_pbr_surface | 2 | 0 |
| OpenPbr/open_pbr_soapbubble.mtlx | 1 | open_pbr_surface | 2 | 0 |
| OpenPbr/open_pbr_velvet.mtlx | 1 | open_pbr_surface | 2 | 0 |
| SimpleHair/simple_hair_default.mtlx | 1 | simple_hair, surface | 8 | 0 |
| StandardSurface/standard_surface_brass_tiled.mtlx | 1 | standard_surface | 4 | 2 |
| StandardSurface/standard_surface_brick_procedural.mtlx | 1 | standard_surface | 30 | 6 |
| StandardSurface/standard_surface_carpaint.mtlx | 1 | standard_surface | 2 | 0 |
| StandardSurface/standard_surface_chess_set.mtlx | 15 | standard_surface | 103 | 43 |
| StandardSurface/standard_surface_chrome.mtlx | 1 | standard_surface | 2 | 0 |
| StandardSurface/standard_surface_copper.mtlx | 1 | standard_surface | 2 | 0 |
| StandardSurface/standard_surface_default.mtlx | 1 | standard_surface | 2 | 0 |
| StandardSurface/standard_surface_glass.mtlx | 1 | standard_surface | 2 | 0 |
| StandardSurface/standard_surface_glass_tinted.mtlx | 1 | standard_surface | 2 | 0 |
| StandardSurface/standard_surface_gold.mtlx | 1 | standard_surface | 2 | 0 |
| StandardSurface/standard_surface_greysphere.mtlx | 1 | standard_surface | 2 | 0 |
| StandardSurface/standard_surface_greysphere_calibration.mtlx | 1 | standard_surface | 5 | 1 |
| StandardSurface/standard_surface_jade.mtlx | 1 | standard_surface | 2 | 0 |
| StandardSurface/standard_surface_look_brass_tiled.mtlx | 0 | - | 0 | 0 |
| StandardSurface/standard_surface_look_wood_tiled.mtlx | 0 | - | 0 | 0 |
| StandardSurface/standard_surface_marble_solid.mtlx | 1 | standard_surface | 14 | 0 |
| StandardSurface/standard_surface_metal_brushed.mtlx | 1 | standard_surface | 2 | 0 |
| StandardSurface/standard_surface_onyx_hextiled.mtlx | 1 | standard_surface | 6 | 2 |
| StandardSurface/standard_surface_plastic.mtlx | 1 | standard_surface | 2 | 0 |
| StandardSurface/standard_surface_thin_film.mtlx | 1 | standard_surface | 2 | 0 |
| StandardSurface/standard_surface_velvet.mtlx | 1 | standard_surface | 2 | 0 |
| StandardSurface/standard_surface_wood_tiled.mtlx | 1 | standard_surface | 4 | 2 |
| UsdPreviewSurface/usd_preview_surface_brass_tiled.mtlx | 1 | UsdPreviewSurface | 4 | 2 |
| UsdPreviewSurface/usd_preview_surface_carpaint.mtlx | 1 | UsdPreviewSurface | 2 | 0 |
| UsdPreviewSurface/usd_preview_surface_default.mtlx | 1 | UsdPreviewSurface | 2 | 0 |
| UsdPreviewSurface/usd_preview_surface_glass.mtlx | 1 | UsdPreviewSurface | 2 | 0 |
| UsdPreviewSurface/usd_preview_surface_gold.mtlx | 1 | UsdPreviewSurface | 2 | 0 |
| UsdPreviewSurface/usd_preview_surface_plastic.mtlx | 1 | UsdPreviewSurface | 2 | 0 |

`standard_surface_chess_set.mtlx` is the stress case: 15 materials, 103 declared
nodes, 43 texture references in a single document.

## 3. Follow-ups

- T003 consumes section 1.1 (subLayers, payload, material binding, `.mtlx`
  references) for loader qualification.
- T004 consumes section 1.2 (TIFF/EXR assets) for image-decode qualification.
- Node coverage (sections of this corpus) is enumerated in
  [materialx-node-coverage.md](materialx-node-coverage.md) and drives T014
  (per-node WGSL lowering) and T034 (per-node JS + WebGPU tests).
