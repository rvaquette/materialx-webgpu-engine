# USD import: loader qualification (T003)

## Local GLB and OBJ geometry

The interactive viewer and USD image harness can load static geometry with
Three.js `GLTFLoader` (GLB) and `OBJLoader` (OBJ). Author the engine-specific
attributes on a `Mesh` prim, retaining normal USD material bindings:

```usda
def Mesh "Preview" {
    custom asset engine:geometry:file = @./ShaderBall.glb@
    custom string engine:geometry:object = "Preview_Mesh"
    rel material:binding = </World/Looks/OpenPBRMaterial>
}
```

`engine:geometry:object` optionally selects a uniquely named object and its
descendants. Without it, all triangle meshes in the default GLB scene or OBJ are
merged. Asset paths resolve relative to the authoring USDA layer, including
sublayers. Each asset is fetched/parsed once per scene load. GLB node/parent
transforms are baked into the selected geometry; USD transforms are then applied
normally. Normals are preserved. GLB UVs are converted from glTF's top-left
origin to USD/MaterialX's bottom-left origin (`v = 1 - v`) before tangent
generation and upload to either renderer; OBJ and inline USD UVs are unchanged.
Inline USD PreviewSurface textures keep those bottom-left UVs when converted to
MaterialX. The image compiler performs the single V flip needed for top-left
image storage, shared by raster and path tracing.
UVs outside the unit square retain their tiling. Negative-determinant transforms reverse
triangle winding. OBJ polygons are triangulated by Three.js.
Missing normals are generated per mesh. Merging objects with mixed UV
availability omits UVs and emits a warning; select individual objects to retain
their UVs.

Only geometry is imported: embedded glTF materials/textures and OBJ material
libraries do not override USD or runtime MaterialX assignments. Skinning and
morph targets and glTF GPU instancing are unsupported and rejected. A missing file, invalid format,
missing/ambiguous object or invalid mesh emits an error diagnostic and rejects
scene loading rather than silently dropping geometry. Inline USDA meshes remain
supported, including mixed inline/external scenes.

These are custom engine attributes, not native USD references or a USD glTF
file-format plugin. Other USD applications need the geometry converted to USD.

The 59 converted `scenes/pathtracer/*.usda` stages use this mesh bridge, USD
cameras and USD lights. `scripts/repair-pathtracer-usda.mjs` verifies deterministic
conversion from the local `.scene` sources; pass `--write` to regenerate the
geometry/camera/light scopes while retaining the existing MaterialX references.
Source FOV is horizontal; vertical aperture follows the source resolution.
Row-major source mesh matrices are transposed to USD's matrix layout. Named GLB
object assignments become separate bound Mesh prims. Finite lights also have
matching emissive meshes (quad or tessellated sphere) reachable by path-traced
BSDF rays in raster/legacy import. In the GPU path tracer, stages marked with
`pathtracer:sourceScene` instead use analytic rectangle/sphere intersections and
uniform single-light next-event sampling with finite shadow distances and MIS.
Their matching `${light.path}_Geometry` proxies are excluded from path-traced
geometry (but kept for raster). Distant lights use delta sampling. Unsupported
light shaping, non-uniform/sheared sphere transforms and degenerate lights are
rejected explicitly. Sphere sampling uses the full sphere surface, not the source
renderer's visible-hemisphere strategy; identical noise is not expected.
For these converted stages, `pathtracer:maxDepth` (integer 0..64) controls the
number of surface scattering events, roulette starts at depth 2, and an absent
dome is black rather than the ordinary USD preview environment.
`pathtracer:fov` on the camera preserves the source horizontal FOV at the target
aspect ratio. Interactive converted cameras use perspective projection.
Ordinary USD keeps its existing camera, preview lighting and transport defaults
(64 loop iterations, roulette at depth 3). These changes do not make the CPU
reference integrator an analytic-light renderer, or equate the two engines' BSDFs.
The original converted DisneyPrincipled materials are retained, including their
existing approximations of source MaterialX graphs.
The bedroom mesh `bedroom/Mesh019.obj` is extracted from the supplied local
`bedroom/Mesh019.7z` archive. Two source geometry assets remain absent:
`jinx.gltf` and `panther/panther.obj`. Their unresolved references are deliberately
preserved; these two stages will fail loading until the original assets are supplied.
The viewer and image harness request the adapter's supported `maxBufferSize`
and `maxStorageBufferBindingSize`, plus `maxStorageBuffersPerShaderStage`, rather than retaining the default 128 MiB
storage binding limit. Large scenes such as bedroom require this. Scene storage
allocations exceeding the device limits are rejected explicitly.
Depth-of-field aperture metadata and dome rotation are authored but are not
implemented by the current image renderer.
Other legacy `pathtracer:*` metadata does not configure unsupported source
features, and `engine:geometry:source` on an Xform is not a geometry-loading contract.

