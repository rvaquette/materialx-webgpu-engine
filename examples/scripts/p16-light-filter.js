// Priorité 16 : gobo procédural sur une lumière spot importée depuis USD.
// npm run script -- examples/scripts/p16-light-filter.js --out docs/images/p16

await scene("./examples/scenes/p16-extension-light.usda");
render.backend = "pathtracing";
render.resolution = 256;
await render(1);

const filter = new LightFilterShader();
filter.lightPath = "/World/Spot";
filter.pattern = "grid";
filter.scale = 3.5;
filter.rotation = 18;
filter.softness = 0.035;
await lightFilter(filter.out);

const fill = new EnvironmentShader();
fill.model = "studio";
fill.sunIntensity = 0.3;
await environment(fill.out);

const lens = new LensShader();
lens.distortion = 0.025;
await postprocess(lens.out);

render.resolution = 256;
render.environment = true;
render.depth = 4;
setCamera({ eye: [4.5, 3.8, 6], target: [0, 0.5, 0], fov: 38 });
await render(128);
await save("p16-light-filter.png");
