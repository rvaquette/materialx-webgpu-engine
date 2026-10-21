# MaterialX WGSL Compilation Audit

Target: mobile
Complete: true
Files: 827/827

Compiled: 454; incomplete: 310; failed: 63; skipped: 0.

Compilation only: textures are not decoded, pixels and physical correctness are not tested.

## Files Requiring Attention

### scenes/mtlx-library/nodes/acos/acos.mtlx

Status: incomplete

- warning: NodeDef 'ND_acos_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'acos' (NG_acos/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/acos_degenerate_out_of_domain/acos_degenerate_out_of_domain.mtlx

Status: incomplete

- warning: NodeDef 'ND_acos_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'acos' (NG_acos_degenerate_out_of_domain/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/acos_degenerate_out_of_domain_vector4/acos_degenerate_out_of_domain_vector4.mtlx

Status: incomplete

- warning: NodeDef 'ND_acos_vector4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_combine4_vector4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'acos' (NG_acos_degenerate_out_of_domain_vector4/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/asin/asin.mtlx

Status: incomplete

- warning: NodeDef 'ND_asin_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'asin' (NG_asin/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/asin_degenerate_out_of_domain/asin_degenerate_out_of_domain.mtlx

Status: incomplete

- warning: NodeDef 'ND_asin_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'asin' (NG_asin_degenerate_out_of_domain/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/asin_degenerate_out_of_domain_vector4/asin_degenerate_out_of_domain_vector4.mtlx

Status: incomplete

- warning: NodeDef 'ND_asin_vector4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_combine4_vector4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'asin' (NG_asin_degenerate_out_of_domain_vector4/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/atan2/atan2.mtlx

Status: incomplete

- warning: NodeDef 'ND_atan2_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'atan2' (NG_atan2/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/binormal_default/binormal_default.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_bitangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_acos_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_atan2_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'atan2' (NG_binormal_default/azimuth) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'acos' (NG_binormal_default/polar) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'magnitude' (NG_binormal_default/mag_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/binormal_model/binormal_model.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_bitangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_acos_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_atan2_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'atan2' (NG_binormal_model/azimuth) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'acos' (NG_binormal_model/polar) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'magnitude' (NG_binormal_model/mag_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/binormal_model_axis_x/binormal_model_axis_x.mtlx

Status: incomplete

- warning: NodeDef 'ND_bitangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'bitangent' (NG_binormal_model_axis_x/bitangent0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/binormal_model_axis_y/binormal_model_axis_y.mtlx

Status: incomplete

- warning: NodeDef 'ND_bitangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'bitangent' (NG_binormal_model_axis_y/bitangent0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/binormal_model_axis_z/binormal_model_axis_z.mtlx

Status: incomplete

- warning: NodeDef 'ND_bitangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'bitangent' (NG_binormal_model_axis_z/bitangent0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/binormal_object/binormal_object.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_bitangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_acos_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_atan2_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'atan2' (NG_binormal_object/azimuth) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'acos' (NG_binormal_object/polar) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'magnitude' (NG_binormal_object/mag_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/binormal_object_axis_x/binormal_object_axis_x.mtlx

Status: incomplete

- warning: NodeDef 'ND_bitangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'bitangent' (NG_binormal_object_axis_x/bitangent0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/binormal_object_axis_y/binormal_object_axis_y.mtlx

Status: incomplete

- warning: NodeDef 'ND_bitangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'bitangent' (NG_binormal_object_axis_y/bitangent0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/binormal_object_axis_z/binormal_object_axis_z.mtlx

Status: incomplete

- warning: NodeDef 'ND_bitangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'bitangent' (NG_binormal_object_axis_z/bitangent0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/binormal_world/binormal_world.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_bitangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_acos_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_atan2_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'atan2' (NG_binormal_world/azimuth) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'acos' (NG_binormal_world/polar) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'magnitude' (NG_binormal_world/mag_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/binormal_world_axis_x/binormal_world_axis_x.mtlx

Status: incomplete

- warning: NodeDef 'ND_bitangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'bitangent' (NG_binormal_world_axis_x/bitangent0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/binormal_world_axis_y/binormal_world_axis_y.mtlx

Status: incomplete

- warning: NodeDef 'ND_bitangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'bitangent' (NG_binormal_world_axis_y/bitangent0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/binormal_world_axis_z/binormal_world_axis_z.mtlx

Status: incomplete

- warning: NodeDef 'ND_bitangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'bitangent' (NG_binormal_world_axis_z/bitangent0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/bump/bump.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_acos_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_atan2_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'atan2' (NG_bump/azimuth) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'acos' (NG_bump/polar) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'magnitude' (NG_bump/mag_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/burn/burn.mtlx

Status: incomplete

- warning: NodeDef 'ND_burn_color3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'burn' (NG_burn/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/ceil/ceil.mtlx

Status: incomplete

- warning: NodeDef 'ND_ceil_color3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'ceil' (NG_ceil/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/cellnoise2d/cellnoise2d.mtlx

Status: incomplete

- warning: NodeDef 'ND_cellnoise2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'cellnoise2d' (NG_cellnoise2d/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/cellnoise2d_defaults/cellnoise2d_defaults.mtlx

Status: incomplete

- warning: NodeDef 'ND_cellnoise2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'cellnoise2d' (NG_cellnoise2d_defaults/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/cellnoise2d_freq24/cellnoise2d_freq24.mtlx

Status: incomplete

- warning: NodeDef 'ND_cellnoise2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'cellnoise2d' (NG_cellnoise2d_freq24/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/cellnoise2d_large_coords/cellnoise2d_large_coords.mtlx

Status: incomplete

- warning: NodeDef 'ND_cellnoise2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'cellnoise2d' (NG_cellnoise2d_large_coords/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/cellnoise2d_omit_texcoord/cellnoise2d_omit_texcoord.mtlx

Status: incomplete

- warning: NodeDef 'ND_cellnoise2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'cellnoise2d' (NG_cellnoise2d_omit_texcoord/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/cellnoise3d/cellnoise3d.mtlx

Status: incomplete

- warning: NodeDef 'ND_cellnoise3d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'cellnoise3d' (NG_cellnoise3d/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/cellnoise3d_defaults/cellnoise3d_defaults.mtlx

Status: incomplete

- warning: NodeDef 'ND_cellnoise3d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'cellnoise3d' (NG_cellnoise3d_defaults/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/cellnoise3d_freq2/cellnoise3d_freq2.mtlx

Status: incomplete

- warning: NodeDef 'ND_cellnoise3d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'cellnoise3d' (NG_cellnoise3d_freq2/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/cellnoise3d_large_coords/cellnoise3d_large_coords.mtlx

Status: incomplete

- warning: NodeDef 'ND_cellnoise3d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'cellnoise3d' (NG_cellnoise3d_large_coords/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/cellnoise3d_omit_position/cellnoise3d_omit_position.mtlx

Status: incomplete

- warning: NodeDef 'ND_cellnoise3d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'cellnoise3d' (NG_cellnoise3d_omit_position/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/checkerboard/checkerboard.mtlx

Status: incomplete

