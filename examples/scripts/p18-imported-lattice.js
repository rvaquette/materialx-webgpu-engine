// Priorité 18 en cours : maillage USD importé et treillis animé.
// npm run script -- examples/scripts/p18-imported-lattice.js --out docs/images/p18

surface = new StandardSurface();
surface.base_color = [0.05, 0.45, 0.75];
surface.metalness = 0.35;
surface.specular_roughness = 0.28;

gem = await importMesh("./scenes/bench/p18-gem.usda", "/Gem");
gem.material = surface;
lattice = new Lattice();
lattice.boundsMin = [-1, -1, -1];
lattice.boundsMax = [1, 1, 1];
lattice.min = -1;
lattice.max = 1;
lattice.offsets = Array(24).fill(0);
right = Array(24).fill(0);
left = Array(24).fill(0);
for (const index of [2, 3, 6, 7]) {
  right[index * 3] = 0.8;
  left[index * 3] = -0.8;
}
lattice.keyframes = [
  { time: 0, offsets: lattice.offsets },
  { time: 12, offsets: right },
  { time: 24, offsets: left },
  { time: 36, offsets: lattice.offsets },
];
gem.deformers = [lattice];

render.resolution = 512;
render.backend = "raster";
setCamera({ eye: [3, 2, 5], target: [0, 0, 0], fov: 36 });
await render(1);
await save("p18-imported-lattice.usda");
await video("p18-imported-lattice.mp4", { start: 0, end: 36, fps: 24 });
render.resolution = 256;
render.backend = "pathtracing";
render.depth = 3;
await render(1);
await video("p18-imported-lattice-blur.mp4", { start: 0, end: 36, fps: 12, samples: 16, shutter: [-1, 1], steps: 4 });
