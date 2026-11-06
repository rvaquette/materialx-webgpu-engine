# USD import: loader qualification (T003)

## Precompiled scenes (v1.0)

Export is an offline command, not a viewer UI action:

```powershell
npm run export:scene -- --entry scenes\pathtracer\volume_cube.usda --out scenes\compiled\volume_cube
```

Run it from the project directory with Node.js >=22 and Chrome or Edge installed.
Set `MX_CHROME` to the browser executable if automatic discovery does not find it;
`MX_CORE_DIR` and `MX_LIB_ROOT` have the same meaning as in the dev server.
The source must be a USD/USDA/USDC file inside the project. The output directory
must be absent or empty; existing exports are never overwritten.

The script starts its own loopback Vite server and isolated headless browser,
uses the ordinary USD/MaterialX/texture loaders, then exports the prepared scene
without opening the viewer, initializing WebGPU or rendering frames. Both helper
processes are closed afterwards. Browser-based loading preserves the same WASM
and image decoder behavior as the application. Export can take substantially
longer than loading: it builds any still-lazy BVHs and uses Zstandard level 22.
It does not modify the source USD/MaterialX files. A failed export exits nonzero
and does not publish `scene.json`; choose a fresh directory before retrying.

The output contains:

```text
scenes/my-scene-compiled/
  scene.json
  metadata/<sha256>.json.zst
  buffers/<sha256>.bin.zst
  shaders/<sha256>.wgsl.zst
  textures/<sha256>.bin.zst
```

`scene.json` identifies `materialx-compiled-scene`, version `1.0`, the engine
ABI, little-endian byte order, the metadata path, and every payload's path,
SHA-256, compressed size and uncompressed size. Paths are relative to the
manifest, not to the app or the original `.mtlx`. Metadata records typed-array
types, counts, maps, material bindings, UV/sampler/color-space settings, cameras
and lights. Payloads are content-addressed and byte-identical data is stored once.
Large authored numeric arrays and CPU BLAS/TLAS nodes also live in binary payloads
(float64 records retain JavaScript precision), rather than expanding into JSON.
Payload downloads/decompression use batches of up to four resources.
The manifest is written last; failed writes are reported, not marked successful.
The command requires a fresh directory to avoid mixing payloads from older exports.

The snapshot contains prepared vertex/index streams, prototype BLAS and instance
TLAS data, already-displaced geometry, the world-space path-tracing BVH and its
triangle permutation/UV/tangent streams, material records, material WGSL dispatch,
and both interactive/reference raster WGSL variants. Camera framing and canvas
resolution remain runtime choices. Sources/graphs and pre-displacement resources
needed for existing parameter editing are retained as engine-owned data, not
MaterialX WASM objects.

Material textures are collected after normal MaterialX path resolution. The
snapshot preserves the **decoded pixels**, their precision and color-space
metadata, including explicitly enumerated sparse UDIM tiles. Procedural graphs
are not baked. HDR environment pixels, SH and the importance-sampling CDF are
also saved. Compression is lossless; it cannot recover precision already lost
by the source decoder. This format does not add new source image decoders or
GPU texture formats: the current material upload path requires RGBA8, whereas
HDR environments use the existing floating-point path.

### Loading through the UI

There is no separate compiled-scene import dialog. Export under `scenes/`,
then restart `npm run dev`, or rebuild with `npm run build` for static hosting.
In the viewer's **Scene** drop-down, select **Compiled - compiled/volume_cube**
for the command above. All `scenes/**/scene.json` entries are discovered at
dev-server startup/build time, not by scanning a user's filesystem at runtime.
The local file/folder buttons import source glTF assets, not compiled packages.

A direct URL also works (without adding an entry to the drop-down):
`?entry=./scenes/compiled/volume_cube/scene.json&backend=pathtracing`.
To load an export made outside `scenes/`, first copy its entire directory there;
selecting only the manifest without its payload directories is not sufficient.
Static packaging copies the complete `scenes` tree, including custom compiled
directories and all their payloads. Serve the full directory over HTTP(S);
absolute local filesystem paths are not browser-fetchable assets.

