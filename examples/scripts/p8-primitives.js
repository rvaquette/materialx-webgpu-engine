// Priorité 8 : primitives et scènes par script (docs/ROADMAP_DONE.md).
// Scène de lookdev construite sans fichier USD : primitives 3D et 2D matérialisées, rendues en
// raster puis en path tracing, déplacées sans rechargement, modifiées (rayon, résolution,
// matériau), exportées en USD, puis un objet est supprimé.
// npm run script -- examples/scripts/p8-primitives.js --out renders/validation/p8 --timeout 3600000

// GPU mobile (≈ 13 fois plus lent que la T500) : 256² et 4 fois moins d'échantillons.
const mobile = capabilities()?.mobile === true;
const spp = count => mobile ? Math.max(4, count / 4) : count;

// Matériaux.
ground = new StandardSurface();
ground.base_color = [0.55, 0.55, 0.52];
ground.specular_roughness = 0.6;

terracotta = new StandardSurface();
terracotta.base_color = [0.75, 0.3, 0.15];
terracotta.specular_roughness = 0.45;

gold = new StandardSurface();
gold.base_color = [1, 0.78, 0.34];
gold.metalness = 1;
gold.specular_roughness = 0.25;

glass = new StandardSurface();
glass.base = 0;
glass.transmission = 1;
glass.specular_roughness = 0.02;

// Verre mince (sans volume) pour une surface plate.
pane = new StandardSurface();
pane.base = 0;
pane.transmission = 1;
pane.transmission_color = [0.7, 0.9, 1];
pane.specular_roughness = 0.05;
pane.thin_walled = true;

blue = new StandardSurface();
blue.base_color = [0.1, 0.25, 0.7];
blue.coat = 1;
blue.specular_roughness = 0.35;

// Primitives : propriétés à la création ou une par une ; resolution subdivise le sol en grille.
floor = new Plane({ width: 8, length: 8, resolution: 16, material: ground });
ball = new Sphere();
ball.radius = 0.6;
ball.translate = [0, 0.6, 0];
ball.material = gold;
box = new Cube({ size: 0.8, translate: [-1.6, 0.4, 0.4], rotate: [0, 30, 0], material: terracotta });
pipe = new Cylinder({ radius: 0.35, height: 1.2, translate: [1.6, 0.6, 0.5], material: blue });
cone = new Cone({ radius: 0.4, height: 1, translate: [0.1, 0.5, -2.1], material: terracotta });
pill = new Capsule({ radius: 0.25, height: 0.7, axis: "X", translate: [0.9, 0.25, 1.6], material: blue });
ring = new Torus({ radius: 0.45, minorRadius: 0.12, rotate: [70, 0, 0], translate: [1.2, 0.6, -1.4], material: gold });
lens = new Disk({ radius: 0.5, axis: "Z", translate: [-0.2, 0.7, 1.7], material: pane });
log(`Objets : ${objects().join(", ")}`);
check(objects().length === 8, "8 primitives dans la scène");

render.resolution = mobile ? 256 : 512;
setCamera({ eye: [4.2, 3, 5.2], target: [0, 0.4, 0], fov: 40 });

// 1. Raster puis path tracing de la même scène.
render.backend = "raster";
await save("01-raster.png");
render.backend = "pathtracing";
render.depth = 8;
await render(spp(256));
await save("02-pathtracing.png");

// 2. Déplacement et masquage : appliqués sans recharger la scène.
ball.translate = [0, 1.4, 0];
pipe.visible = false;
await render(spp(128));
await save("03-deplacement.png");
ball.translate = [0, 0.6, 0];
pipe.visible = true;

// 3. Forme, résolution et matériau : la scène est reconstruite.
ball.radius = 0.8;
ball.translate = [0, 0.8, 0];
ball.material = glass;
box.resolution = 4;
cone.resolution = 6;
await render(spp(256));
await save("04-modifications.png");

// 4. Export USD : gprims implicites (tore et disque en maillages) et documents MaterialX à côté.
// Le fichier se recharge comme une scène ordinaire (scene("…/primitives.usda")).
await save("scene/primitives.usda");

// 5. Suppression d'un objet.
pill.remove();
check(objects().length === 7, "capsule retirée");
await render(spp(128));
await save("05-sans-capsule.png");