Path-traced camera rays unproject an interior clip depth, not the far plane.
This keeps directions finite in GPU f32 arithmetic even when a far/near ratio
causes the far plane's homogeneous `w` to round to zero.
Both shaderball stages in `scenes/standard-shader-ball` use these attributes;
the RVA stage shares `/World/Looks/OpenPBRMaterial` across its two meshes so
`test:shaderball --entry /scenes/standard-shader-ball/openpbr-rva-standard-shader-ball.usda`
applies each MaterialX override to both objects, locally or with `--target mobile`.

Dome environment and irradiance texture paths resolve relative to their authoring
USD layer (or the entry stage when no authoring layer is recorded). Layer URLs may
be absolute, root-relative or document-relative; relative layers are first resolved
against the browser document URL.

MaterialX filename inputs honor the nearest `fileprefix` on the input or its
ancestors (including the document and nodegraphs). The prefix is applied before
resolving a relative filename against the material directory or explicit texture
root. Absolute filenames remain unchanged. After resolution, prefixes are removed
from the in-memory document so MaterialX Core cannot apply them a second time.

Bound materials must compile before the viewer or image harness starts rendering.
An unresolved surface now fails loading explicitly instead of producing missing
raster geometry or a neutral white path-traced fallback.

The interactive scene loader bakes texture-fed MaterialX displacement once into
material-specific geometry shared by raster and path tracing. Heights are linear,
bilinearly sampled with repeat addressing and a midpoint of 0.5. Coincident
vertices (position tolerance 1e-5) share a displacement offset across UV and
hard-normal seams, avoiding cracks without merging the shading attributes.
Normals/tangents and acceleration bounds are rebuilt after displacement; changing
or removing an override starts from the original mesh. This uses the existing
mesh tessellation, not adaptive subdivision. Missing height maps or UVs fail
loading explicitly. The path tracer specializes its lobe dispatch to the union
of graph materials and constant-record fallbacks to reduce driver compilation
and runtime pressure without removing reachable material features.

## Interactive MaterialX parameters

The material chooser uses successive directory selectors (category, subfolders,
then material), mirroring the library tree instead of a flat filtered list.
Changing directories does not apply a material; choosing a material does.
Selecting an object restores the directory of its assigned material.
**Matériau d'origine** removes the override from any directory.

Under **Matériaux > Paramètres du matériau**, controls are discovered from the
loaded graph and its active NodeDefs, with their own types and defaults. No
material-name or parameter-name catalogue defines this UI. Active NodeDef
interfaces take priority over the compiler's family fallback tables.

The first editor supports numeric literal inputs: float sliders/numbers, integer
fields, boolean checkboxes, color3 pickers and vector components. The UI shows
only numeric literal inputs explicitly authored on the surface shader, without
an incoming connection. Implicit NodeDef defaults and internal graph-node inputs
are hidden. For example, `nodes/absval/absval.mtlx` exposes only `specular` and
`specular_roughness`, not its connected `base_color` or internal node constants.
The engine retains internal parameter metadata for uniform packing and rebuilds;
connected surface ports are not replaced with constants.
Interface-bound inputs are hidden even when their binding resolves to a literal;
implicit geometry-property inputs are not exposed as numeric defaults.
Filename, string and graph-connection editing are outside this first version. Numeric
color components are linear; color pickers convert to/from sRGB without clipping
the numeric HDR fields.

Each object has independent parameter state. Surface numeric edits use GPU
uniforms in both renderers when the emitted shader and render pass remain
unchanged. The engine compares generated code/pass classification rather than
maintaining a list of special parameter names. Changes that activate a lobe,
alter topology, or edit upstream expressions rebuild the necessary render set
without re-fetching the USD/MaterialX documents. Displacement edits start from
original mesh positions, rebuild sewn geometry and acceleration data, and are
debounced. Path-tracing accumulation and denoising are invalidated on every edit.
**Réinitialiser les paramètres** restores the values at material load, including
authored overrides rather than only library defaults. Parameter edits are
session-only; loading another scene or assigning another material reloads state,
and does not write the source `.mtlx` document.

HDR environments are uniformly normalized before uploading to `rgba16float`
and their original radiance is restored after texture sampling, including the
path tracer's importance-sampling PDF. This prevents bright HDR texels above
65504 from becoming infinite without clipping their energy. SH irradiance and
the luminance CDF remain in original radiance units. Image tests reject
non-finite path-tracing accumulation rather than saving a misleading black PNG.

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
bound. `geompropvalue` now supports the vector2 `st` / `UV0` UV stream in both
renderers; arbitrary named primvars and UDIM resolution remain outside this
coverage (T004 textures and T014/REQ-014 node coverage).

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

