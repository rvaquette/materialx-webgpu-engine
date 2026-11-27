// Ready-made scripts inserted by the editor's « Modèles » menu (docs/SCRIPTING.md).

export interface ScriptTemplate {
  label: string;
  code: string;
}

export const SCRIPT_TEMPLATES: readonly ScriptTemplate[] = [
  {
    label: 'Matériau procédural',
    code: `noise = new Fractal3d("float");
noise.octaves = 4;

blend = new Mix();
blend.fg = [0.8, 0.35, 0.1];
blend.bg = [0.1, 0.15, 0.4];
blend.mix = noise.out;

surface = new StandardSurface();
surface.base_color = blend.out;
surface.specular_roughness = 0.3;
`,
  },
  {
    label: 'Rendu path tracing d’une scène',
    code: `await scene("./scenes/standard-shader-ball/standard-shader-ball.usda");
render.resolution = 512;
render.backend = "pathtracing";
render.depth = 8;
setCamera({ eye: [0, 1.5, 4], target: [0, 0.8, 0], fov: 35 });
await render(256);
await save("rendu.png");
`,
  },
  {
    label: 'Même matériau sur tous les objets',
    code: `surface = new StandardSurface();
surface.base_color = [0.8, 0.8, 0.8];
surface.metalness = 1;
surface.specular_roughness = 0.2;
for (const object of objects()) {
  await assign(object, surface);
}
`,
  },
  {
    label: 'Comparer des matériaux de la bibliothèque',
    code: `await scene("./scenes/standard-shader-ball/standard-shader-ball.usda");
render.backend = "pathtracing";
const materials = [
  "./scenes/mtlx-library/Examples/StandardSurface/standard_surface_gold.mtlx",
  "./scenes/mtlx-library/Examples/StandardSurface/standard_surface_glass.mtlx",
];
for (const path of materials) {
  await assign(objects()[0], path);
  await render(128);
  await save(path.split("/").at(-1).replace(".mtlx", ".png"));
}
`,
  },
  {
    label: 'Convergence et AOV',
    code: `render.backend = "pathtracing";
render.noiseTarget = 0.02;
render.stopOnConvergence = true;
const result = await converge(600);
log(\`\${result.samples} échantillons, bruit \${(result.noise * 100).toFixed(1)} %\`);
await save("beauty.png");
for (const view of ["albedo", "normal", "depth"]) {
  render.view = view;
  await save(\`\${view}.pfm\`);
}
render.view = "beauty";
`,
  },
  {
    label: 'Séquence animée',
    code: `const range = timeline() ?? { start: 0, end: 24, fps: 24 };
render.backend = "pathtracing";
await video("animation.mp4", { start: range.start, end: range.end, fps: range.fps, samples: 64 });
`,
  },
];
