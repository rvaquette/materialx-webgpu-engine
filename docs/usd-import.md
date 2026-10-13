# USD import: loader qualification (T003)

Evidence-based comparison of USD import strategies for the target scene, focused
on the six blocking criteria: **sublayers, references, inherits, payloads,
bindings, and `.mtlx` references**. Conclusion: no off-the-shelf JS loader covers
the corpus; adopt a **decoupled adapter** (custom USDA composition + MaterialX
Core WASM for materials + a qualified USDC crate reader for binary geometry).

- Target scene: `D:\WebGL2\MaterialX\OpenPBRShaderPlayground\ShdrPlygrnd\ShdrPlygrnd_OpenPBR.usda`
- Scene/corpus inventory: [scene-inventory.md](scene-inventory.md).
- MaterialX WASM qualification: [dependencies.md](dependencies.md).

## 1. What the scene actually uses (measured)

Read directly from the scene files (not assumed):

| Construct | Evidence |
| --- | --- |
| **subLayers** (2 levels) | Entry stage subLayers `cameras/renderCams.usd`, `materials/material_assignment.usda`, `materials/materials_openPBR.usda`, `assets/ShdrPlygrnd_Geo.usd`; `materials_openPBR.usda` itself subLayers 40 per-object `.usda` files. |
| **payload** | `/World/lightRig` has `prepend payload = @./lights/lightRig.usd@`. |
| **references to `.mtlx`** | Per-object materials use `prepend references = @./floor.mtlx@</MaterialX/Materials/floor>` — an external `.mtlx` layer referenced at a specific prim path. |
| **inherits** | `prepend inherits = </__class_mtl__/floor>` on every `def Material`. No `__class_mtl__` classes are defined in the composed layers (0 class defs found) → list-edited inherits that must resolve to nothing without error. |
| **over opinions** | Material and geometry prims are composed via `over "World"` / `over "Looks"` / `over "<geo>"` across layers. |
| **bindings** | `apiSchemas = ["MaterialBindingAPI"]` + `rel material:binding = </World/Looks/floor>`, several with `bindMaterialAs = "weakerThanDescendants"`. |
| **geometry metadata** | `subdivisionScheme = "catmullClark"`, `refinementLevel`, `refinementEnableOverride`, full `xformOpOrder` including `translate:pivot` and `!invert!xformOp:translate:pivot`. |

### 1.1 File formats (decisive)

| Layer | Format | Size |
| --- | --- | --- |
| `ShdrPlygrnd_OpenPBR.usda`, `material_assignment.usda`, `materials_openPBR.usda`, 40 per-object materials | **`.usda` text** | 0.4K–91.5K |
| `assets/ShdrPlygrnd_Geo.usd` | **binary crate** (`PXR-USDC`) | **57.5 MB** |
| `cameras/renderCams.usd` | binary crate (`PXR-USDC`) | 2.5K |
| `lights/lightRig.usd` | binary crate (`PXR-USDC`) | 2.8K |

Composition and materials are **text**; geometry/cameras/lights are **binary
crate**. These need different machinery, which drives the decoupled design.

### 1.2 The `.mtlx` reference mapping

`references = @./floor.mtlx@</MaterialX/Materials/floor>` targets a prim path
inside the `.mtlx` file. Under the OpenUSD `usdMtlx` file-format plugin a
MaterialX document is exposed as USD prims at `/MaterialX/Materials/<name>`
(and `/MaterialX/Shaders/...`). Confirmed: `floor.mtlx` contains the material
`floor` built from `image`/`extract`/`geompropvalue` nodes. So the reference
prim path maps **deterministically**: `/MaterialX/Materials/<name>` ⇒ the
MaterialX `surfacematerial` element named `<name>`, which the Core WASM already
parses (T001). USD composition and MaterialX parsing can therefore be
**decoupled**.

### 1.3 Coverage gap surfaced by the real scene

The scene `.mtlx` files use nodes **not present** in the `Materials/Examples`
corpus inventoried in T002, notably **`geompropvalue`** (named-primvar lookup)
and **`<UDIM>` tiled textures**. The 57 WGSL leaves from
[materialx-node-coverage.md](materialx-node-coverage.md) are therefore a lower
bound; `geompropvalue` and UDIM resolution must be added for the target scene
(feeds T004 textures and T014/REQ-014 node coverage).

## 2. Loader comparison

Rated against the six blocking criteria plus crate (binary `.usd`) support.

