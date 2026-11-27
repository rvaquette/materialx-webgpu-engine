// P17 : la fumée enveloppe la pointe de la flamme (volumes superposés) ; seule
// l'émission volumique du feu éclaire la fumée et le sol, sans source ponctuelle.
// npm run script -- examples/scripts/p17-fire-smoke-light.js --out docs/images/p17-fire-smoke-light
const mobile = capabilities()?.mobile === true;
const sky = new EnvironmentShader();
sky.model = "gradient";
sky.zenithColor = [0, 0, 0];
sky.horizonColor = [0, 0, 0];
sky.groundColor = [0, 0, 0];

const ground = new StandardSurface();
ground.base_color = [0.12, 0.1, 0.08];
ground.specular_roughness = 0.9;
new Plane({ width: 8, length: 8, material: ground });

const fire = new Fire();
fire.density = 1.4;
fire.emission = 8;
fire.temperature = 2200;
const flame = new Volume({ width: 1.8, height: 3.2, length: 1.8, material: fire });
flame.translate = [0, 1.7, 0];

const smoke = new Smoke();
smoke.density = 1.1;
smoke.albedo = 0.97;
smoke.color = [0.9, 0.9, 0.9];
smoke.wind = [0.1, 1, 0.1];
const plume = new Volume({ width: 2.8, height: 2.5, length: 2.8, material: smoke });
plume.translate = [0, 3.8, 0];

await environment(sky.out);
render.resolution = mobile ? 128 : 256;
render.backend = "pathtracing";
render.depth = 12;
setCamera({ eye: [5, 4, 8], target: [0, 2.7, 0], fov: 36 });
await render(mobile ? 64 : 512);
await save("fire-smoke.png");