**Unified compose stage** (T049, `src/usd/compose.ts`): parts 1 and 3 are driven
from a single entry point. `composeStage()` builds a **crate-aware reader**
(`createCrateAwareReader`) that resolves every layer URI through the
`AssetResolver` (part / asset-root policy below), fetches its bytes, and
transparently flattens binary crates (`PXR-USDC`) to USDA before handing the text
to the USDA adapter. The adapter composes with `resolveArcs: true`, so subLayers,
**payloads** and non-MaterialX **references that point at crate prims** are
followed through the same reader and grafted into one composed SceneAsset
(payload/reference opinions are grafted *weaker* than local opinions). MaterialX
`.mtlx` references stay on the Core-WASM path (§1.2) and are never followed as
layers. The reader never exposes a crate to the text parser, and the resolver
rejects out-of-policy paths (e.g. `D:\` / local-absolute) with an explicit
diagnostic instead of silently remapping them (REQ-011/REQ-013).

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
  Node loader remains in `scripts/openusd-loader.ts`. The browser now uses
  `src/usd/browser-loader.ts`, loaded lazily on the first crate. Its local
  bindings/WASM are served under `openusd/` in development and packaged by
  `scripts/package-static.mjs`. Browser memory qualification remains a follow-up:
  the full simplified scene loads on PC but the mobile import currently fails
  (see [validation.md](validation.md#chargement-raster-du-playground-simplifie)).
- **Node coverage gap** (§1.3): vector2 `geompropvalue(st)` / `UV0` is lowered to
  interpolated UVs. Other named properties emit a warning and use the declared
  default. The simplified scene no longer references UDIM or TIFF; its 54
  material documents now compile without material diagnostics in the Core test.
- **Asset-root policy** (plan §8, T049 done): `textures/...` + `<UDIM>` paths and
  every composed layer require an explicit asset root served over HTTP(S) or via
  local selection; the browser cannot open `D:\` paths. The `AssetResolver` is
  now wired into the compose stage (`src/usd/compose.ts`) so layer resolution
  enforces the same policy as texture resolution: out-of-policy paths raise an
  explicit diagnostic and the layer is dropped, with no silent remapping.
- **Dangling inherits**: `</__class_mtl__/...>` resolves to nothing; the adapter
  must ignore it without dropping real opinions (REQ-013).
- **Binding strength / subdivision**: preserve `weakerThanDescendants` and
  `catmullClark` + `refinementLevel` for correct assignment and tessellation.

### Browser integration and explicit texture roots

`loadUsdScene()` now calls `composeStage()` with byte fetches and the lazy
OpenUSD loader, following both sublayers and payload/reference arcs. A failed
layer rejects the scene load instead of presenting an incomplete stage as a
successful load. HTTP origins are retained when composing relative layer paths.
The compose reader exports the crate's **authored root layer**, not a flattened
stage, so paths such as `../textures/env.exr` are not rewritten into the temporary
WASM filesystem. The standalone `flattenCrate()`/`importCrate()` APIs retain
their original stage-flattening default.

MaterialX references record their authoring layer. Their XML is fetched relative
to that layer; texture filenames normally resolve relative to that XML document.
`SceneLoadOptions.textureRoot` explicitly selects a different root for
scene-authored MaterialX textures. This is not a search/fallback: an unavailable
asset raises a diagnostic. Runtime material overrides keep their own document
directory rather than inheriting the scene root.

The local-only catalog entry **OpenPBR Shader Playground (local)** maps to
`playground/ShdrPlygrnd_OpenPBR.usda` with `playground/` as texture root. The Vite
server serves the external directory configured by `MX_PLAYGROUND_ROOT`
(default: the local source directory above), without copying it into the repo.
It is deliberately absent from production builds, which do not include the
external scene.

The browser bridge preserves indexed normals and indexed `st`. Dome EXR images
are decoded through the installed Three.js EXRLoader as float RGB, without LDR
conversion, and resolved relative to their authoring light layer. This does not
add TIFF/EXR support for arbitrary material textures or qualify subdivision and
all MaterialX graph features.

MaterialX libraries preserve authored connections when a shader node has the
same name as a library NodeDef (for example `ND_colorcorrect_color3`): the
in-memory shader node is renamed uniquely and its downstream ports are rewired
before importing definitions. Source files are unchanged. Importing definitions
without this step skips the colliding NodeDef; using a separate data library
alone can instead shadow the connected node in Core name lookup.

Exporter `image` signatures with vector2 `uvtiling`, `uvoffset`, `uv_scale` and
`uv_offset` are declared as inherited standard-library signatures. Their UV
mapping is `(uv * uvtiling - uvoffset) * uv_scale + uv_offset`, followed by the
existing image-space V flip. Unknown inputs still produce unresolved-NodeDef
diagnostics. Cameras and lights carrying primvars are not mesh prototypes.

## 5. Evidence log

- Entry stage, `materials_openPBR.usda`, `floor.usda`, `masonJar.usda`,
  `material_assignment.usda` read directly (constructs in §1).
- Crate magic `PXR-USDC` confirmed via first-8-bytes read on the three `.usd`
  payloads (§1.1).
- `.mtlx` existence and node content confirmed (`floor.mtlx`: `geompropvalue`,
  `image` with `<UDIM>`, `extract`), establishing the mapping in §1.2 and the gap
  in §1.3.
