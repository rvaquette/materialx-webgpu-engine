# MaterialX WGSL Compilation Audit

Target: local
Complete: true
Files: 827/827

Compiled: 817; incomplete: 10; failed: 0; skipped: 0.

Compilation only: textures are not decoded, pixels and physical correctness are not tested.

## Files Requiring Attention

### scenes/mtlx-library/nodes/bump/bump.mtlx

Status: incomplete

- warning: Upstream node 'bump' (NG_bump/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/hextilednormalmap/hextilednormalmap.mtlx

Status: incomplete

- warning: NodeDef 'ND_hextilednormalmap_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'hextilednormalmap' (NG_hextilednormalmap/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/ramp/ramp.mtlx

Status: incomplete

- warning: Upstream node 'ramp' (NG_ramp_test/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/ramp_gradient/ramp_gradient.mtlx

Status: incomplete

- warning: Upstream node 'ramp_gradient' (NG_ramp_gradient_test/grad3) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/gltf_pbr/heighttonormal_normal_input/heighttonormal_normal_input.mtlx

Status: incomplete

- warning: NodeDef 'ND_heighttonormal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'heighttonormal' (NG_heighttonormal_normal_input/height_to_normal) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/open_pbr_surface/heighttonormal_normal_input/heighttonormal_normal_input.mtlx

Status: incomplete

- warning: NodeDef 'ND_heighttonormal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'heighttonormal' (NG_heighttonormal_normal_input/height_to_normal) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/standard_surface/graph_normal_from_height/graph_normal_from_height.mtlx

Status: incomplete

- warning: NodeDef 'ND_heighttonormal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'heighttonormal' (height_to_normal_example/height_to_normal) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/standard_surface/heighttonormal_normal_input/heighttonormal_normal_input.mtlx

Status: incomplete

- warning: NodeDef 'ND_heighttonormal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'heighttonormal' (height_to_normal_normal/height_to_normal) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/standard_surface/ramp_multicolor/ramp_multicolor.mtlx

Status: incomplete

- warning: Upstream node 'ramp' (NG_ramp_multicolor_test/multicolor_ramp) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/standard_surface/showcase_graph_pbr_helpers/showcase_graph_pbr_helpers.mtlx

Status: incomplete

- warning: Unresolved NodeDef for node 'viewdirection' (NG_pbr_helper_nodes/view_ws).
- warning: Unresolved NodeDef for node 'luminance' (NG_pbr_helper_nodes/ext_luma).
- warning: Unresolved NodeDef for node 'luminance' (NG_pbr_helper_nodes/ior_luma).
- warning: Input 'standard_surface.normal' is driven by unsupported node 'bump' (NG_pbr_helper_nodes/bump_n); its contribution would be lost (REQ-013).
- warning: Upstream node 'bump' (NG_pbr_helper_nodes/bump_n) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

