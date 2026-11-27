// Priorité 18 en cours : ruban tordu et animé.
// npm run script -- examples/scripts/p18-animated-ribbon.js --out docs/images/p18

ribbonSurface = new StandardSurface();
ribbonSurface.base_color = [0.85, 0.14, 0.035];
ribbonSurface.specular_roughness = 0.35;

twist = new Twist({ axis: "X", min: -1.5, max: 1.5 });
twist.keyframes = Array.from({ length: 25 }, (_, index) => ({
  time: index * 2,
  angle: 150 * Math.sin(index * Math.PI / 12),
}));
ribbon = new Plane({ width: 3, length: 0.7, axis: "Z", resolution: 36, material: ribbonSurface });
ribbon.deformers = [twist];

render.resolution = 512;
render.backend = "raster";
setCamera({ eye: [3, 2, 5], target: [0, 0, 0], fov: 36 });
await render(1);
await save("p18-animated-ribbon.usda");
await video("p18-animated-ribbon.mp4", { start: 0, end: 48, fps: 12 });
render.resolution = 256;
render.backend = "pathtracing";
render.depth = 3;
await render(1);
await video("p18-animated-ribbon-blur.mp4", { start: 0, end: 48, fps: 12, samples: 16, shutter: [-1, 1], steps: 4 });
