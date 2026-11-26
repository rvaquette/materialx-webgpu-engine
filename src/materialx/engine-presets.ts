export const ENGINE_PRESET_LIBRARY_XML = `
  <nodedef name="ND_engine_water" node="water" doc="Reusable animated water surface with wave displacement, crest foam, transmission and detail normals.">
    <input name="speed" type="float" value="0.5" uimin="0" uimax="4" />
    <input name="scale" type="float" value="1.5" uimin="0.1" uimax="12" />
    <input name="waveHeight" type="float" value="0.12" uimin="0" uimax="1" />
    <input name="color" type="color3" value="0.025, 0.16, 0.2" />
    <input name="foamColor" type="color3" value="0.8, 0.92, 0.9" />
    <input name="absorptionColor" type="color3" value="0.015, 0.08, 0.12" />
    <input name="depth" type="float" value="2" uimin="0.01" uimax="20" />
    <input name="roughness" type="float" value="0.08" uimin="0" uimax="1" />
    <input name="ior" type="float" value="1.333" uimin="1" uimax="2.5" />
    <output name="out" type="surfaceshader" />
    <output name="displacement" type="displacementshader" />
  </nodedef>
  <nodegraph name="NG_engine_water" nodedef="ND_engine_water">
    <position name="position" type="vector3"><input name="space" type="string" value="object" /></position>
    <separate3 name="coordinates" type="multioutput" nodedef="ND_separate3_vector3"><input name="in" type="vector3" nodename="position" /></separate3>
    <time name="clock" type="float" nodedef="ND_time_float" />
    <multiply name="phase" type="float"><input name="in1" type="float" nodename="clock" /><input name="in2" type="float" interfacename="speed" /></multiply>
    <multiply name="xScaled" type="float"><input name="in1" type="float" nodename="coordinates" output="outx" /><input name="in2" type="float" interfacename="scale" /></multiply>
    <multiply name="zScaled" type="float"><input name="in1" type="float" nodename="coordinates" output="outz" /><input name="in2" type="float" interfacename="scale" /></multiply>
    <add name="xPhase" type="float"><input name="in1" type="float" nodename="xScaled" /><input name="in2" type="float" nodename="phase" /></add>
    <multiply name="zFrequency" type="float"><input name="in1" type="float" nodename="zScaled" /><input name="in2" type="float" value="1.7" /></multiply>
    <multiply name="zTime" type="float"><input name="in1" type="float" nodename="phase" /><input name="in2" type="float" value="1.3" /></multiply>
    <add name="zPhase" type="float"><input name="in1" type="float" nodename="zFrequency" /><input name="in2" type="float" nodename="zTime" /></add>
    <sin name="xWave" type="float"><input name="in" type="float" nodename="xPhase" /></sin>
    <sin name="zWave" type="float"><input name="in" type="float" nodename="zPhase" /></sin>
    <multiply name="smallWave" type="float"><input name="in1" type="float" nodename="zWave" /><input name="in2" type="float" value="0.45" /></multiply>
    <add name="largeWaves" type="float"><input name="in1" type="float" nodename="xWave" /><input name="in2" type="float" nodename="smallWave" /></add>
    <multiply name="crossX" type="float"><input name="in1" type="float" nodename="xScaled" /><input name="in2" type="float" value="2.3" /></multiply>
    <multiply name="crossZ" type="float"><input name="in1" type="float" nodename="zScaled" /><input name="in2" type="float" value="-1.7" /></multiply>
    <add name="crossPosition" type="float"><input name="in1" type="float" nodename="crossX" /><input name="in2" type="float" nodename="crossZ" /></add>
    <multiply name="crossTime" type="float"><input name="in1" type="float" nodename="phase" /><input name="in2" type="float" value="1.9" /></multiply>
    <add name="crossPhase" type="float"><input name="in1" type="float" nodename="crossPosition" /><input name="in2" type="float" nodename="crossTime" /></add>
    <sin name="crossWave" type="float"><input name="in" type="float" nodename="crossPhase" /></sin>
    <multiply name="crossAmplitude" type="float"><input name="in1" type="float" nodename="crossWave" /><input name="in2" type="float" value="0.18" /></multiply>
    <add name="waveSum" type="float"><input name="in1" type="float" nodename="largeWaves" /><input name="in2" type="float" nodename="crossAmplitude" /></add>
    <multiply name="waveHeightValue" type="float"><input name="in1" type="float" nodename="waveSum" /><input name="in2" type="float" interfacename="waveHeight" /></multiply>
    <displacement name="waveDisplacement" type="displacementshader"><input name="displacement" type="float" nodename="waveHeightValue" /></displacement>
    <smoothstep name="foamMask" type="float"><input name="in" type="float" nodename="waveSum" /><input name="low" type="float" value="0.7" /><input name="high" type="float" value="1.1" /></smoothstep>
    <mix name="surfaceColor" type="color3"><input name="fg" type="color3" interfacename="foamColor" /><input name="bg" type="color3" interfacename="color" /><input name="mix" type="float" nodename="foamMask" /></mix>
    <combine3 name="detailOffset" type="vector3"><input name="in1" type="float" nodename="phase" /><input name="in2" type="float" value="0" /><input name="in3" type="float" nodename="crossTime" /></combine3>
    <add name="detailPosition" type="vector3"><input name="in1" type="vector3" nodename="position" /><input name="in2" type="vector3" nodename="detailOffset" /></add>
    <multiply name="detailScale" type="vector3"><input name="in1" type="vector3" nodename="detailPosition" /><input name="in2" type="vector3" value="8, 8, 8" /></multiply>
    <noise3d name="detailNoise" type="float" nodedef="ND_noise3d_float"><input name="position" type="vector3" nodename="detailScale" /><input name="amplitude" type="float" value="1" /><input name="pivot" type="float" value="0" /></noise3d>
    <bump name="detailNormal" type="vector3" nodedef="ND_bump_vector3"><input name="height" type="float" nodename="detailNoise" /><input name="scale" type="float" value="0.025" /></bump>
    <subtract name="transmissionWeight" type="float"><input name="in1" type="float" value="1" /><input name="in2" type="float" nodename="foamMask" /></subtract>
    <mix name="waterRoughness" type="float"><input name="fg" type="float" value="0.4" /><input name="bg" type="float" interfacename="roughness" /><input name="mix" type="float" nodename="foamMask" /></mix>
    <standard_surface name="waterSurface" type="surfaceshader">
      <input name="base" type="float" nodename="foamMask" />
      <input name="base_color" type="color3" nodename="surfaceColor" />
      <input name="specular_roughness" type="float" nodename="waterRoughness" />
      <input name="specular_IOR" type="float" interfacename="ior" />
      <input name="transmission" type="float" nodename="transmissionWeight" />
      <input name="transmission_color" type="color3" interfacename="absorptionColor" />
      <input name="transmission_depth" type="float" interfacename="depth" />
      <input name="normal" type="vector3" nodename="detailNormal" />
    </standard_surface>
    <output name="out" type="surfaceshader" nodename="waterSurface" />
    <output name="displacement" type="displacementshader" nodename="waveDisplacement" />
  </nodegraph>

  <nodedef name="ND_engine_water_caustics" node="water_caustics" doc="Animated procedural caustic projection for a pool floor; a practical raster and path-tracing approximation.">
    <input name="color" type="color3" value="0.18, 0.78, 0.92" />
    <input name="scale" type="float" value="4" uimin="0.1" uimax="16" />
    <input name="speed" type="float" value="0.15" uimin="0" uimax="2" />
    <input name="intensity" type="float" value="2" uimin="0" uimax="12" />
    <output name="out" type="surfaceshader" />
    <output name="displacement" type="displacementshader" />
  </nodedef>
  <nodegraph name="NG_engine_water_caustics" nodedef="ND_engine_water_caustics">
    <position name="position" type="vector3"><input name="space" type="string" value="object" /></position>
    <time name="clock" type="float" nodedef="ND_time_float" />
    <multiply name="flow" type="float"><input name="in1" type="float" nodename="clock" /><input name="in2" type="float" interfacename="speed" /></multiply>
    <combine3 name="flowOffset" type="vector3"><input name="in1" type="float" value="0" /><input name="in2" type="float" nodename="flow" /><input name="in3" type="float" nodename="flow" /></combine3>
    <add name="advectedPosition" type="vector3"><input name="in1" type="vector3" nodename="position" /><input name="in2" type="vector3" nodename="flowOffset" /></add>
    <multiply name="scaledPosition" type="vector3"><input name="in1" type="vector3" nodename="advectedPosition" /><input name="in2" type="float" interfacename="scale" /></multiply>
    <worleynoise3d name="distances" type="vector2" nodedef="ND_worleynoise3d_vector2"><input name="position" type="vector3" nodename="scaledPosition" /><input name="style" type="integer" value="0" /><input name="jitter" type="float" value="0.8" /></worleynoise3d>
    <separate2 name="cellDistances" type="multioutput" nodedef="ND_separate2_vector2"><input name="in" type="vector2" nodename="distances" /></separate2>
    <subtract name="cells" type="float"><input name="in1" type="float" nodename="cellDistances" output="outy" /><input name="in2" type="float" nodename="cellDistances" output="outx" /></subtract>
    <smoothstep name="causticEdge" type="float"><input name="in" type="float" nodename="cells" /><input name="low" type="float" value="0.025" /><input name="high" type="float" value="0.13" /></smoothstep>
    <subtract name="causticMask" type="float"><input name="in1" type="float" value="1" /><input name="in2" type="float" nodename="causticEdge" /></subtract>
    <multiply name="glow" type="float"><input name="in1" type="float" nodename="causticMask" /><input name="in2" type="float" interfacename="intensity" /></multiply>
    <standard_surface name="causticSurface" type="surfaceshader">
      <input name="base" type="float" value="0" />
      <input name="emission" type="float" nodename="glow" />
      <input name="emission_color" type="color3" interfacename="color" />
    </standard_surface>
    <output name="out" type="surfaceshader" nodename="causticSurface" />
    <displacement name="causticsDisplacement" type="displacementshader"><input name="displacement" type="float" value="0" /></displacement>
    <output name="displacement" type="displacementshader" nodename="causticsDisplacement" />
  </nodegraph>

  <nodedef name="ND_engine_lava" node="lava" doc="Reusable animated cracked lava with blackbody fissures and procedural crust displacement.">
    <input name="speed" type="float" value="0.18" uimin="0" uimax="2" />
    <input name="scale" type="float" value="3" uimin="0.1" uimax="12" />
    <input name="crustColor" type="color3" value="0.035, 0.018, 0.012" />
    <input name="temperature" type="float" value="1800" uimin="800" uimax="4000" />
    <input name="emission" type="float" value="4" uimin="0" uimax="30" />
    <input name="relief" type="float" value="0.16" uimin="0" uimax="1" />
    <output name="out" type="surfaceshader" />
    <output name="displacement" type="displacementshader" />
  </nodedef>
  <nodegraph name="NG_engine_lava" nodedef="ND_engine_lava">
    <position name="position" type="vector3"><input name="space" type="string" value="object" /></position>
    <time name="clock" type="float" nodedef="ND_time_float" />
    <multiply name="flow" type="float"><input name="in1" type="float" nodename="clock" /><input name="in2" type="float" interfacename="speed" /></multiply>
    <combine3 name="flowOffset" type="vector3"><input name="in1" type="float" value="0" /><input name="in2" type="float" nodename="flow" /><input name="in3" type="float" value="0" /></combine3>
    <add name="advectedPosition" type="vector3"><input name="in1" type="vector3" nodename="position" /><input name="in2" type="vector3" nodename="flowOffset" /></add>
    <multiply name="scaledPosition" type="vector3"><input name="in1" type="vector3" nodename="advectedPosition" /><input name="in2" type="float" interfacename="scale" /></multiply>
    <worleynoise3d name="distances" type="vector2" nodedef="ND_worleynoise3d_vector2"><input name="position" type="vector3" nodename="scaledPosition" /><input name="style" type="integer" value="0" /><input name="jitter" type="float" value="0.8" /></worleynoise3d>
    <separate2 name="cellDistances" type="multioutput" nodedef="ND_separate2_vector2"><input name="in" type="vector2" nodename="distances" /></separate2>
    <subtract name="cells" type="float"><input name="in1" type="float" nodename="cellDistances" output="outy" /><input name="in2" type="float" nodename="cellDistances" output="outx" /></subtract>
    <smoothstep name="crackEdge" type="float"><input name="in" type="float" nodename="cells" /><input name="low" type="float" value="0.04" /><input name="high" type="float" value="0.16" /></smoothstep>
    <subtract name="crackMask" type="float"><input name="in1" type="float" value="1" /><input name="in2" type="float" nodename="crackEdge" /></subtract>
    <blackbody name="hotColor" type="color3" nodedef="ND_blackbody"><input name="temperature" type="float" interfacename="temperature" /></blackbody>
    <mix name="surfaceColor" type="color3"><input name="fg" type="color3" nodename="hotColor" /><input name="bg" type="color3" interfacename="crustColor" /><input name="mix" type="float" nodename="crackMask" /></mix>
    <multiply name="glow" type="float"><input name="in1" type="float" nodename="crackMask" /><input name="in2" type="float" interfacename="emission" /></multiply>
    <multiply name="crustRelief" type="float"><input name="in1" type="float" nodename="crackEdge" /><input name="in2" type="float" interfacename="relief" /></multiply>
    <displacement name="crustDisplacement" type="displacementshader"><input name="displacement" type="float" nodename="crustRelief" /></displacement>
    <multiply name="grainPosition" type="vector3"><input name="in1" type="vector3" nodename="scaledPosition" /><input name="in2" type="float" value="5" /></multiply>
    <noise3d name="crustGrain" type="float" nodedef="ND_noise3d_float"><input name="position" type="vector3" nodename="grainPosition" /></noise3d>
    <multiply name="grainHeight" type="float"><input name="in1" type="float" nodename="crustGrain" /><input name="in2" type="float" value="0.15" /></multiply>
    <add name="crustHeight" type="float"><input name="in1" type="float" nodename="crackEdge" /><input name="in2" type="float" nodename="grainHeight" /></add>
    <bump name="crustNormal" type="vector3" nodedef="ND_bump_vector3"><input name="height" type="float" nodename="crustHeight" /><input name="scale" type="float" interfacename="relief" /></bump>
    <mix name="crustRoughness" type="float"><input name="fg" type="float" value="0.25" /><input name="bg" type="float" value="0.85" /><input name="mix" type="float" nodename="crackMask" /></mix>
    <standard_surface name="lavaSurface" type="surfaceshader">
      <input name="base_color" type="color3" nodename="surfaceColor" />
      <input name="specular_roughness" type="float" nodename="crustRoughness" />
      <input name="normal" type="vector3" nodename="crustNormal" />
      <input name="emission" type="float" nodename="glow" />
      <input name="emission_color" type="color3" nodename="hotColor" />
    </standard_surface>
    <output name="out" type="surfaceshader" nodename="lavaSurface" />
    <output name="displacement" type="displacementshader" nodename="crustDisplacement" />
  </nodegraph>

  <nodedef name="ND_engine_fire" node="fire" doc="Animated procedural fire volume with height-attenuated density and blackbody emission.">
    <input name="density" type="float" value="2" uimin="0" uimax="10" />
    <input name="scale" type="float" value="3" uimin="0.1" uimax="12" />
    <input name="speed" type="float" value="0.7" uimin="0" uimax="4" />
    <input name="temperature" type="float" value="2400" uimin="800" uimax="10000" />
    <input name="emission" type="float" value="12" uimin="0" uimax="50" />
    <input name="radius" type="float" value="0.8" uimin="0.1" uimax="3" />
    <input name="centerHeight" type="float" value="1.7" doc="World-space height of the flame-volume center." />
    <input name="center" type="vector3" value="0, 0, 0" doc="World-space XZ center of the flame." />
    <output name="out" type="volumeshader" />
  </nodedef>
  <nodegraph name="NG_engine_fire" nodedef="ND_engine_fire">
    <position name="position" type="vector3"><input name="space" type="string" value="world" /></position>
    <separate3 name="coordinates" type="multioutput" nodedef="ND_separate3_vector3"><input name="in" type="vector3" nodename="shapePosition" /></separate3>
    <separate3 name="flameCenter" type="multioutput" nodedef="ND_separate3_vector3"><input name="in" type="vector3" interfacename="center" /></separate3>
    <subtract name="relativeX" type="float"><input name="in1" type="float" nodename="coordinates" output="outx" /><input name="in2" type="float" nodename="flameCenter" output="outx" /></subtract>
    <subtract name="relativeZ" type="float"><input name="in1" type="float" nodename="coordinates" output="outz" /><input name="in2" type="float" nodename="flameCenter" output="outz" /></subtract>
    <multiply name="xSquared" type="float"><input name="in1" type="float" nodename="relativeX" /><input name="in2" type="float" nodename="relativeX" /></multiply>
    <multiply name="zSquared" type="float"><input name="in1" type="float" nodename="relativeZ" /><input name="in2" type="float" nodename="relativeZ" /></multiply>
    <add name="radialSquared" type="float"><input name="in1" type="float" nodename="xSquared" /><input name="in2" type="float" nodename="zSquared" /></add>
    <sqrt name="radialDistance" type="float"><input name="in" type="float" nodename="radialSquared" /></sqrt>
    <subtract name="relativeHeight" type="float"><input name="in1" type="float" nodename="coordinates" output="outy" /><input name="in2" type="float" interfacename="centerHeight" /></subtract>
    <time name="clock" type="float" nodedef="ND_time_float" />
    <multiply name="rise" type="float"><input name="in1" type="float" nodename="clock" /><input name="in2" type="float" interfacename="speed" /></multiply>
    <combine3 name="riseOffset" type="vector3"><input name="in1" type="float" value="0" /><input name="in2" type="float" nodename="rise" /><input name="in3" type="float" value="0" /></combine3>
    <subtract name="advectedPosition" type="vector3"><input name="in1" type="vector3" nodename="position" /><input name="in2" type="vector3" nodename="riseOffset" /></subtract>
    <multiply name="warpPosition" type="vector3"><input name="in1" type="vector3" nodename="advectedPosition" /><input name="in2" type="float" value="1.2" /></multiply>
    <noise3d name="turbulence" type="vector3" nodedef="ND_noise3d_vector3"><input name="position" type="vector3" nodename="warpPosition" /><input name="amplitude" type="vector3" value="0.65, 0, 0.65" /></noise3d>
    <add name="shapePosition" type="vector3"><input name="in1" type="vector3" nodename="position" /><input name="in2" type="vector3" nodename="turbulence" /></add>
    <multiply name="scaledPosition" type="vector3"><input name="in1" type="vector3" nodename="advectedPosition" /><input name="in2" type="float" interfacename="scale" /></multiply>
    <noise3d name="flameNoise" type="float" nodedef="ND_noise3d_float"><input name="position" type="vector3" nodename="scaledPosition" /><input name="amplitude" type="float" value="1" /><input name="pivot" type="float" value="0" /></noise3d>
    <range name="noise01" type="float"><input name="in" type="float" nodename="flameNoise" /><input name="inlow" type="float" value="-0.12" /><input name="inhigh" type="float" value="0.28" /><input name="outlow" type="float" value="0" /><input name="outhigh" type="float" value="1" /><input name="doclamp" type="boolean" value="true" /></range>
    <range name="heightFade" type="float"><input name="in" type="float" nodename="relativeHeight" /><input name="inlow" type="float" value="-1.6" /><input name="inhigh" type="float" value="1.6" /><input name="outlow" type="float" value="1" /><input name="outhigh" type="float" value="0" /><input name="doclamp" type="boolean" value="true" /></range>
    <range name="radiusByHeight" type="float"><input name="in" type="float" nodename="relativeHeight" /><input name="inlow" type="float" value="-1.6" /><input name="inhigh" type="float" value="1.6" /><input name="outlow" type="float" value="1" /><input name="outhigh" type="float" value="0.12" /><input name="doclamp" type="boolean" value="true" /></range>
    <multiply name="radiusAtHeight" type="float"><input name="in1" type="float" interfacename="radius" /><input name="in2" type="float" nodename="radiusByHeight" /></multiply>
    <divide name="normalizedRadius" type="float"><input name="in1" type="float" nodename="radialDistance" /><input name="in2" type="float" nodename="radiusAtHeight" /></divide>
    <subtract name="insideFlame" type="float"><input name="in1" type="float" value="1" /><input name="in2" type="float" nodename="normalizedRadius" /></subtract>
    <smoothstep name="flameShape" type="float"><input name="in" type="float" nodename="insideFlame" /><input name="low" type="float" value="0.05" /><input name="high" type="float" value="0.65" /></smoothstep>
    <multiply name="heightDensity" type="float"><input name="in1" type="float" nodename="noise01" /><input name="in2" type="float" nodename="heightFade" /></multiply>
    <multiply name="flameDensity" type="float"><input name="in1" type="float" nodename="heightDensity" /><input name="in2" type="float" nodename="flameShape" /></multiply>
    <multiply name="densityValue" type="float"><input name="in1" type="float" nodename="flameDensity" /><input name="in2" type="float" interfacename="density" /></multiply>
    <combine3 name="scatterRgb" type="vector3"><input name="in1" type="float" nodename="densityValue" /><input name="in2" type="float" nodename="densityValue" /><input name="in3" type="float" nodename="densityValue" /></combine3>
    <multiply name="hotter" type="float"><input name="in1" type="float" nodename="relativeHeight" /><input name="in2" type="float" value="-450" /></multiply>
    <add name="kelvin" type="float"><input name="in1" type="float" interfacename="temperature" /><input name="in2" type="float" nodename="hotter" /></add>
    <blackbody name="fireColor" type="color3" nodedef="ND_blackbody"><input name="temperature" type="float" nodename="kelvin" /></blackbody>
    <multiply name="emissionValue" type="float"><input name="in1" type="float" nodename="densityValue" /><input name="in2" type="float" interfacename="emission" /></multiply>
    <multiply name="emissionColor" type="color3"><input name="in1" type="color3" nodename="fireColor" /><input name="in2" type="float" nodename="emissionValue" /></multiply>
    <uniform_edf name="edf" type="EDF"><input name="color" type="color3" nodename="emissionColor" /></uniform_edf>
    <anisotropic_vdf name="vdf" type="VDF"><input name="absorption" type="vector3" nodename="scatterRgb" /><input name="scattering" type="vector3" nodename="scatterRgb" /><input name="anisotropy" type="float" value="0.15" /></anisotropic_vdf>
    <volume name="fireVolume" type="volumeshader"><input name="vdf" type="VDF" nodename="vdf" /><input name="edf" type="EDF" nodename="edf" /></volume>
    <output name="out" type="volumeshader" nodename="fireVolume" />
  </nodegraph>

  <nodedef name="ND_engine_smoke" node="smoke" doc="Animated procedural scattering volume with controllable density, color, wind and anisotropy.">
    <input name="density" type="float" value="0.35" uimin="0" uimax="8" />
    <input name="scale" type="float" value="2.2" uimin="0.1" uimax="12" />
    <input name="speed" type="float" value="0.2" uimin="0" uimax="3" />
    <input name="wind" type="vector3" value="0.4, 1, 0.1" />
    <input name="spread" type="float" value="0.15" uimin="0" uimax="1" />
    <input name="center" type="vector3" value="0, 0, 0" doc="World-space XZ center of the plume." />
    <input name="albedo" type="float" value="0.92" uimin="0.05" uimax="1" />
    <input name="color" type="color3" value="0.55, 0.58, 0.62" />
    <input name="anisotropy" type="float" value="0.35" uimin="-0.95" uimax="0.95" />
    <output name="out" type="volumeshader" />
  </nodedef>
  <nodegraph name="NG_engine_smoke" nodedef="ND_engine_smoke">
    <position name="position" type="vector3"><input name="space" type="string" value="world" /></position>
    <time name="clock" type="float" nodedef="ND_time_float" />
    <multiply name="windOffset" type="vector3"><input name="in1" type="vector3" interfacename="wind" /><input name="in2" type="float" nodename="clock" /></multiply>
    <multiply name="advection" type="vector3"><input name="in1" type="vector3" nodename="windOffset" /><input name="in2" type="float" interfacename="speed" /></multiply>
    <subtract name="advectedPosition" type="vector3"><input name="in1" type="vector3" nodename="position" /><input name="in2" type="vector3" nodename="advection" /></subtract>
    <multiply name="warpPosition" type="vector3"><input name="in1" type="vector3" nodename="advectedPosition" /><input name="in2" type="float" value="0.9" /></multiply>
    <noise3d name="turbulence" type="vector3" nodedef="ND_noise3d_vector3"><input name="position" type="vector3" nodename="warpPosition" /><input name="amplitude" type="vector3" value="0.9, 0, 0.9" /></noise3d>
    <add name="shapePosition" type="vector3"><input name="in1" type="vector3" nodename="position" /><input name="in2" type="vector3" nodename="turbulence" /></add>
    <separate3 name="smokeCoordinates" type="multioutput" nodedef="ND_separate3_vector3"><input name="in" type="vector3" nodename="shapePosition" /></separate3>
    <separate3 name="advectedCoordinates" type="multioutput" nodedef="ND_separate3_vector3"><input name="in" type="vector3" nodename="advectedPosition" /></separate3>
    <separate3 name="smokeCenter" type="multioutput" nodedef="ND_separate3_vector3"><input name="in" type="vector3" interfacename="center" /></separate3>
    <max name="positiveHeight" type="float"><input name="in1" type="float" nodename="smokeCoordinates" output="outy" /><input name="in2" type="float" value="0" /></max>
    <multiply name="spreadGrowth" type="float"><input name="in1" type="float" nodename="positiveHeight" /><input name="in2" type="float" interfacename="spread" /></multiply>
    <add name="spreadAtHeight" type="float"><input name="in1" type="float" value="1" /><input name="in2" type="float" nodename="spreadGrowth" /></add>
    <subtract name="relativeX" type="float"><input name="in1" type="float" nodename="smokeCoordinates" output="outx" /><input name="in2" type="float" nodename="smokeCenter" output="outx" /></subtract>
    <subtract name="relativeZ" type="float"><input name="in1" type="float" nodename="smokeCoordinates" output="outz" /><input name="in2" type="float" nodename="smokeCenter" output="outz" /></subtract>
    <multiply name="xSquared" type="float"><input name="in1" type="float" nodename="relativeX" /><input name="in2" type="float" nodename="relativeX" /></multiply>
    <multiply name="zSquared" type="float"><input name="in1" type="float" nodename="relativeZ" /><input name="in2" type="float" nodename="relativeZ" /></multiply>
    <add name="radialSquared" type="float"><input name="in1" type="float" nodename="xSquared" /><input name="in2" type="float" nodename="zSquared" /></add>
    <sqrt name="radialDistance" type="float"><input name="in" type="float" nodename="radialSquared" /></sqrt>
    <add name="smokeRadius" type="float"><input name="in1" type="float" value="0.7" /><input name="in2" type="float" nodename="spreadGrowth" /></add>
    <divide name="normalizedRadius" type="float"><input name="in1" type="float" nodename="radialDistance" /><input name="in2" type="float" nodename="smokeRadius" /></divide>
    <subtract name="insideSmoke" type="float"><input name="in1" type="float" value="1" /><input name="in2" type="float" nodename="normalizedRadius" /></subtract>
    <smoothstep name="radialFade" type="float"><input name="in" type="float" nodename="insideSmoke" /><input name="low" type="float" value="0.05" /><input name="high" type="float" value="0.65" /></smoothstep>
    <divide name="spreadX" type="float"><input name="in1" type="float" nodename="advectedCoordinates" output="outx" /><input name="in2" type="float" nodename="spreadAtHeight" /></divide>
    <divide name="spreadZ" type="float"><input name="in1" type="float" nodename="advectedCoordinates" output="outz" /><input name="in2" type="float" nodename="spreadAtHeight" /></divide>
    <combine3 name="spreadPosition" type="vector3"><input name="in1" type="float" nodename="spreadX" /><input name="in2" type="float" nodename="advectedCoordinates" output="outy" /><input name="in3" type="float" nodename="spreadZ" /></combine3>
    <multiply name="scaledPosition" type="vector3"><input name="in1" type="vector3" nodename="spreadPosition" /><input name="in2" type="float" interfacename="scale" /></multiply>
    <multiply name="detailPosition" type="vector3"><input name="in1" type="vector3" nodename="scaledPosition" /><input name="in2" type="float" value="2.7" /></multiply>
    <multiply name="finePosition" type="vector3"><input name="in1" type="vector3" nodename="scaledPosition" /><input name="in2" type="float" value="7.1" /></multiply>
    <noise3d name="smokeNoise" type="float" nodedef="ND_noise3d_float"><input name="position" type="vector3" nodename="scaledPosition" /><input name="amplitude" type="float" value="1" /><input name="pivot" type="float" value="0" /></noise3d>
    <noise3d name="smokeDetail" type="float" nodedef="ND_noise3d_float"><input name="position" type="vector3" nodename="detailPosition" /><input name="amplitude" type="float" value="1" /><input name="pivot" type="float" value="0" /></noise3d>
    <noise3d name="smokeFine" type="float" nodedef="ND_noise3d_float"><input name="position" type="vector3" nodename="finePosition" /><input name="amplitude" type="float" value="1" /><input name="pivot" type="float" value="0" /></noise3d>
    <multiply name="detailWeighted" type="float"><input name="in1" type="float" nodename="smokeDetail" /><input name="in2" type="float" value="0.28" /></multiply>
    <multiply name="fineWeighted" type="float"><input name="in1" type="float" nodename="smokeFine" /><input name="in2" type="float" value="0.12" /></multiply>
    <add name="noiseCoarseDetail" type="float"><input name="in1" type="float" nodename="smokeNoise" /><input name="in2" type="float" nodename="detailWeighted" /></add>
    <add name="smokeFractal" type="float"><input name="in1" type="float" nodename="noiseCoarseDetail" /><input name="in2" type="float" nodename="fineWeighted" /></add>
    <range name="noise01" type="float"><input name="in" type="float" nodename="smokeFractal" /><input name="inlow" type="float" value="-0.18" /><input name="inhigh" type="float" value="0.38" /><input name="outlow" type="float" value="0" /><input name="outhigh" type="float" value="1" /><input name="doclamp" type="boolean" value="true" /></range>
    <range name="heightFade" type="float"><input name="in" type="float" nodename="positiveHeight" /><input name="inlow" type="float" value="0" /><input name="inhigh" type="float" value="4.5" /><input name="outlow" type="float" value="1" /><input name="outhigh" type="float" value="0.25" /><input name="doclamp" type="boolean" value="true" /></range>
    <multiply name="heightDensity" type="float"><input name="in1" type="float" nodename="noise01" /><input name="in2" type="float" nodename="heightFade" /></multiply>
    <multiply name="profiledDensity" type="float"><input name="in1" type="float" nodename="heightDensity" /><input name="in2" type="float" nodename="radialFade" /></multiply>
    <multiply name="densityValue" type="float"><input name="in1" type="float" nodename="profiledDensity" /><input name="in2" type="float" interfacename="density" /></multiply>
    <convert name="colorVector" type="vector3" nodedef="ND_convert_color3_vector3"><input name="in" type="color3" interfacename="color" /></convert>
    <multiply name="scatteringColor" type="vector3"><input name="in1" type="vector3" nodename="colorVector" /><input name="in2" type="float" nodename="densityValue" /></multiply>
    <subtract name="oneMinusAlbedo" type="float"><input name="in1" type="float" value="1" /><input name="in2" type="float" interfacename="albedo" /></subtract>
    <max name="safeAlbedo" type="float"><input name="in1" type="float" interfacename="albedo" /><input name="in2" type="float" value="0.01" /></max>
    <divide name="absorptionRatio" type="float"><input name="in1" type="float" nodename="oneMinusAlbedo" /><input name="in2" type="float" nodename="safeAlbedo" /></divide>
    <multiply name="absorptionColor" type="vector3"><input name="in1" type="vector3" nodename="scatteringColor" /><input name="in2" type="float" nodename="absorptionRatio" /></multiply>
    <anisotropic_vdf name="vdf" type="VDF"><input name="absorption" type="vector3" nodename="absorptionColor" /><input name="scattering" type="vector3" nodename="scatteringColor" /><input name="anisotropy" type="float" interfacename="anisotropy" /></anisotropic_vdf>
    <volume name="smokeVolume" type="volumeshader"><input name="vdf" type="VDF" nodename="vdf" /></volume>
    <output name="out" type="volumeshader" nodename="smokeVolume" />
  </nodegraph>

  <nodedef name="ND_engine_clouds" node="clouds" doc="Animated procedural high-scattering cloud volume with adjustable coverage, density and wind.">
    <input name="coverage" type="float" value="0.48" uimin="0" uimax="1" />
    <input name="density" type="float" value="1.4" uimin="0" uimax="8" />
    <input name="scale" type="float" value="0.65" uimin="0.1" uimax="12" />
    <input name="speed" type="float" value="0.08" uimin="0" uimax="2" />
    <input name="profile" type="integer" value="0" uimin="0" uimax="2" doc="0 cumulus, 1 stratus, 2 cirrus" />
    <input name="baseHeight" type="float" value="3.5" doc="Altitude of the volume's lower bound in world space." />
    <input name="center" type="vector3" value="0, 0, 0" doc="World-space XZ center of the cloud layer." />
    <input name="wind" type="vector3" value="1, 0, 0.2" />
    <input name="color" type="color3" value="0.92, 0.95, 1" />
    <input name="anisotropy" type="float" value="0.68" uimin="0" uimax="0.9" />
    <output name="out" type="volumeshader" />
  </nodedef>
  <nodegraph name="NG_engine_clouds" nodedef="ND_engine_clouds">
    <position name="position" type="vector3"><input name="space" type="string" value="world" /></position>
    <time name="clock" type="float" nodedef="ND_time_float" />
    <multiply name="windOffset" type="vector3"><input name="in1" type="vector3" interfacename="wind" /><input name="in2" type="float" nodename="clock" /></multiply>
    <multiply name="advection" type="vector3"><input name="in1" type="vector3" nodename="windOffset" /><input name="in2" type="float" interfacename="speed" /></multiply>
    <subtract name="advectedPosition" type="vector3"><input name="in1" type="vector3" nodename="position" /><input name="in2" type="vector3" nodename="advection" /></subtract>
    <multiply name="isotropicPosition" type="vector3"><input name="in1" type="vector3" nodename="advectedPosition" /><input name="in2" type="float" interfacename="scale" /></multiply>
    <multiply name="stratusPosition" type="vector3"><input name="in1" type="vector3" nodename="isotropicPosition" /><input name="in2" type="vector3" value="0.7, 1.8, 0.7" /></multiply>
    <multiply name="cirrusPosition" type="vector3"><input name="in1" type="vector3" nodename="isotropicPosition" /><input name="in2" type="vector3" value="0.12, 2, 1.4" /></multiply>
    <ifequal name="layerPosition" type="vector3"><input name="value1" type="integer" interfacename="profile" /><input name="value2" type="integer" value="1" /><input name="in1" type="vector3" nodename="stratusPosition" /><input name="in2" type="vector3" nodename="cirrusPosition" /></ifequal>
    <ifequal name="scaledPosition" type="vector3"><input name="value1" type="integer" interfacename="profile" /><input name="value2" type="integer" value="0" /><input name="in1" type="vector3" nodename="isotropicPosition" /><input name="in2" type="vector3" nodename="layerPosition" /></ifequal>
    <separate3 name="cloudCoordinates" type="multioutput" nodedef="ND_separate3_vector3"><input name="in" type="vector3" nodename="position" /></separate3>
    <separate3 name="cloudCenter" type="multioutput" nodedef="ND_separate3_vector3"><input name="in" type="vector3" interfacename="center" /></separate3>
    <subtract name="relativeHeight" type="float"><input name="in1" type="float" nodename="cloudCoordinates" output="outy" /><input name="in2" type="float" interfacename="baseHeight" /></subtract>
    <subtract name="relativeCloudX" type="float"><input name="in1" type="float" nodename="cloudCoordinates" output="outx" /><input name="in2" type="float" nodename="cloudCenter" output="outx" /></subtract>
    <subtract name="relativeCloudZ" type="float"><input name="in1" type="float" nodename="cloudCoordinates" output="outz" /><input name="in2" type="float" nodename="cloudCenter" output="outz" /></subtract>
    <multiply name="cloudX2" type="float"><input name="in1" type="float" nodename="relativeCloudX" /><input name="in2" type="float" nodename="relativeCloudX" /></multiply>
    <multiply name="cloudZ2" type="float"><input name="in1" type="float" nodename="relativeCloudZ" /><input name="in2" type="float" nodename="relativeCloudZ" /></multiply>
    <add name="cloudRadius2" type="float"><input name="in1" type="float" nodename="cloudX2" /><input name="in2" type="float" nodename="cloudZ2" /></add>
    <sqrt name="cloudRadius" type="float"><input name="in" type="float" nodename="cloudRadius2" /></sqrt>
    <divide name="normalizedCloudRadius" type="float"><input name="in1" type="float" nodename="cloudRadius" /><input name="in2" type="float" value="5" /></divide>
    <subtract name="insideCloud" type="float"><input name="in1" type="float" value="1" /><input name="in2" type="float" nodename="normalizedCloudRadius" /></subtract>
    <smoothstep name="cloudBoundary" type="float"><input name="in" type="float" nodename="insideCloud" /><input name="low" type="float" value="0.02" /><input name="high" type="float" value="0.45" /></smoothstep>
    <noise3d name="cloudNoise" type="float" nodedef="ND_noise3d_float"><input name="position" type="vector3" nodename="scaledPosition" /><input name="amplitude" type="float" value="1" /><input name="pivot" type="float" value="0" /></noise3d>
    <multiply name="detailPosition" type="vector3"><input name="in1" type="vector3" nodename="scaledPosition" /><input name="in2" type="float" value="3.1" /></multiply>
    <noise3d name="cloudDetail" type="float" nodedef="ND_noise3d_float"><input name="position" type="vector3" nodename="detailPosition" /><input name="amplitude" type="float" value="1" /><input name="pivot" type="float" value="0" /></noise3d>
    <multiply name="cloudDetailWeighted" type="float"><input name="in1" type="float" nodename="cloudDetail" /><input name="in2" type="float" value="0.3" /></multiply>
    <add name="perlinWorleyBase" type="float"><input name="in1" type="float" nodename="cloudNoise" /><input name="in2" type="float" nodename="cloudDetailWeighted" /></add>
    <worleynoise3d name="cloudCells" type="float" nodedef="ND_worleynoise3d_float"><input name="position" type="vector3" nodename="scaledPosition" /><input name="style" type="integer" value="0" /><input name="jitter" type="float" value="0.8" /></worleynoise3d>
    <subtract name="cellErosion" type="float"><input name="in1" type="float" value="1" /><input name="in2" type="float" nodename="cloudCells" /></subtract>
    <multiply name="perlinWeight" type="float"><input name="in1" type="float" nodename="perlinWorleyBase" /><input name="in2" type="float" value="0.72" /></multiply>
    <multiply name="worleyWeight" type="float"><input name="in1" type="float" nodename="cellErosion" /><input name="in2" type="float" value="0.28" /></multiply>
    <add name="cloudFractal" type="float"><input name="in1" type="float" nodename="perlinWeight" /><input name="in2" type="float" nodename="worleyWeight" /></add>
    <range name="noise01" type="float"><input name="in" type="float" nodename="cloudFractal" /><input name="inlow" type="float" value="-0.5" /><input name="inhigh" type="float" value="0.5" /><input name="outlow" type="float" value="0" /><input name="outhigh" type="float" value="1" /><input name="doclamp" type="boolean" value="true" /></range>
    <subtract name="coverageThreshold" type="float"><input name="in1" type="float" nodename="noise01" /><input name="in2" type="float" interfacename="coverage" /></subtract>
    <smoothstep name="cloudDensity" type="float"><input name="in" type="float" nodename="coverageThreshold" /><input name="low" type="float" value="0" /><input name="high" type="float" value="0.22" /></smoothstep>
    <smoothstep name="cumulusBase" type="float"><input name="in" type="float" nodename="relativeHeight" /><input name="low" type="float" value="0" /><input name="high" type="float" value="0.8" /></smoothstep>
    <smoothstep name="cumulusTop" type="float"><input name="in" type="float" nodename="relativeHeight" /><input name="low" type="float" value="3.4" /><input name="high" type="float" value="4.5" /></smoothstep>
    <subtract name="cumulusTopFade" type="float"><input name="in1" type="float" value="1" /><input name="in2" type="float" nodename="cumulusTop" /></subtract>
    <multiply name="cumulusProfile" type="float"><input name="in1" type="float" nodename="cumulusBase" /><input name="in2" type="float" nodename="cumulusTopFade" /></multiply>
    <smoothstep name="stratusBase" type="float"><input name="in" type="float" nodename="relativeHeight" /><input name="low" type="float" value="0" /><input name="high" type="float" value="0.25" /></smoothstep>
    <smoothstep name="stratusTop" type="float"><input name="in" type="float" nodename="relativeHeight" /><input name="low" type="float" value="1.3" /><input name="high" type="float" value="1.6" /></smoothstep>
    <subtract name="stratusTopFade" type="float"><input name="in1" type="float" value="1" /><input name="in2" type="float" nodename="stratusTop" /></subtract>
    <multiply name="stratusProfile" type="float"><input name="in1" type="float" nodename="stratusBase" /><input name="in2" type="float" nodename="stratusTopFade" /></multiply>
    <smoothstep name="cirrusBase" type="float"><input name="in" type="float" nodename="relativeHeight" /><input name="low" type="float" value="0" /><input name="high" type="float" value="0.8" /></smoothstep>
    <smoothstep name="cirrusTop" type="float"><input name="in" type="float" nodename="relativeHeight" /><input name="low" type="float" value="2.8" /><input name="high" type="float" value="3.4" /></smoothstep>
    <subtract name="cirrusTopFade" type="float"><input name="in1" type="float" value="1" /><input name="in2" type="float" nodename="cirrusTop" /></subtract>
    <multiply name="cirrusProfile" type="float"><input name="in1" type="float" nodename="cirrusBase" /><input name="in2" type="float" nodename="cirrusTopFade" /></multiply>
    <ifequal name="selectStratusOrCirrus" type="float"><input name="value1" type="integer" interfacename="profile" /><input name="value2" type="integer" value="1" /><input name="in1" type="float" nodename="stratusProfile" /><input name="in2" type="float" nodename="cirrusProfile" /></ifequal>
    <ifequal name="selectCloudProfile" type="float"><input name="value1" type="integer" interfacename="profile" /><input name="value2" type="integer" value="0" /><input name="in1" type="float" nodename="cumulusProfile" /><input name="in2" type="float" nodename="selectStratusOrCirrus" /></ifequal>
    <multiply name="profiledCloudDensity" type="float"><input name="in1" type="float" nodename="cloudDensity" /><input name="in2" type="float" nodename="selectCloudProfile" /></multiply>
    <multiply name="boundedCloudDensity" type="float"><input name="in1" type="float" nodename="profiledCloudDensity" /><input name="in2" type="float" nodename="cloudBoundary" /></multiply>
    <multiply name="densityValue" type="float"><input name="in1" type="float" nodename="boundedCloudDensity" /><input name="in2" type="float" interfacename="density" /></multiply>
    <convert name="colorVector" type="vector3" nodedef="ND_convert_color3_vector3"><input name="in" type="color3" interfacename="color" /></convert>
    <multiply name="scatteringColor" type="vector3"><input name="in1" type="vector3" nodename="colorVector" /><input name="in2" type="float" nodename="densityValue" /></multiply>
    <anisotropic_vdf name="vdf" type="VDF"><input name="absorption" type="vector3" value="0, 0, 0" /><input name="scattering" type="vector3" nodename="scatteringColor" /><input name="anisotropy" type="float" interfacename="anisotropy" /></anisotropic_vdf>
    <volume name="cloudVolume" type="volumeshader"><input name="vdf" type="VDF" nodename="vdf" /></volume>
    <output name="out" type="volumeshader" nodename="cloudVolume" />
  </nodegraph>

  <nodedef name="ND_engine_ice" node="ice" doc="Parametric translucent ice with subsurface scattering, absorption and procedural inclusions.">
    <input name="color" type="color3" value="0.52, 0.78, 0.88" />
    <input name="roughness" type="float" value="0.16" uimin="0" uimax="1" />
    <input name="depth" type="float" value="1.5" uimin="0.01" uimax="20" />
    <input name="inclusionScale" type="float" value="8" uimin="0.1" uimax="24" />
    <output name="out" type="surfaceshader" />
    <output name="displacement" type="displacementshader" />
  </nodedef>
  <nodegraph name="NG_engine_ice" nodedef="ND_engine_ice">
    <position name="position" type="vector3"><input name="space" type="string" value="object" /></position>
    <multiply name="inclusionPosition" type="vector3"><input name="in1" type="vector3" nodename="position" /><input name="in2" type="float" interfacename="inclusionScale" /></multiply>
    <noise3d name="inclusions" type="float" nodedef="ND_noise3d_float"><input name="position" type="vector3" nodename="inclusionPosition" /><input name="amplitude" type="float" value="1" /><input name="pivot" type="float" value="0" /></noise3d>
    <range name="inclusionMask" type="float"><input name="in" type="float" nodename="inclusions" /><input name="inlow" type="float" value="-0.35" /><input name="inhigh" type="float" value="0.55" /><input name="outlow" type="float" value="0.15" /><input name="outhigh" type="float" value="0.8" /><input name="doclamp" type="boolean" value="true" /></range>
    <multiply name="iceColor" type="color3"><input name="in1" type="color3" interfacename="color" /><input name="in2" type="float" nodename="inclusionMask" /></multiply>
    <bump name="iceNormal" type="vector3" nodedef="ND_bump_vector3"><input name="height" type="float" nodename="inclusions" /><input name="scale" type="float" value="0.025" /></bump>
    <standard_surface name="iceSurface" type="surfaceshader">
      <input name="base_color" type="color3" nodename="iceColor" />
      <input name="subsurface" type="float" value="0.25" />
      <input name="subsurface_color" type="color3" interfacename="color" />
      <input name="transmission" type="float" value="0.72" />
      <input name="transmission_color" type="color3" interfacename="color" />
      <input name="transmission_depth" type="float" interfacename="depth" />
      <input name="specular_roughness" type="float" interfacename="roughness" />
      <input name="normal" type="vector3" nodename="iceNormal" />
    </standard_surface>
    <output name="out" type="surfaceshader" nodename="iceSurface" />
    <displacement name="iceDisplacement" type="displacementshader"><input name="displacement" type="float" value="0" /></displacement>
    <output name="displacement" type="displacementshader" nodename="iceDisplacement" />
  </nodegraph>

  <nodedef name="ND_engine_mud" node="mud" doc="Wet mud surface whose color and roughness blend from a procedural moisture mask.">
    <input name="color" type="color3" value="0.22, 0.13, 0.07" />
    <input name="wetColor" type="color3" value="0.07, 0.045, 0.025" />
    <input name="wetness" type="float" value="0.6" uimin="0" uimax="1" />
    <input name="scale" type="float" value="5" uimin="0.1" uimax="20" />
    <input name="roughness" type="float" value="0.78" uimin="0" uimax="1" />
    <output name="out" type="surfaceshader" />
    <output name="displacement" type="displacementshader" />
  </nodedef>
  <nodedef name="ND_engine_wet_sand" node="wet_sand" doc="Wet sand surface with a procedural moisture mask and adjustable dry-to-wet roughness.">
    <input name="color" type="color3" value="0.62, 0.43, 0.22" />
    <input name="wetColor" type="color3" value="0.28, 0.18, 0.09" />
    <input name="wetness" type="float" value="0.5" uimin="0" uimax="1" />
    <input name="scale" type="float" value="7" uimin="0.1" uimax="20" />
    <input name="roughness" type="float" value="0.82" uimin="0" uimax="1" />
    <output name="out" type="surfaceshader" />
    <output name="displacement" type="displacementshader" />
  </nodedef>
  <nodegraph name="NG_engine_mud" nodedef="ND_engine_mud">
    <position name="position" type="vector3"><input name="space" type="string" value="object" /></position>
    <multiply name="scaledPosition" type="vector3"><input name="in1" type="vector3" nodename="position" /><input name="in2" type="float" interfacename="scale" /></multiply>
    <noise3d name="moistureNoise" type="float" nodedef="ND_noise3d_float"><input name="position" type="vector3" nodename="scaledPosition" /><input name="amplitude" type="float" value="1" /><input name="pivot" type="float" value="0" /></noise3d>
    <range name="moistureMask" type="float"><input name="in" type="float" nodename="moistureNoise" /><input name="inlow" type="float" value="-0.5" /><input name="inhigh" type="float" value="0.5" /><input name="outlow" type="float" value="0" /><input name="outhigh" type="float" value="1" /><input name="doclamp" type="boolean" value="true" /></range>
    <multiply name="wetMask" type="float"><input name="in1" type="float" nodename="moistureMask" /><input name="in2" type="float" interfacename="wetness" /></multiply>
    <mix name="mudColor" type="color3"><input name="fg" type="color3" interfacename="wetColor" /><input name="bg" type="color3" interfacename="color" /><input name="mix" type="float" nodename="wetMask" /></mix>
    <multiply name="wetRoughness" type="float"><input name="in1" type="float" interfacename="roughness" /><input name="in2" type="float" value="0.25" /></multiply>
    <mix name="mudRoughness" type="float"><input name="fg" type="float" nodename="wetRoughness" /><input name="bg" type="float" interfacename="roughness" /><input name="mix" type="float" nodename="wetMask" /></mix>
    <multiply name="grainPosition" type="vector3"><input name="in1" type="vector3" nodename="scaledPosition" /><input name="in2" type="float" value="6" /></multiply>
    <noise3d name="grains" type="float" nodedef="ND_noise3d_float"><input name="position" type="vector3" nodename="grainPosition" /></noise3d>
    <multiply name="grainHeight" type="float"><input name="in1" type="float" nodename="grains" /><input name="in2" type="float" value="0.16" /></multiply>
    <add name="mudHeight" type="float"><input name="in1" type="float" nodename="moistureNoise" /><input name="in2" type="float" nodename="grainHeight" /></add>
    <bump name="mudNormal" type="vector3" nodedef="ND_bump_vector3"><input name="height" type="float" nodename="mudHeight" /><input name="scale" type="float" value="0.07" /></bump>
    <standard_surface name="mudSurface" type="surfaceshader"><input name="base_color" type="color3" nodename="mudColor" /><input name="specular_roughness" type="float" nodename="mudRoughness" /><input name="normal" type="vector3" nodename="mudNormal" /><input name="coat" type="float" nodename="wetMask" /><input name="coat_roughness" type="float" value="0.12" /></standard_surface>
    <output name="out" type="surfaceshader" nodename="mudSurface" />
    <displacement name="mudDisplacement" type="displacementshader"><input name="displacement" type="float" nodename="mudHeight" /><input name="scale" type="float" value="0.04" /></displacement>
    <output name="displacement" type="displacementshader" nodename="mudDisplacement" />
  </nodegraph>
  <nodegraph name="NG_engine_wet_sand" nodedef="ND_engine_wet_sand">
    <position name="position" type="vector3"><input name="space" type="string" value="object" /></position>
    <multiply name="scaledPosition" type="vector3"><input name="in1" type="vector3" nodename="position" /><input name="in2" type="float" interfacename="scale" /></multiply>
    <noise3d name="moistureNoise" type="float" nodedef="ND_noise3d_float"><input name="position" type="vector3" nodename="scaledPosition" /><input name="amplitude" type="float" value="1" /><input name="pivot" type="float" value="0" /></noise3d>
    <range name="moistureMask" type="float"><input name="in" type="float" nodename="moistureNoise" /><input name="inlow" type="float" value="-0.45" /><input name="inhigh" type="float" value="0.55" /><input name="outlow" type="float" value="0" /><input name="outhigh" type="float" value="1" /><input name="doclamp" type="boolean" value="true" /></range>
    <multiply name="wetMask" type="float"><input name="in1" type="float" nodename="moistureMask" /><input name="in2" type="float" interfacename="wetness" /></multiply>
    <mix name="sandColor" type="color3"><input name="fg" type="color3" interfacename="wetColor" /><input name="bg" type="color3" interfacename="color" /><input name="mix" type="float" nodename="wetMask" /></mix>
    <multiply name="wetRoughness" type="float"><input name="in1" type="float" interfacename="roughness" /><input name="in2" type="float" value="0.18" /></multiply>
    <mix name="sandRoughness" type="float"><input name="fg" type="float" nodename="wetRoughness" /><input name="bg" type="float" interfacename="roughness" /><input name="mix" type="float" nodename="wetMask" /></mix>
    <multiply name="grainPosition" type="vector3"><input name="in1" type="vector3" nodename="scaledPosition" /><input name="in2" type="float" value="8" /></multiply>
    <noise3d name="grains" type="float" nodedef="ND_noise3d_float"><input name="position" type="vector3" nodename="grainPosition" /></noise3d>
    <bump name="sandNormal" type="vector3" nodedef="ND_bump_vector3"><input name="height" type="float" nodename="grains" /><input name="scale" type="float" value="0.012" /></bump>
    <standard_surface name="sandSurface" type="surfaceshader"><input name="base_color" type="color3" nodename="sandColor" /><input name="specular_roughness" type="float" nodename="sandRoughness" /><input name="normal" type="vector3" nodename="sandNormal" /><input name="coat" type="float" nodename="wetMask" /><input name="coat_roughness" type="float" value="0.08" /></standard_surface>
    <output name="out" type="surfaceshader" nodename="sandSurface" />
    <displacement name="sandDisplacement" type="displacementshader"><input name="displacement" type="float" nodename="grains" /><input name="scale" type="float" value="0.003" /></displacement>
    <output name="displacement" type="displacementshader" nodename="sandDisplacement" />
  </nodegraph>
`;
