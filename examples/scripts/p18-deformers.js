// Priorité 18 : pile de déformeurs sur des primitives.
// npm run script -- examples/scripts/p18-deformers.js --out docs/images/p18

surface = new StandardSurface();
surface.base_color = [0.12, 0.48, 0.8];
surface.specular_roughness = 0.35;

twist = new Twist();
twist.axis = "X";
twist.min = -1.5;
twist.max = 1.5;
twist.angle = 100;
wave = new Wave();
wave.axis = "X";
wave.min = -1.5;
wave.max = 1.5;
wave.amplitude = 0.15;
wave.frequency = 4;

ribbon = new Plane({ width: 3, length: 1, axis: "Z", resolution: 32, material: surface });
ribbon.deformers = [twist, wave];

lattice = new Lattice();
lattice.offsets = [
  0, 0, 0,   0, 0, 0,
  0, 0, 0,   0.4, 0.5, 0,
  0, 0, 0,   0, 0, 0,
  0, 0, 0,   0.4, 0.5, 0,
];
ball = new Sphere({ radius: 0.55, translate: [2.4, 0, 0], material: surface });
ball.deformers = [lattice];

render.resolution = 512;
render.backend = "raster";
setCamera({ eye: [3, 3, 6], target: [0.7, 0, 0], fov: 40 });
await render(1);
await save("p18-deformers.png");
