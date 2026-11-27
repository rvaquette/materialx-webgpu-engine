// Priorité 18 en cours : champ MaterialX animé en espace objet.
// npm run script -- examples/scripts/p18-materialx-field.js --out docs/images/p18

fieldSurface = new StandardSurface();
fieldSurface.base_color = [0.08, 0.4, 0.8];
fieldSurface.specular_roughness = 0.38;

position = new Position();
position.space = "object";
noise = new Noise3d("vector3");
noise.position = position.out;
noise.amplitude = [0.45, 0.45, 0.45];
clock = new Time();
speed = new Multiply("float");
speed.in1 = clock.out;
speed.in2 = 3.14159265;
wave = new Sin();
wave.in = speed.out;
weight = new Combine3("vector3");
weight.in1 = wave.out;
weight.in2 = wave.out;
weight.in3 = wave.out;
motion = new Multiply("vector3");
motion.in1 = noise.out;
motion.in2 = weight.out;

field = new Field({ steps: 3, end: 48, samples: 25 });
field.field = motion.out;
model = new Sphere({ resolution: 32, material: fieldSurface });
model.deformers = [field];

render.resolution = 512;
render.backend = "raster";
setCamera({ eye: [3, 2, 5], target: [0, 0, 0], fov: 36 });
await render(1);
await save("p18-materialx-field.usda");
await video("p18-materialx-field.mp4", { start: 0, end: 48, fps: 12 });
