// Priorité 8 : parchemin enroulé (primitive déformée, matériau procédural) — docs/ROADMAP_DONE.md.
// Une feuille plane subdivisée dont les deux extrémités sont enroulées par une
// déformation des sommets (deform), avec un matériau procédural de vieux parchemin aux bords abîmés.
// npm run script -- examples/scripts/p8-parchemin.js --out renders/validation/p8-parchemin --timeout 1800000

const mobile = capabilities()?.mobile === true;
const spp = count => mobile ? Math.max(4, count / 4) : count;

// --- Matériau : papier vieilli ------------------------------------------------
// Fibres et grain : bruit fractal fin ; taches : bruit fractal large.
pos = new Position();
grain = new Fractal3d("float");
grain.octaves = 6;
grain.position = pos.out * 40;
blotches = new Fractal3d("float");
blotches.octaves = 3;
blotches.position = pos.out * 3;

paper = new Mix();
paper.bg = [0.87, 0.76, 0.55];
paper.fg = [0.6, 0.43, 0.24];
paper.mix = Math.min(Math.max(blotches.out * 0.6 + grain.out * 0.12 + 0.25, 0), 1);

// Bords brunis : distance au bord de la feuille dans l'espace UV.
uv = new Texcoord("vector2");
st = new Separate2();
st.in = uv.out;
edge = Math.min(Math.min(st.outx, 1 - st.outx), Math.min(st.outy, 1 - st.outy));

// Bords abîmés : un bruit moyen décale la ligne de bord, quelques accrocs plus profonds.
tear = new Fractal3d("float");
tear.octaves = 4;
tear.position = pos.out * 14;
torn = edge - 0.012 + tear.out * 0.012 + blotches.out * 0.004;
// Opacité nette : 0 hors de la déchirure, 1 dans la feuille.
keep = new Convert("ND_convert_float_color3");
keep.in = Math.min(Math.max(torn * 600, 0), 1);

burn = new Smoothstep("float");
burn.in = torn + grain.out * 0.01;
burn.low = 0;
burn.high = 0.06;

parchment = new StandardSurface();
parchment.base_color = paper.out * (burn.out * 0.7 + 0.3);
parchment.opacity = keep.out;
parchment.specular = 0.25;
parchment.specular_roughness = 0.8;
parchment.thin_walled = true;

table = new StandardSurface();
table.base_color = [0.16, 0.09, 0.05];
table.specular_roughness = 0.35;

// --- Géométrie ----------------------------------------------------------------
const width = 2.4, length = 1.5;
// Partie plane au centre ; au-delà, la feuille s'enroule vers le haut et vers l'intérieur en
// spirale (rayon r0 décroissant), ce qui conserve sa longueur.
const flat = 0.72, r0 = 0.075, shrink = 0.05;
sheet = new Plane({ width, length, resolution: 240, material: parchment });
sheet.deform = (p, uv, n) => {
  const side = Math.sign(p[0]);
  const s = Math.abs(p[0]) - flat;
  // Ondulation légère du papier, toujours au-dessus de la table.
  const sag = 0.004 * (1 + Math.sin(p[2] * 9) * Math.cos(p[0] * 3));
  if (s <= 0) return [p[0], sag, p[2]];
  // Angle parcouru pour une longueur s sur une spirale r = r0 (1 - shrink θ).
  const theta = (1 - Math.sqrt(Math.max(0, 1 - 2 * shrink * s / r0))) / shrink;
  const r = r0 * (1 - shrink * theta);
  return [side * (flat + r * Math.sin(theta)), r0 - r * Math.cos(theta) + sag, p[2]];
};
sheet.translate = [0, 0.005, 0];

desk = new Plane({ width: 8, length: 8, material: table });

// --- Rendu --------------------------------------------------------------------
render.resolution = mobile ? 256 : 512;
setCamera({ eye: [1.25, 1.35, 2.15], target: [0, 0.05, 0], fov: 38 });
render.backend = "raster";
await save("parchemin-raster.png");
render.backend = "pathtracing";
render.depth = 8;
await render(spp(512));
await save("parchemin.png");
await save("parchemin/parchemin.usda");