Loading restores the snapshot without importing USD, reading `.mtlx`, initializing
MaterialX Core, preparing geometry, building BVHs or regenerating material WGSL.
GPU uploads, device-specific WebGPU shader/pipeline compilation and environment
GPU mipmap generation still happen. Existing material-parameter edits remain
available and explicitly invalidate the prepared snapshot, allowing the ordinary
rebuild path when needed. Replacing a whole material requires loading the
original USD scene; the compiled-scene UI disables this source-dependent action.

### Rendering a compiled scene from the command line

The capture script accepts the same manifest instead of a source USD:

```powershell
npm run build:shaderball
npm run test:shaderball -- --entry /scenes/compiled/volume_cube/scene.json --target local --server static --backends raster,pathtracing --res 512 --spp 64
```

For development, omit `--server static` to use Vite without a harness build.
The entry is a server URL under `/scenes/`, not an absolute filesystem path.
Keep the complete exported directory there. Both raster and path tracing use
the embedded resources, shaders, decoded images and BVH; the path tracer also
restores its prepared material dispatch and volume atlas. GPU compilation and
uploads still run. Captures and the report use the export directory's name
(nested directory names are joined with `__`), rather than the shared `scene.json`
filename. `--target mobile`, `--headed`, `--integrated`, `--resume` and the usual
resolution/sample options remain available.

`--materials` is rejected for compiled scenes: an offline snapshot cannot
replace materials from a source `.mtlx`. The lower-level harness also rejects
displacement-scale overrides and source BVH cache refresh/verification modes.
Its timings report `compiledSceneLoad`, not USD import/material lowering, and
its geometry-cache status is `bypass` because the BVH comes from the package.

Unknown format/ABI/buffer layouts, missing files, inconsistent lengths,
checksums and invalid packed traversal indices are errors; there is no silent
fallback to the source scene. The v1.0 limits are 512 MiB per uncompressed
payload, 64 MiB of metadata and 2 GiB total uncompressed payload data. Bump the
engine ABI when serialized engine structures or shader interfaces change, and
regenerate snapshots when incompatible with the current renderer.

## Converted GLSL-PathTracer scenes

The 45 local Pathtracer USDA files were audited against their `.scene` sources.
Use `node scripts/repair-pathtracer-materials.mjs <source-scene-directory>` for a
dry run, or append `--apply` to regenerate their material descriptions. This is
separate from `repair-pathtracer-usda.mjs`, which repairs geometry, lights and cameras.
Missing resources and unhandled material fields are errors.

Regeneration omits literal surface inputs equal to their installed MaterialX
NodeDef defaults, including inherited defaults. To simplify already corrected
documents, run `node scripts/simplify-pathtracer-materials.mjs --apply`
(omit `--apply` for a dry run). Set `MX_LIB_ROOT` to select the MaterialX libraries.
Version-specific defaults are respected: for example, `standard_surface` 1.0.1
defaults to base color 0.8, not the white default of 1.0.0. Connections, textures,
non-default values and inputs carrying additional attributes are retained.
Only the corrected `standard_surface` and `open_pbr_surface` inputs are simplified;
utility nodes and unsupported legacy volumes are left untouched.

Legacy Disney materials are mapped to **standard_surface**, not gltf_pbr:
this is an approximation of the original Disney BSDF using standard MaterialX
nodes. Thin-walled glass uses **open_pbr_surface**, whose thin-wall flag is
implemented by the engine. Existing authored MaterialX documents retain their
original types and material bindings, including the shader-ball glass/default
examples that previously became gray Disney placeholders.

The conversion retains linear color factors, the source texture gamma of 2.2,
linear metallic B/roughness G channels, tangent-space normal maps and the
source renderer's `openglnormalmap` Y-flip option (enabled by default).
Source constant GGX alpha is converted to MaterialX perceptual roughness with
a square root; packed roughness uses the source's squared-G convention.
Clearcoat gloss, specular/sheens tints, emission and alpha coverage are also mapped.
Absorbing media use equivalent Beer-Lambert extinction through transmission
color/depth. The original Disney sheen, GTR1 clearcoat and empirical subsurface
model are not reproduced exactly. This changes the appearance of existing
converted scenes intentionally; earlier bit-identical Hyperion baselines no
longer describe these newly authored materials.

