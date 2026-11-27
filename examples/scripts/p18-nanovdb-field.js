// Priorité 18 : champ de vitesse NanoVDB et intégration multipas.
// npm run script -- examples/scripts/p18-nanovdb-field.js --out docs/images/p18

flowSurface = new StandardSurface();
flowSurface.base_color = [0.08, 0.6, 0.35];
flowSurface.specular_roughness = 0.4;

velocity = await loadVelocityField("./scenes/bench/volumes/p18-swirl.nvdb.gz", "swirl");
flow = new Field({ axis: "X", min: -1, max: 1, steps: 6 });
flow.field = velocity;
flow.keyframes = [
  { time: 0, strength: 0 },
  { time: 12, strength: 0.8 },
  { time: 36, strength: -0.8 },
  { time: 48, strength: 0 },
];

sheet = new Plane({ width: 1.5, length: 1.5, axis: "Z", resolution: 32, material: flowSurface });
sheet.deformers = [flow];
render.resolution = 512;
render.backend = "raster";
setCamera({ eye: [3, 2, 5], target: [0, 0, 0], fov: 36 });
await render(1);
await save("p18-nanovdb-field.usda");
await video("p18-nanovdb-field.mp4", { start: 0, end: 48, fps: 12 });