| Loader | subLayers | references | inherits | payloads | bindings | `.mtlx` refs | crate `.usdc` | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Three.js `USDZLoader`** | No | No | No | No | UsdPreviewSurface only | No | Flattened crate inside USDZ only | **Reject** — flat-crate AR reader, no composition, no MaterialX. |
| **tinyusdz (wasm)** | Partial | Partial | Partial | Partial | Read OK | **Immature** | **Fails** | **Dropped** — cannot reconstruct the reference crate (OOM, then indexed-normal / `elementSize 8196` parse failures) in any tested version (0.9.1, 0.9.10). |
| **OpenUSD (wasm) + `usdMtlx`** | Yes | Yes | Yes | Yes | Yes | **Yes** (plugin) | **Yes** | **Chosen crate reader** — qualified end-to-end against the reference crate (57 MB, 0 composition errors, meshes/indexed normals/UV/8 cameras/6 lights). Used as a data extractor only (see §3). |
| **Custom USDA adapter + MaterialX Core WASM** | Yes (scope of corpus) | Yes (to `.mtlx` prim path) | Yes (tolerant) | Yes | Yes (+ strength) | **Yes** (via Core WASM mapping §1.2) | **No** (text only) | **Chosen** for composition + materials; pair with a crate reader for binary geometry. |

Notes:
- Three.js `USDZLoader` parses a single flattened layer (USDZ AR QuickLook). It
  implements none of the composition arcs the corpus relies on and has no
  MaterialX path. Since `.mtlx` resolution is the stated blocking criterion
  (plan §8), it is rejected.
- OpenUSD-wasm is the only turnkey option that resolves everything, but plan §8
  warns "compiling OpenUSD is not enough" — `usdMtlx` must be built in and the
  resolver must find assets over HTTP. The binary and operational cost is high.

## 3. Decision

Adopt a **decoupled, three-part import pipeline**:

1. **Custom USDA composition adapter** (TypeScript, `src/usd/importer.ts`) for the
   text layers: resolve subLayers, overs, references, inherits (tolerant of
   dangling `__class_mtl__`), payloads, and `material:binding`
   (incl. `bindMaterialAs` strength); preserve `xformOpOrder`,
   `subdivisionScheme`/refinement, and primvars into the renderer-neutral
   SceneAsset.
2. **MaterialX Core WASM** (already qualified, T001) for materials: each
   `references = @file.mtlx@</MaterialX/Materials/name>` is resolved by parsing
   `file.mtlx` and selecting the `surfacematerial` named `name` (§1.2). USD never
   needs to understand MaterialX internals.
3. **Qualified USDC crate reader** as a **data extractor only** for the binary
   `.usd` geometry/camera/light payloads — **OpenUSD-wasm is the sole reader**
   (`@needle-tools/usd`, see [dependencies.md](dependencies.md)); tinyusdz-wasm
   was dropped after failing to read the reference crate. The reader flattens the
   crate to USDA via `stage.ExportToString()` and pipes that text through the
   custom USDA adapter (part 1), so composition/camera/light/material logic is
   reused; it supplies mesh attributes/primvars/xforms/camera/light params and
   does **not** drive composition or materials itself.

**Fallback:** if the custom adapter meets an unsupported corpus construct, fall
back to **OpenUSD-wasm + `usdMtlx`** as a full-composition oracle for that case
and to cross-validate the adapter's output.

This matches the plan architecture (USD composition → SceneAsset, kept separate
from the MaterialX document → WASM path), REQ-003 (reuse the MaterialX WASM and a
crate library rather than rewriting them), and REQ-013 (explicit diagnostics; no
silent path repair).

## 4. Risks and follow-ups

- **Crate reader qualification** (T048, done): OpenUSD-wasm reads the 57.5 MB
  `ShdrPlygrnd_Geo.usd` (meshes, indexed normals, primvars incl. `st`, subdivision
  tags) with 0 composition errors; tinyusdz-wasm failed and was dropped. The
  current loader (`scripts/openusd-loader.ts`) is Node-only; a browser-side loader
  and a mesh->RawMesh bridge within the browser memory budget (REQ-012) remain
  follow-ups.
- **Node coverage gap** (§1.3): add `geompropvalue` and `<UDIM>` handling to
  T014/REQ-014 and the texture system (T004); update
  [materialx-node-coverage.md](materialx-node-coverage.md).
- **Asset-root policy** (plan §8): `textures/...` + `<UDIM>` paths require an
  explicit asset root served over HTTP(S) or via local selection; the browser
  cannot open `D:\` paths. No silent remapping.
- **Dangling inherits**: `</__class_mtl__/...>` resolves to nothing; the adapter
  must ignore it without dropping real opinions (REQ-013).
- **Binding strength / subdivision**: preserve `weakerThanDescendants` and
  `catmullClark` + `refinementLevel` for correct assignment and tessellation.

## 5. Evidence log

- Entry stage, `materials_openPBR.usda`, `floor.usda`, `masonJar.usda`,
  `material_assignment.usda` read directly (constructs in §1).
- Crate magic `PXR-USDC` confirmed via first-8-bytes read on the three `.usd`
  payloads (§1.1).
- `.mtlx` existence and node content confirmed (`floor.mtlx`: `geompropvalue`,
  `image` with `<UDIM>`, `extract`), establishing the mapping in §1.2 and the gap
  in §1.3.
