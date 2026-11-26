// P17 : the fire's EDF illuminates the scene in path tracing, without a proxy light.
const mobile = capabilities()?.mobile === true;
const sky = new EnvironmentShader();
sky.model = "gradient";
sky.zenithColor = [0, 0, 0];
sky.horizonColor = [0, 0, 0];
sky.groundColor = [0, 0, 0];

const stone = new StandardSurface();
stone.base_color = [0.35, 0.32, 0.28];
stone.specular_roughness = 0.85;
new Plane({ width: 8, length: 8, material: stone });
new Sphere({ radius: 0.4, translate: [-0.9, 0.4, 0.4], material: stone });
new Sphere({ radius: 0.3, translate: [0.9, 0.3, 0], material: stone });

const flame = new Fire();
flame.temperature = 2000;
flame.emission = 5;
flame.density = 0.8;
new Volume({ width: 2, height: 3.4, length: 2, translate: [0, 1.7, 0], material: flame });

await environment(sky.out);
render.resolution = mobile ? 128 : 256;
render.backend = "pathtracing";
render.depth = 10;
setCamera({ eye: [4, 3, 5], target: [0, 1.3, 0], fov: 38 });
for (const frame of [0, 24]) {
  await setTime(frame);
  await render(mobile ? 32 : 256);
  await save(`frame-${String(frame).padStart(3, "0")}.png`);
}
