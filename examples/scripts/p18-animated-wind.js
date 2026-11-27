// Priorité 18 en cours : drapeau animé par un champ de vent 3D.
// npm run script -- examples/scripts/p18-animated-wind.js --out docs/images/p18

cloth = new StandardSurface();
cloth.base_color = [0.05, 0.3, 0.8];
cloth.specular_roughness = 0.65;

wind = new Wind();
wind.axis = "X";
wind.min = -1.5;
wind.max = 1.5;
wind.amplitude = 0.9;
wind.frequency = 1.4;
wind.seed = 7;
wind.keyframes = Array.from({ length: 25 }, (_, frame) => ({ time: frame, phase: frame * 0.14 }));

flag = new Plane({ width: 3, length: 2, axis: "Z", resolution: 40, material: cloth });
flag.deformers = [wind];

render.resolution = 512;
render.backend = "raster";
setCamera({ eye: [1, 1, 6], target: [0, 0, 0], fov: 40 });
await render(1);
await save("p18-animated-wind.usda");
await video("p18-animated-wind.mp4", { start: 0, end: 24, fps: 24 });
render.resolution = 256;
render.backend = "pathtracing";
render.depth = 3;
await render(1);
await video("p18-animated-wind-blur.mp4", { start: 0, end: 24, fps: 12, samples: 16, shutter: [-1, 1], steps: 4 });