**Outstanding cases:** scattering volumes in `substance_boy_volume`,
`tropical_island` (water) and `volume_cube` cannot be faithfully lowered by
the current surface compiler. Their previous material definitions are retained,
marked in XML and reported by the repair command rather than silently claiming
volume support. `jinx.usda` still has its legacy default-material placeholder:
its source relies entirely on embedded glTF material assignments, which this
named-material repair does not reconstruct. The source `staircase` WoodLamp
contains an orphan `0.1` line, ignored by its loader and reported during repair.
No height/bump texture fields were found in the named `.scene` materials;
normal maps must not be interpreted as height maps. Raster alpha blending,
subsurface and volume transport remain backend approximations.

## Bundled OpenPBR Shader Playground scenes

`scenes/OpenPBRShaderPlayground/playground_selection.usda` combines chairA, tube,
orangeJuice, meetMAT, paintSpill, masonJar, paintBrushes, paper and dresser in
their original positions. It sublayers the existing scene entries, preserving
materials and relative assets while composing the common lighting rig once.
The viewer lists it as **OpenPBR Shader Playground - Selection (9 groups)**.

`playground_selection_2.usda` combines chairB, mug, paintSpill_scrnRT, powerPlug,
outlet and the airplane's mainBody, plasticCaps and tape groups, also in their
original positions. The airplane parent is retained to preserve its transforms;
its pencils, cardboard, hotglue and lids branches are hidden. The standalone
tape scene is not included. The viewer lists this composition as
**OpenPBR Shader Playground - Selection 2 (8 groups)**.

The scene selector lists `scenes/OpenPBRShaderPlayground/*_grp/*_grp.usda`.
`npm run build` copies the entire `OpenPBRShaderPlayground` directory into
`dist/scenes`, preserving the relative paths of referenced USD geometry,
material layers and textures. Rebuild after adding or removing scenes, and
serve the complete `dist` directory rather than only its HTML and JavaScript.
These bundled scenes are separate from the development-only external playground.
Their 27 geometry references use `*_grp_geometry.usda` text layers rather than
the original binary `.usd` layers. These bundled scenes therefore load on plain
static servers without COOP/COEP, SharedArrayBuffer or browser OpenUSD WASM.
The original binaries are not included in the repository. Conversion used
OpenUSD Python bindings (`pxr.Sdf`) to export authored layers without flattening;
each text layer was checked against the original layer's USDA export before
removing the binary.
Geometry layers are not additional scene-selector entries.

MaterialX filename attributes escape UDIM placeholders as `&lt;UDIM&gt;`;
XML parsing restores `<UDIM>` for tile resolution without changing texture names.

UDIM images in bundled scenes are inventoried at build time from the texture
files under `scenes` (JPEG, PNG, TIFF, EXR and HDR extensions). Rebuild after
adding or removing tiles. Image references retain their escaped placeholders.
The raster and compute path tracer upload the decoded tiles as sparse 2D
texture arrays and bind a separate integer tile-to-layer index. Tile selection
uses `1001 + floor(U) + 10 * floor(V)`; V is flipped only within the selected
tile. A missing tile or out-of-range UV returns the MaterialX image's `default`,
not a repeated 1001 tile. Filtering clamps to each tile's edges, without
interpolating unrelated array layers. The CPU sampler uses the same mapping,
and displacement requires the requested tile to exist.

Tiles currently require matching dimensions and decoded RGBA8 pixels; their
declared sRGB/data interpretation is preserved. Invalid inventories, missing
files and device texture-size/array-layer limit violations are explicit errors.
Non-bundled assets require an explicit tile inventory via the `withUdimImages`
provider adapter; HTTP directory enumeration or guessed tile URL probing is
not used.

To validate actual GPU tile selection, start `npm run dev` and open
`tests/render/udim-device.harness.html`. It reads back seven samples from both
fragment and compute pipelines, covering horizontal/vertical tiles, local V
orientation, missing tiles, negative UVs and sRGB decoding.

## Direct local GLB/glTF scenes in the UI