- warning: Input 'standard_surface.base_color' is driven by unsupported node 'checkerboard' (NG_checkerboard/node_under_test); its contribution would be lost (REQ-013).
- warning: Upstream node 'checkerboard' (NG_checkerboard/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/circle/circle.mtlx

Status: incomplete

- warning: Upstream node 'circle' (NG_circle/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/colorcorrect/colorcorrect.mtlx

Status: incomplete

- warning: Upstream node 'colorcorrect' (NG_colorcorrect/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/combine4/combine4.mtlx

Status: incomplete

- warning: NodeDef 'ND_combine4_color4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'combine4' (NG_combine4/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/contrast/contrast.mtlx

Status: incomplete

- warning: Upstream node 'contrast' (NG_contrast/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/convert/convert.mtlx

Status: failed

- error: Material compile failed for M_convert: missing named input 'in2'

### scenes/mtlx-library/nodes/convert_explicit_boolean_to_color3/convert_explicit_boolean_to_color3.mtlx

Status: failed

- error: Material compile failed for M_convert_explicit_boolean_to_color3: missing named input 'in2'

### scenes/mtlx-library/nodes/convert_explicit_boolean_to_color4/convert_explicit_boolean_to_color4.mtlx

Status: failed

- error: Material compile failed for M_convert_explicit_boolean_to_color4: missing named input 'in2'

### scenes/mtlx-library/nodes/convert_explicit_boolean_to_float/convert_explicit_boolean_to_float.mtlx

Status: failed

- warning: NodeDef 'ND_convert_boolean_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- error: Material compile failed for M_convert_explicit_boolean_to_float: missing named input 'in2'

### scenes/mtlx-library/nodes/convert_explicit_boolean_to_integer/convert_explicit_boolean_to_integer.mtlx

Status: failed

- warning: NodeDef 'ND_convert_integer_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- error: Material compile failed for M_convert_explicit_boolean_to_integer: missing named input 'in2'

### scenes/mtlx-library/nodes/convert_explicit_boolean_to_vector2/convert_explicit_boolean_to_vector2.mtlx

Status: failed

- error: Material compile failed for M_convert_explicit_boolean_to_vector2: missing named input 'in2'

### scenes/mtlx-library/nodes/convert_explicit_boolean_to_vector3/convert_explicit_boolean_to_vector3.mtlx

Status: failed

- error: Material compile failed for M_convert_explicit_boolean_to_vector3: missing named input 'in2'

### scenes/mtlx-library/nodes/convert_explicit_boolean_to_vector4/convert_explicit_boolean_to_vector4.mtlx

Status: failed

- error: Material compile failed for M_convert_explicit_boolean_to_vector4: missing named input 'in2'

### scenes/mtlx-library/nodes/convert_explicit_color4_to_color3/convert_explicit_color4_to_color3.mtlx

Status: incomplete

- warning: NodeDef 'ND_combine4_color4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'combine4' (NG_convert_explicit_color4_to_color3/source_node) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/convert_explicit_color4_to_vector2/convert_explicit_color4_to_vector2.mtlx

Status: incomplete

- warning: NodeDef 'ND_combine4_color4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'combine4' (NG_convert_explicit_color4_to_vector2/source_node) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/convert_explicit_color4_to_vector3/convert_explicit_color4_to_vector3.mtlx

Status: incomplete

- warning: NodeDef 'ND_combine4_color4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'combine4' (NG_convert_explicit_color4_to_vector3/source_node) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/convert_explicit_color4_to_vector4/convert_explicit_color4_to_vector4.mtlx

Status: incomplete

- warning: NodeDef 'ND_combine4_color4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'combine4' (NG_convert_explicit_color4_to_vector4/source_node) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/convert_explicit_integer_to_boolean/convert_explicit_integer_to_boolean.mtlx

Status: incomplete

- warning: NodeDef 'ND_convert_boolean_float' has no implementation for target '<any>'; explicit WGSL lowering required.

### scenes/mtlx-library/nodes/convert_explicit_integer_to_color3/convert_explicit_integer_to_color3.mtlx

Status: failed

- M_convert_explicit_integer_to_color3/raster (848:13): no matching constructor for 'vec3<f32>(i32)'
- M_convert_explicit_integer_to_color3/pathtracing (1222:13): no matching constructor for 'vec3<f32>(i32)'

### scenes/mtlx-library/nodes/convert_explicit_integer_to_color4/convert_explicit_integer_to_color4.mtlx

Status: failed

- M_convert_explicit_integer_to_color4/raster (848:13): no matching constructor for 'vec4<f32>(i32)'
- M_convert_explicit_integer_to_color4/pathtracing (1222:13): no matching constructor for 'vec4<f32>(i32)'

### scenes/mtlx-library/nodes/convert_explicit_integer_to_float/convert_explicit_integer_to_float.mtlx

Status: incomplete

- warning: NodeDef 'ND_convert_integer_float' has no implementation for target '<any>'; explicit WGSL lowering required.

### scenes/mtlx-library/nodes/convert_explicit_integer_to_vector2/convert_explicit_integer_to_vector2.mtlx

Status: failed

- M_convert_explicit_integer_to_vector2/raster (848:13): no matching constructor for 'vec2<f32>(i32)'
- M_convert_explicit_integer_to_vector2/pathtracing (1222:13): no matching constructor for 'vec2<f32>(i32)'

### scenes/mtlx-library/nodes/convert_explicit_integer_to_vector3/convert_explicit_integer_to_vector3.mtlx

Status: failed

- M_convert_explicit_integer_to_vector3/raster (848:13): no matching constructor for 'vec3<f32>(i32)'
- M_convert_explicit_integer_to_vector3/pathtracing (1222:13): no matching constructor for 'vec3<f32>(i32)'

### scenes/mtlx-library/nodes/convert_explicit_integer_to_vector4/convert_explicit_integer_to_vector4.mtlx

Status: failed

- M_convert_explicit_integer_to_vector4/raster (848:13): no matching constructor for 'vec4<f32>(i32)'
- M_convert_explicit_integer_to_vector4/pathtracing (1222:13): no matching constructor for 'vec4<f32>(i32)'

### scenes/mtlx-library/nodes/convert_explicit_vector4_to_color3/convert_explicit_vector4_to_color3.mtlx

Status: incomplete

- warning: NodeDef 'ND_combine4_vector4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'combine4' (NG_convert_explicit_vector4_to_color3/source_node) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/convert_explicit_vector4_to_color4/convert_explicit_vector4_to_color4.mtlx

Status: incomplete

- warning: NodeDef 'ND_combine4_vector4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'combine4' (NG_convert_explicit_vector4_to_color4/source_node) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/convert_explicit_vector4_to_vector2/convert_explicit_vector4_to_vector2.mtlx

Status: incomplete

- warning: NodeDef 'ND_combine4_vector4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'combine4' (NG_convert_explicit_vector4_to_vector2/source_node) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/convert_explicit_vector4_to_vector3/convert_explicit_vector4_to_vector3.mtlx

Status: incomplete

- warning: NodeDef 'ND_combine4_vector4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'combine4' (NG_convert_explicit_vector4_to_vector3/source_node) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/convert_invalid_implicit_boolean_to_color3/convert_invalid_implicit_boolean_to_color3.mtlx

Status: failed

- error: Material compile failed for M_convert_invalid_implicit_boolean_to_color3: missing named input 'in2'

### scenes/mtlx-library/nodes/convert_invalid_implicit_boolean_to_color4/convert_invalid_implicit_boolean_to_color4.mtlx

Status: failed

- error: Material compile failed for M_convert_invalid_implicit_boolean_to_color4: missing named input 'in2'

### scenes/mtlx-library/nodes/convert_invalid_implicit_boolean_to_float/convert_invalid_implicit_boolean_to_float.mtlx

Status: failed

- error: Material compile failed for M_convert_invalid_implicit_boolean_to_float: missing named input 'in2'

### scenes/mtlx-library/nodes/convert_invalid_implicit_boolean_to_integer/convert_invalid_implicit_boolean_to_integer.mtlx

Status: failed

- warning: NodeDef 'ND_convert_integer_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- error: Material compile failed for M_convert_invalid_implicit_boolean_to_integer: missing named input 'in2'

### scenes/mtlx-library/nodes/convert_invalid_implicit_boolean_to_vector2/convert_invalid_implicit_boolean_to_vector2.mtlx

Status: failed

- error: Material compile failed for M_convert_invalid_implicit_boolean_to_vector2: missing named input 'in2'

### scenes/mtlx-library/nodes/convert_invalid_implicit_boolean_to_vector3/convert_invalid_implicit_boolean_to_vector3.mtlx

Status: failed

- error: Material compile failed for M_convert_invalid_implicit_boolean_to_vector3: missing named input 'in2'

### scenes/mtlx-library/nodes/convert_invalid_implicit_boolean_to_vector4/convert_invalid_implicit_boolean_to_vector4.mtlx

Status: failed

- error: Material compile failed for M_convert_invalid_implicit_boolean_to_vector4: missing named input 'in2'

### scenes/mtlx-library/nodes/convert_invalid_implicit_color3_to_vector2/convert_invalid_implicit_color3_to_vector2.mtlx

Status: failed

- M_convert_invalid_implicit_color3_to_vector2/raster (847:12): no matching constructor for 'vec3<f32>(vec3<f32>, abstract-float)'
- M_convert_invalid_implicit_color3_to_vector2/pathtracing (1221:12): no matching constructor for 'vec3<f32>(vec3<f32>, abstract-float)'

### scenes/mtlx-library/nodes/convert_invalid_implicit_color4_to_color3/convert_invalid_implicit_color4_to_color3.mtlx

Status: failed

- warning: NodeDef 'ND_combine4_color4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'combine4' (NG_convert_invalid_implicit_color4_to_color3/source_node) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- M_convert_invalid_implicit_color4_to_color3/raster (852:56): type in structure constructor does not match struct member type: expected 'vec3<f32>', found 'vec4<f32>'
- M_convert_invalid_implicit_color4_to_color3/pathtracing (1226:56): type in structure constructor does not match struct member type: expected 'vec3<f32>', found 'vec4<f32>'

### scenes/mtlx-library/nodes/convert_invalid_implicit_color4_to_vector2/convert_invalid_implicit_color4_to_vector2.mtlx

Status: failed

- warning: NodeDef 'ND_combine4_color4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'combine4' (NG_convert_invalid_implicit_color4_to_vector2/source_node) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- M_convert_invalid_implicit_color4_to_vector2/raster (841:12): no matching constructor for 'vec3<f32>(vec4<f32>, abstract-float)'
- M_convert_invalid_implicit_color4_to_vector2/pathtracing (1215:12): no matching constructor for 'vec3<f32>(vec4<f32>, abstract-float)'

### scenes/mtlx-library/nodes/convert_invalid_implicit_color4_to_vector3/convert_invalid_implicit_color4_to_vector3.mtlx

Status: failed

- warning: NodeDef 'ND_combine4_color4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'combine4' (NG_convert_invalid_implicit_color4_to_vector3/source_node) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- M_convert_invalid_implicit_color4_to_vector3/raster (853:56): type in structure constructor does not match struct member type: expected 'vec3<f32>', found 'vec4<f32>'
- M_convert_invalid_implicit_color4_to_vector3/pathtracing (1227:56): type in structure constructor does not match struct member type: expected 'vec3<f32>', found 'vec4<f32>'

### scenes/mtlx-library/nodes/convert_invalid_implicit_color4_to_vector4/convert_invalid_implicit_color4_to_vector4.mtlx

Status: incomplete

- warning: NodeDef 'ND_combine4_color4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'combine4' (NG_convert_invalid_implicit_color4_to_vector4/source_node) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/convert_invalid_implicit_float_to_boolean/convert_invalid_implicit_float_to_boolean.mtlx

Status: incomplete

- warning: NodeDef 'ND_convert_boolean_float' has no implementation for target '<any>'; explicit WGSL lowering required.

### scenes/mtlx-library/nodes/convert_invalid_implicit_float_to_color3/convert_invalid_implicit_float_to_color3.mtlx

Status: failed

- M_convert_invalid_implicit_float_to_color3/raster (857:56): type in structure constructor does not match struct member type: expected 'vec3<f32>', found 'f32'
- M_convert_invalid_implicit_float_to_color3/pathtracing (1231:56): type in structure constructor does not match struct member type: expected 'vec3<f32>', found 'f32'

### scenes/mtlx-library/nodes/convert_invalid_implicit_float_to_color4/convert_invalid_implicit_float_to_color4.mtlx

Status: failed

- M_convert_invalid_implicit_float_to_color4/raster (846:12): cannot index into expression of type 'f32'
- M_convert_invalid_implicit_float_to_color4/pathtracing (1220:12): cannot index into expression of type 'f32'

### scenes/mtlx-library/nodes/convert_invalid_implicit_float_to_integer/convert_invalid_implicit_float_to_integer.mtlx

Status: incomplete

- warning: NodeDef 'ND_convert_integer_float' has no implementation for target '<any>'; explicit WGSL lowering required.

### scenes/mtlx-library/nodes/convert_invalid_implicit_float_to_vector2/convert_invalid_implicit_float_to_vector2.mtlx

Status: failed

- M_convert_invalid_implicit_float_to_vector2/raster (846:12): no matching constructor for 'vec3<f32>(f32, abstract-float)'
- M_convert_invalid_implicit_float_to_vector2/pathtracing (1220:12): no matching constructor for 'vec3<f32>(f32, abstract-float)'

### scenes/mtlx-library/nodes/convert_invalid_implicit_float_to_vector3/convert_invalid_implicit_float_to_vector3.mtlx

Status: failed

- M_convert_invalid_implicit_float_to_vector3/raster (858:56): type in structure constructor does not match struct member type: expected 'vec3<f32>', found 'f32'
- M_convert_invalid_implicit_float_to_vector3/pathtracing (1232:56): type in structure constructor does not match struct member type: expected 'vec3<f32>', found 'f32'

### scenes/mtlx-library/nodes/convert_invalid_implicit_float_to_vector4/convert_invalid_implicit_float_to_vector4.mtlx

Status: failed

- M_convert_invalid_implicit_float_to_vector4/raster (846:12): cannot index into expression of type 'f32'
- M_convert_invalid_implicit_float_to_vector4/pathtracing (1220:12): cannot index into expression of type 'f32'

### scenes/mtlx-library/nodes/convert_invalid_implicit_integer_to_boolean/convert_invalid_implicit_integer_to_boolean.mtlx

Status: incomplete

- warning: NodeDef 'ND_convert_boolean_float' has no implementation for target '<any>'; explicit WGSL lowering required.

### scenes/mtlx-library/nodes/convert_invalid_implicit_integer_to_color3/convert_invalid_implicit_integer_to_color3.mtlx

Status: failed

- M_convert_invalid_implicit_integer_to_color3/raster (859:56): type in structure constructor does not match struct member type: expected 'vec3<f32>', found 'i32'
- M_convert_invalid_implicit_integer_to_color3/pathtracing (1233:56): type in structure constructor does not match struct member type: expected 'vec3<f32>', found 'i32'

### scenes/mtlx-library/nodes/convert_invalid_implicit_integer_to_color4/convert_invalid_implicit_integer_to_color4.mtlx

Status: failed

- M_convert_invalid_implicit_integer_to_color4/raster (849:13): cannot index into expression of type 'i32'
- M_convert_invalid_implicit_integer_to_color4/pathtracing (1223:13): cannot index into expression of type 'i32'

### scenes/mtlx-library/nodes/convert_invalid_implicit_integer_to_float/convert_invalid_implicit_integer_to_float.mtlx

Status: failed

- M_convert_invalid_implicit_integer_to_float/raster (850:13): no matching constructor for 'vec3<f32>(i32, f32, f32)'
- M_convert_invalid_implicit_integer_to_float/pathtracing (1224:13): no matching constructor for 'vec3<f32>(i32, f32, f32)'

### scenes/mtlx-library/nodes/convert_invalid_implicit_integer_to_vector2/convert_invalid_implicit_integer_to_vector2.mtlx

Status: failed

- M_convert_invalid_implicit_integer_to_vector2/raster (849:13): no matching constructor for 'vec3<f32>(i32, abstract-float)'
- M_convert_invalid_implicit_integer_to_vector2/pathtracing (1223:13): no matching constructor for 'vec3<f32>(i32, abstract-float)'

### scenes/mtlx-library/nodes/convert_invalid_implicit_integer_to_vector3/convert_invalid_implicit_integer_to_vector3.mtlx

Status: failed

- M_convert_invalid_implicit_integer_to_vector3/raster (860:56): type in structure constructor does not match struct member type: expected 'vec3<f32>', found 'i32'
- M_convert_invalid_implicit_integer_to_vector3/pathtracing (1234:56): type in structure constructor does not match struct member type: expected 'vec3<f32>', found 'i32'

### scenes/mtlx-library/nodes/convert_invalid_implicit_integer_to_vector4/convert_invalid_implicit_integer_to_vector4.mtlx

Status: failed

- M_convert_invalid_implicit_integer_to_vector4/raster (849:13): cannot index into expression of type 'i32'
- M_convert_invalid_implicit_integer_to_vector4/pathtracing (1223:13): cannot index into expression of type 'i32'

### scenes/mtlx-library/nodes/convert_invalid_implicit_vector2_to_color3/convert_invalid_implicit_vector2_to_color3.mtlx

Status: failed

- M_convert_invalid_implicit_vector2_to_color3/raster (856:56): type in structure constructor does not match struct member type: expected 'vec3<f32>', found 'vec2<f32>'
- M_convert_invalid_implicit_vector2_to_color3/pathtracing (1230:56): type in structure constructor does not match struct member type: expected 'vec3<f32>', found 'vec2<f32>'

### scenes/mtlx-library/nodes/convert_invalid_implicit_vector2_to_color4/convert_invalid_implicit_vector2_to_color4.mtlx

Status: failed

- M_convert_invalid_implicit_vector2_to_color4/raster (845:15): invalid vector swizzle member
- M_convert_invalid_implicit_vector2_to_color4/pathtracing (1219:15): invalid vector swizzle member

### scenes/mtlx-library/nodes/convert_invalid_implicit_vector2_to_vector3/convert_invalid_implicit_vector2_to_vector3.mtlx

Status: failed

- M_convert_invalid_implicit_vector2_to_vector3/raster (857:56): type in structure constructor does not match struct member type: expected 'vec3<f32>', found 'vec2<f32>'
- M_convert_invalid_implicit_vector2_to_vector3/pathtracing (1231:56): type in structure constructor does not match struct member type: expected 'vec3<f32>', found 'vec2<f32>'

### scenes/mtlx-library/nodes/convert_invalid_implicit_vector2_to_vector4/convert_invalid_implicit_vector2_to_vector4.mtlx

Status: failed

- M_convert_invalid_implicit_vector2_to_vector4/raster (845:15): invalid vector swizzle member
- M_convert_invalid_implicit_vector2_to_vector4/pathtracing (1219:15): invalid vector swizzle member

### scenes/mtlx-library/nodes/convert_invalid_implicit_vector3_to_vector2/convert_invalid_implicit_vector3_to_vector2.mtlx

Status: failed

- M_convert_invalid_implicit_vector3_to_vector2/raster (847:12): no matching constructor for 'vec3<f32>(vec3<f32>, abstract-float)'
- M_convert_invalid_implicit_vector3_to_vector2/pathtracing (1221:12): no matching constructor for 'vec3<f32>(vec3<f32>, abstract-float)'

### scenes/mtlx-library/nodes/convert_invalid_implicit_vector4_to_color3/convert_invalid_implicit_vector4_to_color3.mtlx

Status: failed

- warning: NodeDef 'ND_combine4_vector4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'combine4' (NG_convert_invalid_implicit_vector4_to_color3/source_node) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- M_convert_invalid_implicit_vector4_to_color3/raster (852:56): type in structure constructor does not match struct member type: expected 'vec3<f32>', found 'vec4<f32>'
- M_convert_invalid_implicit_vector4_to_color3/pathtracing (1226:56): type in structure constructor does not match struct member type: expected 'vec3<f32>', found 'vec4<f32>'

### scenes/mtlx-library/nodes/convert_invalid_implicit_vector4_to_color4/convert_invalid_implicit_vector4_to_color4.mtlx

Status: incomplete

- warning: NodeDef 'ND_combine4_vector4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'combine4' (NG_convert_invalid_implicit_vector4_to_color4/source_node) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/convert_invalid_implicit_vector4_to_vector2/convert_invalid_implicit_vector4_to_vector2.mtlx

Status: failed

- warning: NodeDef 'ND_combine4_vector4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'combine4' (NG_convert_invalid_implicit_vector4_to_vector2/source_node) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- M_convert_invalid_implicit_vector4_to_vector2/raster (841:12): no matching constructor for 'vec3<f32>(vec4<f32>, abstract-float)'
- M_convert_invalid_implicit_vector4_to_vector2/pathtracing (1215:12): no matching constructor for 'vec3<f32>(vec4<f32>, abstract-float)'

### scenes/mtlx-library/nodes/convert_invalid_implicit_vector4_to_vector3/convert_invalid_implicit_vector4_to_vector3.mtlx

Status: failed

- warning: NodeDef 'ND_combine4_vector4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'combine4' (NG_convert_invalid_implicit_vector4_to_vector3/source_node) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- M_convert_invalid_implicit_vector4_to_vector3/raster (853:56): type in structure constructor does not match struct member type: expected 'vec3<f32>', found 'vec4<f32>'
- M_convert_invalid_implicit_vector4_to_vector3/pathtracing (1227:56): type in structure constructor does not match struct member type: expected 'vec3<f32>', found 'vec4<f32>'

### scenes/mtlx-library/nodes/cos/cos.mtlx

Status: incomplete

- warning: NodeDef 'ND_cos_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'cos' (NG_cos/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/crossproduct/crossproduct.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_crossproduct_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'magnitude' (NG_crossproduct/mag_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/determinant/determinant.mtlx

Status: incomplete

- warning: NodeDef 'ND_determinant_matrix33' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'determinant' (NG_determinant/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/difference/difference.mtlx

Status: incomplete

- warning: NodeDef 'ND_difference_color3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'difference' (NG_difference/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/distance/distance.mtlx

Status: incomplete

- warning: Upstream node 'distance' (NG_distance/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/dodge/dodge.mtlx

Status: incomplete

- warning: NodeDef 'ND_dodge_color3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'dodge' (NG_dodge/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/exp/exp.mtlx

Status: incomplete

- warning: NodeDef 'ND_exp_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'exp' (NG_exp/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/floor/floor.mtlx

Status: incomplete

- warning: NodeDef 'ND_floor_color3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'floor' (NG_floor/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/fractal2d_color/fractal2d_color.mtlx

Status: incomplete

- warning: Upstream node 'fractal2d' (NG_fractal2d_color/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/fractal2d_defaults/fractal2d_defaults.mtlx

Status: incomplete

- warning: NodeDef 'ND_fractal2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'fractal2d' (NG_fractal2d_defaults/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/fractal2d_large_coords/fractal2d_large_coords.mtlx

Status: incomplete

- warning: NodeDef 'ND_fractal2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'fractal2d' (NG_fractal2d_large_coords/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/fractal2d_octaves1/fractal2d_octaves1.mtlx

Status: incomplete

- warning: NodeDef 'ND_fractal2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'fractal2d' (NG_fractal2d_octaves1/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/fractal2d_omit_amplitude/fractal2d_omit_amplitude.mtlx

Status: incomplete

- warning: NodeDef 'ND_fractal2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'fractal2d' (NG_fractal2d_omit_amplitude/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/fractal2d_omit_diminish/fractal2d_omit_diminish.mtlx

Status: incomplete

- warning: NodeDef 'ND_fractal2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'fractal2d' (NG_fractal2d_omit_diminish/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/fractal2d_omit_lacunarity/fractal2d_omit_lacunarity.mtlx

Status: incomplete

- warning: NodeDef 'ND_fractal2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'fractal2d' (NG_fractal2d_omit_lacunarity/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/fractal2d_omit_octaves/fractal2d_omit_octaves.mtlx

Status: incomplete

- warning: NodeDef 'ND_fractal2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'fractal2d' (NG_fractal2d_omit_octaves/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/fractal2d_omit_texcoord/fractal2d_omit_texcoord.mtlx

Status: incomplete

- warning: NodeDef 'ND_fractal2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'fractal2d' (NG_fractal2d_omit_texcoord/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/fractal3d_color/fractal3d_color.mtlx

Status: failed

- M_fractal3d_color/raster (862:40): type mismatch for argument 2 in call to 'mx_fractal3d', expected 'f32', got 'vec3<f32>'
- M_fractal3d_color/pathtracing (1236:40): type mismatch for argument 2 in call to 'mx_fractal3d', expected 'f32', got 'vec3<f32>'

### scenes/mtlx-library/nodes/frame/frame.mtlx

Status: incomplete

- warning: NodeDef 'ND_frame_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'frame' (NG_frame/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/gltf_normalmap_defaults/gltf_normalmap_defaults.mtlx

Status: incomplete

- warning: Upstream node 'gltf_normalmap' (NG_gltf_normalmap_defaults/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/gltf_normalmap_isolate_operationorder_zero/gltf_normalmap_isolate_operationorder_zero.mtlx

Status: incomplete

- warning: Upstream node 'gltf_normalmap' (NG_gltf_normalmap_isolate_operationorder_zero/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/gltf_normalmap_isolate_rotate_dynamic/gltf_normalmap_isolate_rotate_dynamic.mtlx

Status: incomplete

- warning: Upstream node 'gltf_normalmap' (NG_gltf_normalmap_isolate_rotate_dynamic/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/gltf_normalmap_isolate_rotate_offset_procedural/gltf_normalmap_isolate_rotate_offset_procedural.mtlx

Status: incomplete

- warning: Upstream node 'gltf_normalmap' (NG_gltf_normalmap_isolate_rotate_offset_procedural/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/gltf_normalmap_manual_model_frame_to_world/gltf_normalmap_manual_model_frame_to_world.mtlx

Status: incomplete

- warning: NodeDef 'ND_transformvector_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_bitangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_tangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_transformnormal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'gltf_image' (NG_gltf_normalmap_manual_model_frame_to_world/normal_image) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'transformnormal' (NG_gltf_normalmap_manual_model_frame_to_world/n_world) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'transformvector' (NG_gltf_normalmap_manual_model_frame_to_world/t_world) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'transformvector' (NG_gltf_normalmap_manual_model_frame_to_world/b_world) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/gltf_normalmap_manual_object_frame_to_world/gltf_normalmap_manual_object_frame_to_world.mtlx

Status: incomplete

- warning: NodeDef 'ND_transformvector_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_bitangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_tangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_transformnormal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'gltf_image' (NG_gltf_normalmap_manual_object_frame_to_world/normal_image) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'transformnormal' (NG_gltf_normalmap_manual_object_frame_to_world/n_world) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'transformvector' (NG_gltf_normalmap_manual_object_frame_to_world/t_world) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'transformvector' (NG_gltf_normalmap_manual_object_frame_to_world/b_world) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/gltf_normalmap_manual_world_frame/gltf_normalmap_manual_world_frame.mtlx

Status: incomplete

- warning: NodeDef 'ND_bitangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_tangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'gltf_image' (NG_gltf_normalmap_manual_world_frame/normal_image) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'normal' (NG_gltf_normalmap_manual_world_frame/n_world) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'tangent' (NG_gltf_normalmap_manual_world_frame/t_world) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'bitangent' (NG_gltf_normalmap_manual_world_frame/b_world) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/gltf_normalmap_transform/gltf_normalmap_transform.mtlx

Status: incomplete

- warning: Upstream node 'gltf_normalmap' (NG_gltf_normalmap_transform/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/hextiledimage_texcoord_translate/material.mtlx

Status: incomplete

- warning: Upstream node 'place2d' (NG_hextiledimage_texcoord_translate/uv_transform) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/hextilednormalmap/hextilednormalmap.mtlx

Status: incomplete

- warning: NodeDef 'ND_hextilednormalmap_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'hextilednormalmap' (NG_hextilednormalmap/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/image_place2d_identity_probe/image_place2d_identity_probe.mtlx

Status: incomplete

- warning: Upstream node 'place2d' (NG_image_place2d_identity_probe/uv_transform) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/ln_degenerate_nonpositive_input_vector4/ln_degenerate_nonpositive_input_vector4.mtlx

Status: incomplete

- warning: NodeDef 'ND_combine4_vector4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'combine4' (NG_ln_degenerate_nonpositive_input_vector4/ln_in) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/logic_and/logic_and.mtlx

Status: failed

- warning: NodeDef 'ND_logical_and' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'checkerboard' (NG_logic_and/checker_a) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'checkerboard' (NG_logic_and/checker_b) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'and' (NG_logic_and/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- error: Material compile failed for M_logic_and: missing named input 'in2'

### scenes/mtlx-library/nodes/logic_not/logic_not.mtlx

Status: failed

- warning: NodeDef 'ND_logical_not' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'checkerboard' (NG_logic_not/checker_a) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'checkerboard' (NG_logic_not/checker_b) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'not' (NG_logic_not/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- error: Material compile failed for M_logic_not: missing named input 'in2'

### scenes/mtlx-library/nodes/logic_or/logic_or.mtlx

Status: failed

- warning: NodeDef 'ND_logical_or' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'checkerboard' (NG_logic_or/checker_a) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'checkerboard' (NG_logic_or/checker_b) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'or' (NG_logic_or/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- error: Material compile failed for M_logic_or: missing named input 'in2'

### scenes/mtlx-library/nodes/logic_xor/logic_xor.mtlx

Status: failed

- warning: Upstream node 'checkerboard' (NG_logic_xor/checker_a) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'checkerboard' (NG_logic_xor/checker_b) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'xor' (NG_logic_xor/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- error: Material compile failed for M_logic_xor: missing named input 'in2'

### scenes/mtlx-library/nodes/magnitude/magnitude.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector2' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'magnitude' (NG_magnitude/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/matrix33_creatematrix/matrix33_creatematrix.mtlx

Status: failed

- warning: NodeDef 'ND_creatematrix_vector3_matrix33' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'creatematrix' (NG_matrix33_creatematrix/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- M_matrix33_creatematrix/raster (840:12): cannot index type 'f32'
- M_matrix33_creatematrix/pathtracing (1214:12): cannot index type 'f32'

### scenes/mtlx-library/nodes/matrix33_determinant/matrix33_determinant.mtlx

Status: incomplete

- warning: NodeDef 'ND_determinant_matrix33' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_creatematrix_vector3_matrix33' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'determinant' (NG_matrix33_determinant/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/matrix33_invertmatrix/matrix33_invertmatrix.mtlx

Status: failed

- warning: NodeDef 'ND_invertmatrix_matrix33' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_creatematrix_vector3_matrix33' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'invertmatrix' (NG_matrix33_invertmatrix/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- M_matrix33_invertmatrix/raster (840:12): cannot index type 'f32'
- M_matrix33_invertmatrix/pathtracing (1214:12): cannot index type 'f32'

### scenes/mtlx-library/nodes/matrix33_transformmatrix/matrix33_transformmatrix.mtlx

Status: incomplete

- warning: NodeDef 'ND_transformmatrix_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_creatematrix_vector3_matrix33' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'transformmatrix' (NG_matrix33_transformmatrix/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/matrix33_transformmatrix_2d_identity/matrix33_transformmatrix_2d_identity.mtlx

Status: incomplete

- warning: NodeDef 'ND_transformmatrix_vector2M3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'transformmatrix' (NG_matrix33_transformmatrix_2d_identity/uv_transform) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/matrix33_transformmatrix_2d_scale/matrix33_transformmatrix_2d_scale.mtlx

Status: incomplete

- warning: NodeDef 'ND_transformmatrix_vector2M3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'transformmatrix' (NG_matrix33_transformmatrix_2d_scale/uv_transform) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/matrix33_transformmatrix_2d_scale_translate_col/matrix33_transformmatrix_2d_scale_translate_col.mtlx

Status: incomplete

- warning: NodeDef 'ND_transformmatrix_vector2M3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'transformmatrix' (NG_matrix33_transformmatrix_2d_scale_translate_col/uv_transform) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/matrix33_transformmatrix_2d_translate_col/matrix33_transformmatrix_2d_translate_col.mtlx

Status: incomplete

- warning: NodeDef 'ND_transformmatrix_vector2M3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'transformmatrix' (NG_matrix33_transformmatrix_2d_translate_col/uv_transform) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/matrix33_transformmatrix_2d_translate_row/matrix33_transformmatrix_2d_translate_row.mtlx

Status: incomplete

- warning: NodeDef 'ND_transformmatrix_vector2M3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'transformmatrix' (NG_matrix33_transformmatrix_2d_translate_row/uv_transform) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/matrix33_transpose/matrix33_transpose.mtlx

Status: failed

- warning: NodeDef 'ND_transpose_matrix33' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_creatematrix_vector3_matrix33' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'transpose' (NG_matrix33_transpose/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- M_matrix33_transpose/raster (840:12): cannot index type 'f32'
- M_matrix33_transpose/pathtracing (1214:12): cannot index type 'f32'

### scenes/mtlx-library/nodes/matrix44_creatematrix/matrix44_creatematrix.mtlx

Status: failed

- warning: NodeDef 'ND_creatematrix_vector4_matrix44' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_combine4_vector4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_creatematrix_vector3_matrix44' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'creatematrix' (NG_matrix44_creatematrix/matrix_from_vector3) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'creatematrix' (NG_matrix44_creatematrix/matrix_from_vector4) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- M_matrix44_creatematrix/raster (840:12): cannot index type 'f32'
- M_matrix44_creatematrix/pathtracing (1214:12): cannot index type 'f32'

### scenes/mtlx-library/nodes/matrix44_determinant/matrix44_determinant.mtlx

Status: incomplete

- warning: NodeDef 'ND_determinant_matrix44' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_creatematrix_vector4_matrix44' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_combine4_vector4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'determinant' (NG_matrix44_determinant/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/matrix44_invertmatrix/matrix44_invertmatrix.mtlx

Status: failed

- warning: NodeDef 'ND_invertmatrix_matrix44' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_creatematrix_vector4_matrix44' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_combine4_vector4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'invertmatrix' (NG_matrix44_invertmatrix/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- M_matrix44_invertmatrix/raster (840:12): cannot index type 'f32'
- M_matrix44_invertmatrix/pathtracing (1214:12): cannot index type 'f32'

### scenes/mtlx-library/nodes/matrix44_transformmatrix_2d_identity/matrix44_transformmatrix_2d_identity.mtlx

Status: incomplete

- warning: NodeDef 'ND_transformmatrix_vector3M4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'transformmatrix' (NG_matrix44_transformmatrix_2d_identity/uv_transform_vec3) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/matrix44_transformmatrix_2d_scale/matrix44_transformmatrix_2d_scale.mtlx

Status: incomplete

- warning: NodeDef 'ND_transformmatrix_vector3M4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'transformmatrix' (NG_matrix44_transformmatrix_2d_scale/uv_transform_vec3) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/matrix44_transformmatrix_2d_scale_translate_col/matrix44_transformmatrix_2d_scale_translate_col.mtlx

Status: incomplete

- warning: NodeDef 'ND_transformmatrix_vector3M4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'transformmatrix' (NG_matrix44_transformmatrix_2d_scale_translate_col/uv_transform_vec3) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/matrix44_transformmatrix_2d_translate_col/matrix44_transformmatrix_2d_translate_col.mtlx

Status: incomplete

- warning: NodeDef 'ND_transformmatrix_vector3M4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'transformmatrix' (NG_matrix44_transformmatrix_2d_translate_col/uv_transform_vec3) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/matrix44_transformmatrix_2d_translate_row/matrix44_transformmatrix_2d_translate_row.mtlx

Status: incomplete

- warning: NodeDef 'ND_transformmatrix_vector3M4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'transformmatrix' (NG_matrix44_transformmatrix_2d_translate_row/uv_transform_vec3) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/matrix44_transpose/matrix44_transpose.mtlx

Status: failed

- warning: NodeDef 'ND_transpose_matrix44' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_creatematrix_vector4_matrix44' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_combine4_vector4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'transpose' (NG_matrix44_transpose/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- M_matrix44_transpose/raster (840:12): cannot index type 'f32'
- M_matrix44_transpose/pathtracing (1214:12): cannot index type 'f32'

### scenes/mtlx-library/nodes/minus/minus.mtlx

Status: incomplete

- warning: NodeDef 'ND_minus_color3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'minus' (NG_minus/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/modulo/modulo.mtlx

Status: incomplete

- warning: NodeDef 'ND_modulo_color3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'modulo' (NG_modulo/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/modulo_degenerate_zero/modulo_degenerate_zero.mtlx

Status: incomplete

- warning: NodeDef 'ND_modulo_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'modulo' (NG_modulo_degenerate_zero/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/noise2d/noise2d.mtlx

Status: incomplete

- warning: NodeDef 'ND_noise2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'noise2d' (NG_noise2d/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/noise2d_color/noise2d_color.mtlx

Status: incomplete

- warning: Upstream node 'noise2d' (NG_noise2d_color/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/noise2d_defaults/noise2d_defaults.mtlx

Status: incomplete

- warning: NodeDef 'ND_noise2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'noise2d' (NG_noise2d_defaults/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/noise2d_large_coords/noise2d_large_coords.mtlx

Status: incomplete

- warning: NodeDef 'ND_noise2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'noise2d' (NG_noise2d_large_coords/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/noise2d_omit_amplitude/noise2d_omit_amplitude.mtlx

Status: incomplete

- warning: NodeDef 'ND_noise2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'noise2d' (NG_noise2d_omit_amplitude/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/noise2d_omit_pivot/noise2d_omit_pivot.mtlx

Status: incomplete

- warning: NodeDef 'ND_noise2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'noise2d' (NG_noise2d_omit_pivot/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/noise2d_omit_texcoord/noise2d_omit_texcoord.mtlx

Status: incomplete

- warning: NodeDef 'ND_noise2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'noise2d' (NG_noise2d_omit_texcoord/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/noise3d/noise3d.mtlx

Status: incomplete

- warning: NodeDef 'ND_noise3d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'noise3d' (NG_noise3d/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/noise3d_color/noise3d_color.mtlx

Status: incomplete

- warning: Upstream node 'noise3d' (NG_noise3d_color/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/noise3d_defaults/noise3d_defaults.mtlx

Status: incomplete

- warning: NodeDef 'ND_noise3d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'noise3d' (NG_noise3d_defaults/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/noise3d_large_coords/noise3d_large_coords.mtlx

Status: incomplete

- warning: NodeDef 'ND_noise3d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'noise3d' (NG_noise3d_large_coords/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/noise3d_omit_amplitude/noise3d_omit_amplitude.mtlx

Status: incomplete

- warning: NodeDef 'ND_noise3d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'noise3d' (NG_noise3d_omit_amplitude/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/noise3d_omit_pivot/noise3d_omit_pivot.mtlx

Status: incomplete

- warning: NodeDef 'ND_noise3d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'noise3d' (NG_noise3d_omit_pivot/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/noise3d_omit_position/noise3d_omit_position.mtlx

Status: incomplete

- warning: NodeDef 'ND_noise3d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'noise3d' (NG_noise3d_omit_position/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/normal_default/normal_default.mtlx

Status: incomplete

- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'normal' (NG_normal_default/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/normal_model/normal_model.mtlx

Status: incomplete

- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'normal' (NG_normal_model/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/normal_model_axis_y/normal_model_axis_y.mtlx

Status: incomplete

- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'normal' (NG_normal_model_axis_y/normal0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/normal_model_axis_z/normal_model_axis_z.mtlx

Status: incomplete

- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'normal' (NG_normal_model_axis_z/normal0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/normal_object/normal_object.mtlx

Status: incomplete

- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'normal' (NG_normal_object/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/normal_object_axis_x/normal_object_axis_x.mtlx

Status: incomplete

- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'normal' (NG_normal_object_axis_x/normal0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/normal_object_axis_y/normal_object_axis_y.mtlx

Status: incomplete

- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'normal' (NG_normal_object_axis_y/normal0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/normal_object_axis_z/normal_object_axis_z.mtlx

Status: incomplete

- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'normal' (NG_normal_object_axis_z/normal0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/normal_space_model/normal_space_model.mtlx

Status: incomplete

- warning: NodeDef 'ND_transformnormal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'transformnormal' (NG_normal_space_model/normal_model_to_world) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/normal_space_object/normal_space_object.mtlx

Status: incomplete

- warning: NodeDef 'ND_transformnormal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'transformnormal' (NG_normal_space_object/normal_object_to_world) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/normal_space_world/normal_space_world.mtlx

Status: incomplete

- warning: NodeDef 'ND_transformnormal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'transformnormal' (NG_normal_space_world/normal_world_to_world) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/normal_world/normal_world.mtlx

Status: incomplete

- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'normal' (NG_normal_world/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/normal_world_axis_x/normal_world_axis_x.mtlx

Status: incomplete

- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'normal' (NG_normal_world_axis_x/normal0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/normal_world_axis_y/normal_world_axis_y.mtlx

Status: incomplete

- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'normal' (NG_normal_world_axis_y/normal0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/normal_world_axis_z/normal_world_axis_z.mtlx

Status: incomplete

- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'normal' (NG_normal_world_axis_z/normal0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/normalize_degenerate_zero_vector/normalize_degenerate_zero_vector.mtlx

Status: incomplete

- warning: Input 'standard_surface.base_color' is driven by unsupported node 'absval' (NG_normalize_degenerate_zero_vector/magnitude); its contribution would be lost (REQ-013).

### scenes/mtlx-library/nodes/normalmap_custom_frame_identity_negY/normalmap_custom_frame_identity_negY.mtlx

Status: failed

- M_normalmap_custom_frame_identity_negY/raster (858:29): type mismatch for argument 2 in call to 'mx_normalmap', expected 'f32', got 'vec2<f32>'
- M_normalmap_custom_frame_identity_negY/pathtracing (1232:29): type mismatch for argument 2 in call to 'mx_normalmap', expected 'f32', got 'vec2<f32>'

### scenes/mtlx-library/nodes/normalmap_custom_frame_rot45/normalmap_custom_frame_rot45.mtlx

Status: failed

- M_normalmap_custom_frame_rot45/raster (858:29): type mismatch for argument 2 in call to 'mx_normalmap', expected 'f32', got 'vec2<f32>'
- M_normalmap_custom_frame_rot45/pathtracing (1232:29): type mismatch for argument 2 in call to 'mx_normalmap', expected 'f32', got 'vec2<f32>'

### scenes/mtlx-library/nodes/normalmap_custom_frame_rot45_posY/normalmap_custom_frame_rot45_posY.mtlx

Status: failed

- M_normalmap_custom_frame_rot45_posY/raster (858:29): type mismatch for argument 2 in call to 'mx_normalmap', expected 'f32', got 'vec2<f32>'
- M_normalmap_custom_frame_rot45_posY/pathtracing (1232:29): type mismatch for argument 2 in call to 'mx_normalmap', expected 'f32', got 'vec2<f32>'

### scenes/mtlx-library/nodes/normalmap_model_frame_to_world/normalmap_model_frame_to_world.mtlx

Status: incomplete

- warning: NodeDef 'ND_transformvector_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_bitangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_tangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_transformnormal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'transformnormal' (NG_normalmap_model_frame_to_world/n_world) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'transformvector' (NG_normalmap_model_frame_to_world/t_world) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'transformvector' (NG_normalmap_model_frame_to_world/b_world) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/normalmap_object_frame_to_world/normalmap_object_frame_to_world.mtlx

Status: incomplete

- warning: NodeDef 'ND_transformvector_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_bitangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_tangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_transformnormal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'transformnormal' (NG_normalmap_object_frame_to_world/n_world) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'transformvector' (NG_normalmap_object_frame_to_world/t_world) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'transformvector' (NG_normalmap_object_frame_to_world/b_world) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/normalmap_world_frame/normalmap_world_frame.mtlx

Status: incomplete

- warning: NodeDef 'ND_bitangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_tangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'normal' (NG_normalmap_world_frame/n_world) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'tangent' (NG_normalmap_world_frame/t_world) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'bitangent' (NG_normalmap_world_frame/b_world) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/overlay/overlay.mtlx

Status: incomplete

- warning: Upstream node 'overlay' (NG_overlay/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/place2d/place2d.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector2' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'magnitude' (NG_place2d/mag_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/place2d_identity/material.mtlx

Status: incomplete

- warning: Upstream node 'place2d' (NG_place2d_identity/uv_transform) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/place2d_operationorder_srt/material.mtlx

Status: incomplete

- warning: Upstream node 'place2d' (NG_place2d_operationorder_srt/uv_transform) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/place2d_operationorder_trs/material.mtlx

Status: incomplete

- warning: Upstream node 'place2d' (NG_place2d_operationorder_trs/uv_transform) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/place2d_rotate/material.mtlx

Status: incomplete

- warning: Upstream node 'place2d' (NG_place2d_rotate/uv_transform) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/place2d_rotate_pivot/material.mtlx

Status: incomplete

- warning: Upstream node 'place2d' (NG_place2d_rotate_pivot/uv_transform) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/place2d_scale/material.mtlx

Status: incomplete

- warning: Upstream node 'place2d' (NG_place2d_scale/uv_transform) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/place2d_scale_offset_x/material.mtlx

Status: incomplete

- warning: Upstream node 'place2d' (NG_place2d_scale_offset_x/uv_transform) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/place2d_scale_offset_y/material.mtlx

Status: incomplete

- warning: Upstream node 'place2d' (NG_place2d_scale_offset_y/uv_transform) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/place2d_scale_pivot_center/material.mtlx

Status: incomplete

- warning: Upstream node 'place2d' (NG_place2d_scale_pivot_center/uv_transform) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/place2d_scale_pivot_origin/material.mtlx

Status: incomplete

- warning: Upstream node 'place2d' (NG_place2d_scale_pivot_origin/uv_transform) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/place2d_scale_rotate/material.mtlx

Status: incomplete

- warning: Upstream node 'place2d' (NG_place2d_scale_rotate/uv_transform) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/place2d_translate/material.mtlx

Status: incomplete

- warning: Upstream node 'place2d' (NG_place2d_translate/uv_transform) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/place2d_translate_rotate/material.mtlx

Status: incomplete

- warning: Upstream node 'place2d' (NG_place2d_translate_rotate/uv_transform) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/place2d_translate_scale/material.mtlx

Status: incomplete

- warning: Upstream node 'place2d' (NG_place2d_translate_scale/uv_transform) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/place2d_translate_scale_rotate/material.mtlx

Status: incomplete

- warning: Upstream node 'place2d' (NG_place2d_translate_scale_rotate/uv_transform) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/place2d_translate_x/material.mtlx

Status: incomplete

- warning: Upstream node 'place2d' (NG_place2d_translate_x/uv_transform) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/place2d_translate_y/material.mtlx

Status: incomplete

- warning: Upstream node 'place2d' (NG_place2d_translate_y/uv_transform) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/position_default/position_default.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'magnitude' (NG_position_default/mag_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/position_model/position_model.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'magnitude' (NG_position_model/mag_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/blackbody/blackbody.mtlx

Status: incomplete

- warning: NodeDef 'ND_blackbody' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Input 'standard_surface.emission_color' is driven by unsupported node 'blackbody' (NG_blackbody/node_under_test); its contribution would be lost (REQ-013).
- warning: Upstream node 'blackbody' (NG_blackbody/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/combine2/combine2.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector2' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'magnitude' (NG_combine2/mag_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/fractal2d/fractal2d.mtlx

Status: incomplete

- warning: NodeDef 'ND_fractal2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'fractal2d' (NG_fractal2d/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/gltf_normalmap_isolate_scale_float/gltf_normalmap_isolate_scale_float.mtlx

Status: incomplete

- warning: Upstream node 'gltf_normalmap' (NG_gltf_normalmap_isolate_scale_float/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/matrix44_transformmatrix/matrix44_transformmatrix.mtlx

Status: incomplete

- warning: NodeDef 'ND_transformmatrix_vector4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_creatematrix_vector4_matrix44' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_combine4_vector4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_transformmatrix_vector3M4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'transformmatrix' (NG_matrix44_transformmatrix/transformed_vec3) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'transformmatrix' (NG_matrix44_transformmatrix/transformed_vec4) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/normal_model_axis_x/normal_model_axis_x.mtlx

Status: incomplete

- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'normal' (NG_normal_model_axis_x/normal0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/position_object/position_object.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'magnitude' (NG_position_object/mag_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/position_world/position_world.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'magnitude' (NG_position_world/mag_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/ramp/ramp.mtlx

Status: incomplete

- warning: NodeDef 'ND_combine4_color4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'ramp' (NG_ramp_test/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/ramp_degenerate_inverted_endpoints_out_of_range_texcoord/ramp_degenerate_inverted_endpoints_out_of_range_texcoord.mtlx

Status: incomplete

- warning: NodeDef 'ND_ramptb_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_ramplr_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'ramplr' (NG_ramp_degenerate_inverted_endpoints_out_of_range_texcoord/ramplr_inverted) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'ramptb' (NG_ramp_degenerate_inverted_endpoints_out_of_range_texcoord/ramptb_inverted) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/ramp_gradient/ramp_gradient.mtlx

Status: incomplete

- warning: Upstream node 'ramp_gradient' (NG_ramp_gradient_test/grad3) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/ramp4/ramp4.mtlx

Status: incomplete

- warning: Upstream node 'ramp4' (NG_ramp4/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/ramplr/ramplr.mtlx

Status: incomplete

- warning: NodeDef 'ND_ramplr_color3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'ramplr' (NG_ramplr/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/ramplr_compare_default_vs_inverted/ramplr_compare_default_vs_inverted.mtlx

Status: incomplete

- warning: NodeDef 'ND_ramplr_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'ramplr' (NG_ramplr_compare_default_vs_inverted/ramplr_default) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'ramplr' (NG_ramplr_compare_default_vs_inverted/ramplr_inverted) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/ramplr_compare_out_of_range_clamp/ramplr_compare_out_of_range_clamp.mtlx

Status: incomplete

- warning: NodeDef 'ND_ramplr_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'ramplr' (NG_ramplr_compare_out_of_range_clamp/ramplr_result) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/ramptb/ramptb.mtlx

Status: incomplete

- warning: NodeDef 'ND_ramptb_color3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'ramptb' (NG_ramptb/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/ramptb_compare_default_vs_inverted/ramptb_compare_default_vs_inverted.mtlx

Status: incomplete

- warning: NodeDef 'ND_ramptb_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'ramptb' (NG_ramptb_compare_default_vs_inverted/ramptb_default) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'ramptb' (NG_ramptb_compare_default_vs_inverted/ramptb_inverted) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/ramptb_compare_out_of_range_clamp/ramptb_compare_out_of_range_clamp.mtlx

Status: incomplete

- warning: NodeDef 'ND_ramptb_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'ramptb' (NG_ramptb_compare_out_of_range_clamp/ramptb_result) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/ramptb_compare_texcoord_axis/ramptb_compare_texcoord_axis.mtlx

Status: incomplete

- warning: NodeDef 'ND_ramptb_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'ramptb' (NG_ramptb_compare_texcoord_axis/ramptb_unswizzled) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'ramptb' (NG_ramptb_compare_texcoord_axis/ramptb_swizzled) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/ramptb_equal_endpoints_constant/ramptb_equal_endpoints_constant.mtlx

Status: incomplete

- warning: NodeDef 'ND_ramptb_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'ramptb' (NG_ramptb_equal_endpoints_constant/ramptb_in_range) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'ramptb' (NG_ramptb_equal_endpoints_constant/ramptb_out_of_range) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/range/range.mtlx

Status: failed

- error: Material compile failed for M_range: missing named input 'in2'

### scenes/mtlx-library/nodes/range_degenerate_inverted_input_bounds_vector4/range_degenerate_inverted_input_bounds_vector4.mtlx

Status: incomplete

- warning: NodeDef 'ND_combine4_vector4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'combine4' (NG_range_degenerate_inverted_input_bounds_vector4/range_in) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/reflect/reflect.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'magnitude' (NG_reflect/mag_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/refract/refract.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'magnitude' (NG_refract/mag_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/remap/remap.mtlx

Status: incomplete

- warning: NodeDef 'ND_remap_color3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Input 'standard_surface.base_color' is driven by unsupported node 'remap' (NG_remap/node_under_test); its contribution would be lost (REQ-013).
- warning: Upstream node 'remap' (NG_remap/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/remap_degenerate_inverted_input_bounds/remap_degenerate_inverted_input_bounds.mtlx

Status: incomplete

- warning: NodeDef 'ND_remap_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'remap' (NG_remap_degenerate_inverted_input_bounds/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/remap_degenerate_inverted_input_bounds_vector4/remap_degenerate_inverted_input_bounds_vector4.mtlx

Status: incomplete

- warning: NodeDef 'ND_remap_vector4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_combine4_vector4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'remap' (NG_remap_degenerate_inverted_input_bounds_vector4/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/remap_degenerate_vector4/remap_degenerate_vector4.mtlx

Status: incomplete

- warning: NodeDef 'ND_remap_vector4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_combine4_vector4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'remap' (NG_remap_degenerate_vector4/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/round/round.mtlx

Status: incomplete

- warning: NodeDef 'ND_round_color3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'round' (NG_round/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/safepower/safepower.mtlx

Status: incomplete

- warning: Upstream node 'safepower' (NG_safepower/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/saturate/saturate.mtlx

Status: incomplete

- warning: Upstream node 'saturate' (NG_saturate/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/screen/screen.mtlx

Status: incomplete

- warning: NodeDef 'ND_screen_color3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'screen' (NG_screen/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/separate4/separate4.mtlx

Status: incomplete

- warning: NodeDef 'ND_combine4_color4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'combine4' (NG_separate4/uv_color4) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/smoothstep/smoothstep.mtlx

Status: incomplete

- warning: Upstream node 'smoothstep' (NG_smoothstep/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/smoothstep_degenerate/smoothstep_degenerate.mtlx

Status: incomplete

- warning: NodeDef 'ND_smoothstep_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'smoothstep' (NG_smoothstep_degenerate/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/smoothstep_degenerate_inverted_bounds/smoothstep_degenerate_inverted_bounds.mtlx

Status: incomplete

- warning: NodeDef 'ND_smoothstep_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'smoothstep' (NG_smoothstep_degenerate_inverted_bounds/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/smoothstep_degenerate_inverted_bounds_vector4/smoothstep_degenerate_inverted_bounds_vector4.mtlx

Status: incomplete

- warning: NodeDef 'ND_combine4_vector4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'smoothstep' (NG_smoothstep_degenerate_inverted_bounds_vector4/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/splitlr/splitlr.mtlx

Status: incomplete

- warning: NodeDef 'ND_splitlr_color3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'splitlr' (NG_splitlr/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/remap_degenerate/remap_degenerate.mtlx

Status: incomplete

- warning: NodeDef 'ND_remap_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'remap' (NG_remap_degenerate/remap_forward) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'remap' (NG_remap_degenerate/remap_reverse) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/splitlr_compare_center_shift/splitlr_compare_center_shift.mtlx

Status: incomplete

- warning: NodeDef 'ND_splitlr_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'splitlr' (NG_splitlr_compare_center_shift/splitlr_center_low) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'splitlr' (NG_splitlr_compare_center_shift/splitlr_center_high) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/splitlr_compare_default_vs_inverted/splitlr_compare_default_vs_inverted.mtlx

Status: incomplete

- warning: NodeDef 'ND_splitlr_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'splitlr' (NG_splitlr_compare_default_vs_inverted/splitlr_default) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'splitlr' (NG_splitlr_compare_default_vs_inverted/splitlr_inverted) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/splittb/splittb.mtlx

Status: incomplete

- warning: NodeDef 'ND_splittb_color3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'splittb' (NG_splittb/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/splittb_compare_center_shift/splittb_compare_center_shift.mtlx

Status: incomplete

- warning: NodeDef 'ND_splittb_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'splittb' (NG_splittb_compare_center_shift/splittb_center_low) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'splittb' (NG_splittb_compare_center_shift/splittb_center_high) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/splittb_compare_default_vs_inverted/splittb_compare_default_vs_inverted.mtlx

Status: incomplete

- warning: NodeDef 'ND_splittb_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'splittb' (NG_splittb_compare_default_vs_inverted/splittb_default) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'splittb' (NG_splittb_compare_default_vs_inverted/splittb_inverted) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/switch/switch.mtlx

Status: incomplete

- warning: Input 'standard_surface.base_color' is driven by unsupported node 'switch' (NG_switch/node_under_test); its contribution would be lost (REQ-013).
- warning: Upstream node 'switch' (NG_switch/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/switch_float_floor_clamp/switch_float_floor_clamp.mtlx

Status: incomplete

- warning: Input 'standard_surface.base_color' is driven by unsupported node 'switch' (NG_switch_float_floor_clamp/node_under_test); its contribution would be lost (REQ-013).
- warning: Upstream node 'switch' (NG_switch_float_floor_clamp/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/switch_integer_zero_based/switch_integer_zero_based.mtlx

Status: incomplete

- warning: Input 'standard_surface.base_color' is driven by unsupported node 'switch' (NG_switch_integer_zero_based/node_under_test); its contribution would be lost (REQ-013).
- warning: Upstream node 'switch' (NG_switch_integer_zero_based/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/tan/tan.mtlx

Status: incomplete

- warning: NodeDef 'ND_tan_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'tan' (NG_tan/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/tangent_default/tangent_default.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_tangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_acos_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_atan2_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'atan2' (NG_tangent_default/azimuth) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'acos' (NG_tangent_default/polar) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'magnitude' (NG_tangent_default/mag_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/tangent_model/tangent_model.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_tangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_acos_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_atan2_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'atan2' (NG_tangent_model/azimuth) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'acos' (NG_tangent_model/polar) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'magnitude' (NG_tangent_model/mag_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/tangent_model_axis_x/tangent_model_axis_x.mtlx

Status: incomplete

- warning: NodeDef 'ND_tangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'tangent' (NG_tangent_model_axis_x/tangent0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/tangent_model_axis_y/tangent_model_axis_y.mtlx

Status: incomplete

- warning: NodeDef 'ND_tangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'tangent' (NG_tangent_model_axis_y/tangent0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/tangent_object/tangent_object.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_tangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_acos_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_atan2_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'atan2' (NG_tangent_object/azimuth) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'acos' (NG_tangent_object/polar) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'magnitude' (NG_tangent_object/mag_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/tangent_object_axis_x/tangent_object_axis_x.mtlx

Status: incomplete

- warning: NodeDef 'ND_tangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'tangent' (NG_tangent_object_axis_x/tangent0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/tangent_object_axis_y/tangent_object_axis_y.mtlx

Status: incomplete

- warning: NodeDef 'ND_tangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'tangent' (NG_tangent_object_axis_y/tangent0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/tangent_object_axis_z/tangent_object_axis_z.mtlx

Status: incomplete

- warning: NodeDef 'ND_tangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'tangent' (NG_tangent_object_axis_z/tangent0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/tangent_world/tangent_world.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_tangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_acos_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_atan2_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'atan2' (NG_tangent_world/azimuth) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'acos' (NG_tangent_world/polar) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'magnitude' (NG_tangent_world/mag_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/tangent_world_axis_x/tangent_world_axis_x.mtlx

Status: incomplete

- warning: NodeDef 'ND_tangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'tangent' (NG_tangent_world_axis_x/tangent0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/tangent_world_axis_y/tangent_world_axis_y.mtlx

Status: incomplete

- warning: NodeDef 'ND_tangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'tangent' (NG_tangent_world_axis_y/tangent0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/tangent_world_axis_z/tangent_world_axis_z.mtlx

Status: incomplete

- warning: NodeDef 'ND_tangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'tangent' (NG_tangent_world_axis_z/tangent0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/texcoord/texcoord.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'magnitude' (NG_texcoord/mag_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/time/time.mtlx

Status: incomplete

- warning: NodeDef 'ND_time_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'time' (NG_time/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/transformnormal/transformnormal.mtlx

Status: incomplete

- warning: NodeDef 'ND_transformnormal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'transformnormal' (NG_transformnormal/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/transformpoint/transformpoint.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_transformpoint_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'magnitude' (NG_transformpoint/mag_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/transformvector/transformvector.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_transformvector_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'magnitude' (NG_transformvector/mag_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/transpose/transpose.mtlx

Status: incomplete

- warning: NodeDef 'ND_determinant_matrix33' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_transpose_matrix33' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'determinant' (NG_transpose/det_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/tangent_model_axis_z/tangent_model_axis_z.mtlx

Status: incomplete

- warning: NodeDef 'ND_tangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'tangent' (NG_tangent_model_axis_z/tangent0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise2d/unifiednoise2d.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise2d' (NG_unifiednoise2d/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise2d_defaults/unifiednoise2d_defaults.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise2d' (NG_unifiednoise2d_defaults/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise2d_large_coords/unifiednoise2d_large_coords.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise2d' (NG_unifiednoise2d_large_coords/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise2d_omit_clampoutput/unifiednoise2d_omit_clampoutput.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise2d' (NG_unifiednoise2d_omit_clampoutput/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise2d_omit_diminish/unifiednoise2d_omit_diminish.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise2d' (NG_unifiednoise2d_omit_diminish/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise2d_omit_freq/unifiednoise2d_omit_freq.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise2d' (NG_unifiednoise2d_omit_freq/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise2d_omit_jitter/unifiednoise2d_omit_jitter.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise2d' (NG_unifiednoise2d_omit_jitter/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise2d_omit_lacunarity/unifiednoise2d_omit_lacunarity.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise2d' (NG_unifiednoise2d_omit_lacunarity/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise2d_omit_octaves/unifiednoise2d_omit_octaves.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise2d' (NG_unifiednoise2d_omit_octaves/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise2d_omit_offset/unifiednoise2d_omit_offset.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise2d' (NG_unifiednoise2d_omit_offset/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise2d_omit_outmax/unifiednoise2d_omit_outmax.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise2d' (NG_unifiednoise2d_omit_outmax/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise2d_omit_outmin/unifiednoise2d_omit_outmin.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise2d' (NG_unifiednoise2d_omit_outmin/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise2d_omit_style/unifiednoise2d_omit_style.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise2d' (NG_unifiednoise2d_omit_style/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise2d_omit_texcoord/unifiednoise2d_omit_texcoord.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise2d' (NG_unifiednoise2d_omit_texcoord/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise2d_omit_type/unifiednoise2d_omit_type.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise2d' (NG_unifiednoise2d_omit_type/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise2d_style0/unifiednoise2d_style0.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise2d' (NG_unifiednoise2d_style0/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise2d_style1/unifiednoise2d_style1.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise2d' (NG_unifiednoise2d_style1/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise2d_type0/unifiednoise2d_type0.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise2d' (NG_unifiednoise2d_type0/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise2d_type1/unifiednoise2d_type1.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise2d' (NG_unifiednoise2d_type1/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise2d_type2/unifiednoise2d_type2.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise2d' (NG_unifiednoise2d_type2/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise2d_type3/unifiednoise2d_type3.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise2d' (NG_unifiednoise2d_type3/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise3d/unifiednoise3d.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise3d' (NG_unifiednoise3d/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise3d_defaults/unifiednoise3d_defaults.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise3d' (NG_unifiednoise3d_defaults/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise3d_large_coords/unifiednoise3d_large_coords.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise3d' (NG_unifiednoise3d_large_coords/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise3d_omit_clampoutput/unifiednoise3d_omit_clampoutput.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise3d' (NG_unifiednoise3d_omit_clampoutput/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise3d_omit_diminish/unifiednoise3d_omit_diminish.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise3d' (NG_unifiednoise3d_omit_diminish/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise3d_omit_freq/unifiednoise3d_omit_freq.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise3d' (NG_unifiednoise3d_omit_freq/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise3d_omit_jitter/unifiednoise3d_omit_jitter.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise3d' (NG_unifiednoise3d_omit_jitter/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise3d_omit_lacunarity/unifiednoise3d_omit_lacunarity.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise3d' (NG_unifiednoise3d_omit_lacunarity/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise3d_omit_octaves/unifiednoise3d_omit_octaves.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise3d' (NG_unifiednoise3d_omit_octaves/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise3d_omit_offset/unifiednoise3d_omit_offset.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise3d' (NG_unifiednoise3d_omit_offset/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise3d_omit_outmax/unifiednoise3d_omit_outmax.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise3d' (NG_unifiednoise3d_omit_outmax/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise3d_omit_outmin/unifiednoise3d_omit_outmin.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise3d' (NG_unifiednoise3d_omit_outmin/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise3d_omit_position/unifiednoise3d_omit_position.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise3d' (NG_unifiednoise3d_omit_position/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise3d_omit_style/unifiednoise3d_omit_style.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise3d' (NG_unifiednoise3d_omit_style/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise3d_omit_type/unifiednoise3d_omit_type.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise3d' (NG_unifiednoise3d_omit_type/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise3d_style0/unifiednoise3d_style0.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise3d' (NG_unifiednoise3d_style0/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise3d_style1/unifiednoise3d_style1.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise3d' (NG_unifiednoise3d_style1/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise3d_type0/unifiednoise3d_type0.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise3d' (NG_unifiednoise3d_type0/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise3d_type1/unifiednoise3d_type1.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise3d' (NG_unifiednoise3d_type1/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise3d_type2/unifiednoise3d_type2.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise3d' (NG_unifiednoise3d_type2/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unifiednoise3d_type3/unifiednoise3d_type3.mtlx

Status: incomplete

- warning: Upstream node 'unifiednoise3d' (NG_unifiednoise3d_type3/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/unpremult/unpremult.mtlx

Status: incomplete

- warning: NodeDef 'ND_unpremult_color4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_combine4_color4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'unpremult' (NG_unpremult/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/viewdirection/viewdirection.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Unresolved NodeDef for node 'viewdirection' (NG_viewdirection/node_under_test).
- warning: NodeDef 'ND_acos_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_atan2_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'atan2' (NG_viewdirection/azimuth) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'acos' (NG_viewdirection/polar) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'magnitude' (NG_viewdirection/mag_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/viewdirection_space_model/viewdirection_space_model.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Unresolved NodeDef for node 'viewdirection' (NG_viewdirection_space_model/node_under_test).
- warning: NodeDef 'ND_acos_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_atan2_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'atan2' (NG_viewdirection_space_model/azimuth) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'acos' (NG_viewdirection_space_model/polar) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'magnitude' (NG_viewdirection_space_model/mag_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/viewdirection_space_object/viewdirection_space_object.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Unresolved NodeDef for node 'viewdirection' (NG_viewdirection_space_object/node_under_test).
- warning: NodeDef 'ND_acos_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_atan2_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'atan2' (NG_viewdirection_space_object/azimuth) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'acos' (NG_viewdirection_space_object/polar) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'magnitude' (NG_viewdirection_space_object/mag_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/viewdirection_space_world/viewdirection_space_world.mtlx

Status: incomplete

- warning: NodeDef 'ND_magnitude_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Unresolved NodeDef for node 'viewdirection' (NG_viewdirection_space_world/node_under_test).
- warning: NodeDef 'ND_acos_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_atan2_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'atan2' (NG_viewdirection_space_world/azimuth) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'acos' (NG_viewdirection_space_world/polar) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'magnitude' (NG_viewdirection_space_world/mag_0) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/worleynoise2d/worleynoise2d.mtlx

Status: incomplete

- warning: NodeDef 'ND_worleynoise2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'worleynoise2d' (NG_worleynoise2d/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/worleynoise2d_defaults/worleynoise2d_defaults.mtlx

Status: incomplete

- warning: NodeDef 'ND_worleynoise2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'worleynoise2d' (NG_worleynoise2d_defaults/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/worleynoise2d_large_coords/worleynoise2d_large_coords.mtlx

Status: incomplete

- warning: NodeDef 'ND_worleynoise2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'worleynoise2d' (NG_worleynoise2d_large_coords/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/worleynoise2d_omit_jitter/worleynoise2d_omit_jitter.mtlx

Status: incomplete

- warning: NodeDef 'ND_worleynoise2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'worleynoise2d' (NG_worleynoise2d_omit_jitter/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/worleynoise2d_omit_style/worleynoise2d_omit_style.mtlx

Status: incomplete

- warning: NodeDef 'ND_worleynoise2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'worleynoise2d' (NG_worleynoise2d_omit_style/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/worleynoise2d_omit_texcoord/worleynoise2d_omit_texcoord.mtlx

Status: incomplete

- warning: NodeDef 'ND_worleynoise2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'worleynoise2d' (NG_worleynoise2d_omit_texcoord/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/worleynoise2d_style_distance/worleynoise2d_style_distance.mtlx

Status: incomplete

- warning: NodeDef 'ND_worleynoise2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'worleynoise2d' (NG_worleynoise2d_style_distance/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/worleynoise2d_style_solid/worleynoise2d_style_solid.mtlx

Status: incomplete

- warning: NodeDef 'ND_worleynoise2d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'worleynoise2d' (NG_worleynoise2d_style_solid/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/worleynoise2d_vector2/worleynoise2d_vector2.mtlx

Status: incomplete

- warning: NodeDef 'ND_worleynoise2d_vector2' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'worleynoise2d' (NG_worleynoise2d_vector2/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/worleynoise2d_vector3/worleynoise2d_vector3.mtlx

Status: incomplete

- warning: NodeDef 'ND_worleynoise2d_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'worleynoise2d' (NG_worleynoise2d_vector3/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/worleynoise3d/worleynoise3d.mtlx

Status: incomplete

- warning: NodeDef 'ND_worleynoise3d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'worleynoise3d' (NG_worleynoise3d/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/worleynoise3d_defaults/worleynoise3d_defaults.mtlx

Status: incomplete

- warning: NodeDef 'ND_worleynoise3d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'worleynoise3d' (NG_worleynoise3d_defaults/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/worleynoise3d_large_coords/worleynoise3d_large_coords.mtlx

Status: incomplete

- warning: NodeDef 'ND_worleynoise3d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'worleynoise3d' (NG_worleynoise3d_large_coords/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/worleynoise3d_omit_jitter/worleynoise3d_omit_jitter.mtlx

Status: incomplete

- warning: NodeDef 'ND_worleynoise3d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'worleynoise3d' (NG_worleynoise3d_omit_jitter/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/worleynoise3d_omit_position/worleynoise3d_omit_position.mtlx

Status: incomplete

- warning: NodeDef 'ND_worleynoise3d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'worleynoise3d' (NG_worleynoise3d_omit_position/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/worleynoise3d_omit_style/worleynoise3d_omit_style.mtlx

Status: incomplete

- warning: NodeDef 'ND_worleynoise3d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'worleynoise3d' (NG_worleynoise3d_omit_style/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/worleynoise3d_style_distance/worleynoise3d_style_distance.mtlx

Status: incomplete

- warning: NodeDef 'ND_worleynoise3d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'worleynoise3d' (NG_worleynoise3d_style_distance/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/worleynoise3d_style_solid/worleynoise3d_style_solid.mtlx

Status: incomplete

- warning: NodeDef 'ND_worleynoise3d_float' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'worleynoise3d' (NG_worleynoise3d_style_solid/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/worleynoise3d_vector2/worleynoise3d_vector2.mtlx

Status: incomplete

- warning: NodeDef 'ND_worleynoise3d_vector2' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'worleynoise3d' (NG_worleynoise3d_vector2/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/nodes/worleynoise3d_vector3/worleynoise3d_vector3.mtlx

Status: incomplete

- warning: NodeDef 'ND_worleynoise3d_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'worleynoise3d' (NG_worleynoise3d_vector3/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/gltf_pbr/boombox/boombox.mtlx

Status: failed

- warning: Input 'gltf_pbr.base_color' is driven by unsupported node 'gltf_colorimage' (image_basecolor); its contribution would be lost (REQ-013).
- warning: Input 'gltf_pbr.normal' is driven by unsupported node 'gltf_normalmap' (image_normal); its contribution would be lost (REQ-013).
- warning: Input 'gltf_pbr.alpha' is driven by unsupported node 'gltf_colorimage' (image_basecolor); its contribution would be lost (REQ-013).
- warning: Input 'gltf_pbr.emissive' is driven by unsupported node 'gltf_image' (image_emission); its contribution would be lost (REQ-013).
- warning: Upstream node 'gltf_colorimage' (image_basecolor) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'gltf_image' (image_orm) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'gltf_normalmap' (image_normal) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'gltf_image' (image_emission) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- Material_boombox/raster (855:13): cannot assign 'vec3<f32>' to 'f32'
- Material_boombox/pathtracing (1229:13): cannot assign 'vec3<f32>' to 'f32'

### scenes/mtlx-library/surfaces/gltf_pbr/feature_normal_space_model/feature_normal_space_model.mtlx

Status: incomplete

- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'normal' (surface_normal) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/gltf_pbr/feature_normal_space_object/feature_normal_space_object.mtlx

Status: incomplete

- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'normal' (surface_normal) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/gltf_pbr/feature_normal_space_world/feature_normal_space_world.mtlx

Status: incomplete

- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'normal' (surface_normal) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/gltf_pbr/gltf_colorimage/gltf_colorimage.mtlx

Status: incomplete

- warning: NodeDef 'ND_combine4_color4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'gltf_colorimage' (NG_gltf_colorimage_sample/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/gltf_pbr/gltf_image/gltf_image.mtlx

Status: incomplete

- warning: Upstream node 'gltf_image' (NG_gltf_image/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/gltf_pbr/gltf_iridescence_thickness/gltf_iridescence_thickness.mtlx

Status: incomplete

- warning: Input 'gltf_pbr.iridescence_thickness' is driven by unsupported node 'gltf_iridescence_thickness' (NG_gltf_iridescence_thickness/node_under_test); its contribution would be lost (REQ-013).
- warning: Unknown input 'ior' on 'gltf_pbr' surface (SR_gltf_iridescence_thickness); not part of the nodedef interface and ignored (REQ-013).
- warning: Unknown input 'iridescence_ior' on 'gltf_pbr' surface (SR_gltf_iridescence_thickness); not part of the nodedef interface and ignored (REQ-013).
- warning: Upstream node 'gltf_iridescence_thickness' (NG_gltf_iridescence_thickness/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/gltf_pbr/gltf_normalmap/gltf_normalmap.mtlx

Status: incomplete

- warning: Upstream node 'gltf_normalmap' (NG_gltf_normalmap/node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/gltf_pbr/heighttonormal_normal_input/heighttonormal_normal_input.mtlx

Status: incomplete

- warning: NodeDef 'ND_heighttonormal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'heighttonormal' (NG_heighttonormal_normal_input/height_to_normal) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/gltf_pbr/input_alpha_mode_mask/input_alpha_mode_mask.mtlx

Status: incomplete

- warning: Input 'gltf_pbr.alpha' is driven by unsupported node 'circle' (NG_input_alpha_mode_mask/alpha_mask); its contribution would be lost (REQ-013).
- warning: Unknown input 'alpha_mode' on 'gltf_pbr' surface (SR_default); not part of the nodedef interface and ignored (REQ-013).
- warning: Unknown input 'alpha_cutoff' on 'gltf_pbr' surface (SR_default); not part of the nodedef interface and ignored (REQ-013).
- warning: Upstream node 'circle' (NG_input_alpha_mode_mask/alpha_mask) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/open_pbr_surface/coat_color_variation/coat_color_variation.mtlx

Status: failed (Error: Inspected target navigated or closed)


### scenes/mtlx-library/surfaces/open_pbr_surface/feature_geometry_normal_space_model/feature_geometry_normal_space_model.mtlx

Status: incomplete

- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'normal' (surface_normal) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/open_pbr_surface/feature_geometry_normal_space_object/feature_geometry_normal_space_object.mtlx

Status: incomplete

- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'normal' (surface_normal) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/open_pbr_surface/feature_geometry_normal_space_world/feature_geometry_normal_space_world.mtlx

Status: incomplete

- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'normal' (surface_normal) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/open_pbr_surface/heighttonormal_normal_input/heighttonormal_normal_input.mtlx

Status: incomplete

- warning: NodeDef 'ND_heighttonormal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'heighttonormal' (NG_heighttonormal_normal_input/height_to_normal) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/open_pbr_surface/node_open_pbr_anisotropy/material.mtlx

Status: incomplete

- warning: Input 'open_pbr_surface.specular_roughness' is driven by unsupported node 'separate2' (aniso_split); its contribution would be lost (REQ-013).
- warning: Input 'open_pbr_surface.specular_roughness_anisotropy' is driven by unsupported node 'separate2' (aniso_split); its contribution would be lost (REQ-013).
- warning: Upstream node 'open_pbr_anisotropy' (node_under_test) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/open_pbr_surface/opacity_mask/opacity_mask.mtlx

Status: incomplete

- warning: Input 'open_pbr_surface.geometry_opacity' is driven by unsupported node 'ifgreater' (NG_opacity_mask/opacity_mask); its contribution would be lost (REQ-013).

### scenes/mtlx-library/surfaces/standard_surface/feature_normal_space_model/feature_normal_space_model.mtlx

Status: incomplete

- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'normal' (surface_normal) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/standard_surface/feature_normal_space_object/feature_normal_space_object.mtlx

Status: incomplete

- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'normal' (surface_normal) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/standard_surface/feature_normal_space_world/feature_normal_space_world.mtlx

Status: incomplete

- warning: NodeDef 'ND_normal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'normal' (surface_normal) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/standard_surface/graph_normal_from_height/graph_normal_from_height.mtlx

Status: incomplete

- warning: NodeDef 'ND_heighttonormal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'heighttonormal' (height_to_normal_example/height_to_normal) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/standard_surface/greysphere_calibration/greysphere_calibration.mtlx

Status: incomplete

- warning: Upstream node 'place2d' (NG_Greysphere_Calibration/place2d) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/standard_surface/heighttonormal_normal_input/heighttonormal_normal_input.mtlx

Status: incomplete

- warning: NodeDef 'ND_heighttonormal_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'heighttonormal' (height_to_normal_normal/height_to_normal) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/standard_surface/logic_composite_nodes/logic_composite_nodes.mtlx

Status: failed

- warning: NodeDef 'ND_logical_or' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_logical_and' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_unpremult_color4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_combine4_color4' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_dodge_color3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_burn_color3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_difference_color3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: NodeDef 'ND_minus_color3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Upstream node 'colorcorrect' (NG_logic_composite_nodes/corrected) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'unpremult' (NG_logic_composite_nodes/unpremult_color) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'xor' (NG_logic_composite_nodes/logic_xor) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- M_logic_composite_nodes/raster (846:12): no matching call to 'mix(vec3<f32>, vec3<f32>, bool)'
- M_logic_composite_nodes/pathtracing (1220:12): no matching call to 'mix(vec3<f32>, vec3<f32>, bool)'

### scenes/mtlx-library/surfaces/standard_surface/ramp_multicolor/ramp_multicolor.mtlx

Status: incomplete

- warning: Upstream node 'ramp' (NG_ramp_multicolor_test/multicolor_ramp) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/standard_surface/ramp4_bilinear/ramp4_bilinear.mtlx

Status: incomplete

- warning: Input 'standard_surface.base_color' is driven by unsupported node 'ramp4' (NG_ramp4_bilinear_test/bilinear_ramp); its contribution would be lost (REQ-013).
- warning: Upstream node 'ramp4' (NG_ramp4_bilinear_test/bilinear_ramp) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).

### scenes/mtlx-library/surfaces/standard_surface/showcase_graph_pbr_helpers/showcase_graph_pbr_helpers.mtlx

Status: failed

- warning: NodeDef 'ND_tangent_vector3' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Unresolved NodeDef for node 'viewdirection' (NG_pbr_helper_nodes/view_ws).
- warning: Unresolved NodeDef for node 'luminance' (NG_pbr_helper_nodes/ext_luma).
- warning: Unresolved NodeDef for node 'luminance' (NG_pbr_helper_nodes/ior_luma).
- warning: NodeDef 'ND_blackbody' has no implementation for target '<any>'; explicit WGSL lowering required.
- warning: Input 'standard_surface.specular_roughness' is driven by unsupported node 'separate2' (NG_pbr_helper_nodes/aniso_channels); its contribution would be lost (REQ-013).
- warning: Input 'standard_surface.normal' is driven by unsupported node 'bump' (NG_pbr_helper_nodes/bump_n); its contribution would be lost (REQ-013).
- warning: Upstream node 'blackbody' (NG_pbr_helper_nodes/bb_color) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'open_pbr_anisotropy' (NG_pbr_helper_nodes/aniso_pair) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'separate2' (NG_pbr_helper_nodes/aniso_channels) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- warning: Upstream node 'bump' (NG_pbr_helper_nodes/bump_n) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).
- showcase_graph_pbr_helpers/raster (867:13): no matching constructor for 'vec3<f32>(vec3<f32>, vec3<f32>, f32)'
- showcase_graph_pbr_helpers/pathtracing (1241:13): no matching constructor for 'vec3<f32>(vec3<f32>, vec3<f32>, f32)'

### scenes/mtlx-library/surfaces/standard_surface/texture_opacity/texture_opacity.mtlx

Status: failed

- mat_texture_opacity_test/raster (862:17): cannot index into expression of type 'f32'
- mat_texture_opacity_test/pathtracing (1236:17): cannot index into expression of type 'f32'

