// Priorité 28 : matériau standard, préréglage exportable et post-traitement moteur.
// npm run script -- examples\scripts\p28-materialx-compatibility.js --out docs\images\p28

standard = new StandardSurface();
standard.base_color = [0.8, 0.18, 0.06];
standard.specular_roughness = 0.3;

water = new Water();
water.color = [0.02, 0.22, 0.3];
water.waveHeight = 0.08;

floor = new StandardSurface();
floor.base_color = [0.12, 0.14, 0.18];
floor.specular_roughness = 0.8;

new Sphere({ radius: 0.65, translate: [-0.9, 0.7, 0], material: standard });
new Sphere({ radius: 0.65, translate: [0.9, 0.7, 0], material: water });
new Plane({ width: 5, length: 5, translate: [0, 0, 0], material: floor });

grade = new ImageShader();
grade.contrast = 1.1;
grade.vignette = 0.15;
await postprocess(grade.out);

render.backend = "raster";
render.resolution = 256;
setCamera({ eye: [3, 2.5, 5], target: [0, 0.65, 0], fov: 36 });
await render(1);
await save("p28-standard.mtlx", standard);
await save("p28-water.mtlx", water.out);
await save("p28-materialx-compatibility.png");