The scene selector also lists all `.glb` and `.gltf` assets under
`scenes/pathtracer`, excluding subdirectories. Format extensions remain in their
labels to distinguish them from USDA variants. Selecting these entries fetches
the scene and its relative resources from the application server and uses the
same `gltf_pbr` MaterialX conversion as the local importer. Rebuild after adding
or removing assets to refresh the static catalog. Unsupported or missing assets
remain explicit loading errors, even when their filename is listed.

The UI exposes scene selection only, without local file or folder import buttons.
The underlying local importer still supports bundles with exactly one scene entry
and preserves directory paths. Missing or ambiguous resources fail explicitly;
local imports do not fall back to network downloads.

The importer generates an in-memory MaterialX document per material, using
`gltf_pbr`, and compiles it through the same graph path as USD materials.
Base color (linear factor plus sRGB texture), metallic (B channel), roughness
(G channel), clearcoat, transmission, IOR, specular, sheen, iridescence and dispersion
are mapped. Normal textures are connected through a `normalmap` node, read as
linear data and scaled using glTF normal strength. Emissive factors/textures and
strength are preserved. Alpha uses the base-color A channel and the glTF
OPAQUE/MASK/BLEND mode and cutoff. Texture factors are
applied in the shader, not baked into quantized pixels. Packed scalar channels
are extracted from the decoded image; scale, offset and wrap mode are retained.
Materials remain editable and replaceable in the existing material panel, in
both raster and path tracing. Mesh transforms, normals, mirrored winding and
material groups are preserved; shared materials are compiled once.

The engine's `gltf_pbr` implementation is not full glTF rendering conformance. Visible import
warnings report unsupported inputs: height/bump maps, separate clearcoat normals,
baked occlusion, vertex colors, alternate UV sets, texture rotation,
volume/attenuation and some material extensions. Unlit materials are approximated
as lit `gltf_pbr` materials. Mip filtering is approximated by the existing engine
sampler. glTF cameras and punctual lights currently produce warnings: the viewer
uses bounds-based perspective framing and its default environment instead.
Animations are not played; skinned, morphed and GPU-instanced meshes are rejected.

Generated documents and texture URLs are kept for material changes and device
recovery, then released when another scene successfully replaces the local scene.
The local importer is loaded on demand; adding this feature does not change the
shading of existing USD scenes.

## Local GLB, glTF and OBJ geometry from USD

The interactive viewer and USD image harness can load static geometry with
Three.js `GLTFLoader` (GLB/glTF) and `OBJLoader` (OBJ). Author the engine-specific
attributes on a `Mesh` prim, retaining normal USD material bindings:

```usda
def Mesh "Preview" {
    custom asset engine:geometry:file = @./ShaderBall.glb@
    custom string engine:geometry:object = "Preview_Mesh"
    rel material:binding = </World/Looks/OpenPBRMaterial>
}
```

For a JSON glTF asset, use the same attribute with a `.gltf` filename:

```usda
def Mesh "Model" {
    custom asset engine:geometry:file = @./model/model.gltf@
    rel material:binding = </World/Looks/OpenPBRMaterial>
}
```

External `.bin` paths are resolved relative to the glTF file and loaded through
the geometry reader. The glTF materials and textures are not loaded in this mode:
the USDA binding remains authoritative. This is an engine geometry attribute,
not a standard USD composition reference to a glTF layer.

`engine:geometry:object` optionally selects a uniquely named object and its
descendants. Without it, all triangle meshes in the default GLB/glTF scene or OBJ are
merged. Asset paths resolve relative to the authoring USDA layer, including
sublayers. Each asset is fetched/parsed once per scene load. GLB/glTF node/parent
transforms are baked into the selected geometry; USD transforms are then applied
normally. Normals are preserved. GLB/glTF UVs are converted from glTF's top-left
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

The installed browser OpenUSD runtime uses shared-memory workers, so binary USD
layers require `crossOriginIsolated` and `SharedArrayBuffer`. The server must send
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` over HTTPS or localhost.
Both `npm run dev` and `npm run preview` set these headers. For the built app,
run `npm run build`, then `npm run preview`, and open the preview URL.
Plain static servers (including Live Server without these headers) cannot load
binary USD layers; the loader reports this requirement before starting WASM.
Text-only USDA and glTF scenes do not require the OpenUSD runtime.

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
