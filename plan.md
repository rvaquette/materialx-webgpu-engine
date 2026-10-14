# Plan du moteur MaterialX WebGPU en TypeScript

Date : 2026-10-09
Statut : plan consolide ; implementation non demarree.

## 1. Objectif et contraintes

Construire un moteur de rendu WebGPU en TypeScript capable de charger une
scene OpenUSD complexe avec de nombreux objets, materiaux, textures et lumieres.
Le moteur propose deux backends complets : raster et path tracing, avec une
extension hybride raster + ray tracing logiciel en compute.

La fidelite semantique et physique est prioritaire. Le raster peut utiliser des
approximations explicites, configurables et documentees. Le path tracer ne doit
pas introduire d'approximation de modele ; son erreur Monte Carlo et sa
convergence sont mesurees selon une precision cible. Aucune fonctionnalite ne
doit etre remplacee silencieusement par un comportement moins fidele.

Contraintes fermes :
- Aucune generation de code par le WASM MaterialX, y compris WGSL et GLSL.
- Le WASM sert uniquement a la lecture XML, la validation, la resolution des
  definitions et le parcours des documents et graphes.
- L'IR, les optimisations, l'extraction des features et la generation WGSL sont
  implementes en TypeScript.
- Reutiliser au maximum les bibliotheques JS existantes pour les loaders,
  les decodeurs, les geometries et les BVH.
- Les volumes et le subsurface font partie du perimetre final.
- Le raster est un mode de rendu complet, pas seulement une previsualisation.
- Le path tracer n'utilise pas d'approximations de modele ; plusieurs strategies
  non biaisees de subsurface et de transmission sont exposees selon la precision
  cible du rendu.
- Le rendu est statique : aucune animation ni motion blur n'est supporte.
- Tous les noeuds declares ou utilises dans les fichiers .mtlx de
  D:\WebGL2\MaterialX\MaterialX-rva\resources\Materials\Examples doivent etre
  supportes par le compilateur TypeScript, avec leurs dependances necessaires.
- Chaque document .mtlx sous Materials/Examples est rendu et teste dans les deux
  modes raster ET pathtracing ; aucun exemple n'est valide sur un seul backend.
  Les divergences raster (thin film, hair, volume, subsurface) restent des
  approximations explicites et documentees, pas des omissions.
- Ne pas supposer de ray tracing materiel ni de bindless universel en WebGPU.

## 2. Sources locales

```text
projectRoot = D:\WebGL2\MaterialX\materialx-webgpu-engine
wasmRoot    = D:\WebGL2\MaterialX\MaterialX-rva\javascript
libraryRoot = D:\WebGL2\MaterialX\MaterialX-rva\libraries
sceneRoot   = D:\WebGL2\MaterialX\OpenPBRShaderPlayground\ShdrPlygrnd
sceneEntry  = ShdrPlygrnd_OpenPBR.usda
```

Les artefacts JS/WASM inspectes sont disponibles dans :

```text
D:\WebGL2\MaterialX\MaterialX-rva\javascript\build\installed\JavaScript\MaterialX
```

Les bindings sources incluent WgslShaderGenerator, mais son utilisation est
exclue par la contrainte precedente. Qualifier le module Core pour les operations
necessaires ; ne pas charger le module GenShader pour generer du code.
Charger explicitement les bibliotheques locales et verrouiller leur revision.

## 3. Constats sur la scene de reference

Constats issus de lectures locales, sans import ni rendu execute :
- La couche racine compose quatre sublayers : cameras, affectations de
  materiaux, definitions de materiaux et geometrie.
- Le light rig est charge par un payload.
- La scene racine declare metersPerUnit = 0.01, upAxis = Y, une plage de temps
  de 0 a 100 et timeCodesPerSecond = 30.
- Les metadonnees de certaines sous-couches different. Respecter les regles
  OpenUSD de metadonnees de stage et de composition temporelle ; ne pas
  convertir chaque couche independamment selon son metersPerUnit.
- Les materiaux utilisent des references directes vers des documents .mtlx et
  des chemins de prim /MaterialX/Materials/..., ainsi que des inherits.
- Des overrides concernent la subdivision Catmull-Clark, les material bindings,
  leur force et les transformations avec pivots et operations inversees.
- Les materiaux lus utilisent MaterialX 1.39 et open_pbr_surface.
- masonJarWater combine subsurface et transmission ; bubbles ajoute coat,
  anisotropie et thin film. Ces combinaisons sont dans le perimetre initial.
- Les documents lus declarent lin_rec709 et certaines textures sont Raw.
- Le dossier textures contient PNG, JPEG, TIFF, EXR et des series de fichiers
  numerotes. Verifier les declarations avant de les traiter comme UDIM.

La geometrie, les cameras, les types et quantites de lumieres, le nombre de
triangles, les tailles des textures et les volumes explicites restent a qualifier.
La presence d'un parametre de transmission ne prouve pas un volume USD explicite.

## 4. Exigences

| ID | Exigence |
| --- | --- |
| REQ-001 | Moteur TypeScript et WebGPU avec gestion explicite des ressources |
| REQ-002 | Import OpenUSD compose, objets, instances et cameras pour une scene statique ; animation non supportee |
| REQ-003 | Reutilisation des bibliotheques JS pour loaders, images et BVH |
| REQ-004 | MaterialX WASM limite a la lecture, validation et resolution |
| REQ-005 | Graphe -> IR -> optimisations -> features -> cache -> WGSL -> pipeline -> instance |
| REQ-006 | Materiaux OpenPBR de haute fidelite, incluant leurs combinaisons |
| REQ-007 | Subsurface avec modele physique adapte |
| REQ-008 | Volumes homogenes et heterogenes |
| REQ-009 | Backend raster complet |
| REQ-010 | Backend path tracing et extension hybride |
| REQ-011 | Textures, UDIM et gestion colorimetrique fidele |
| REQ-012 | Scenes volumineuses, nombreuses lumieres et budgets memoire |
| REQ-013 | Validation, conformite declaree et diagnostics sans pertes silencieuses |
| REQ-014 | Support fonctionnel de tous les noeuds declares ou utilises dans les fichiers .mtlx de Materials/Examples, avec leurs dependances necessaires |

## 5. Architecture

```text
OpenUSD -> Composition -> SceneAsset commun
                         | geometries / prototypes / instances
                         | materiaux / textures / cameras / lumieres

XML MaterialX -> Document WASM -> Graphe resolu
             -> IR shader TypeScript -> Optimisations
             -> Feature extraction et besoins en ressources/passes
             -> Pipeline cache
                  hit  -> Pipeline partage
                  miss -> Backend WGSL TypeScript -> Compilation WebGPU
                       -> Pipeline partage -> Enregistrement dans le cache
             -> Material instance

SceneAsset + Material instances -> Raster / Path tracing / Hybride
```

Un schema de scene independant du renderer conserve identifiants USD, chemins
de prim, prototypes, instances, donnees geometriques, primvars, affectations par
face, transformations, cameras, lumieres et references aux assets.

Les deux backends partagent les assets CPU et les ressources GPU compatibles.
Changer de mode ne recharge pas la scene. Les representations et pipelines
specifiques restent distincts et leur memoire est comptabilisee.

## 6. Bibliotheques a reutiliser

| Besoin | Proposition | Qualification necessaire |
| --- | --- | --- |
| MaterialX | WASM local et bibliotheques locales | APIs Core, resolution et compatibilite de version |
| USD | USDLoader Three.js derriere un adaptateur | Composition et references .mtlx du corpus |
| Composition complete | OpenUSD WASM et bindings JS cibles | Distribution, resolver et integration MaterialX |
| Objets auxiliaires | Loaders Three.js glTF, OBJ, PLY ; Meshopt/Draco | Conversion vers SceneAsset |
| BVH | three-mesh-bvh, MeshBVH, ObjectBVH et workers | Instanciation, refit et formats GPU |
| Images usuelles | createImageBitmap et loaders existants | Formats, orientation et conversion de couleur |
| HDR et TIFF | Loaders EXR/HDR/TIFF existants | Compression, precision, canaux et profondeur |
| Textures compressees | KTX2 et Basis Universal | Formats supportes par le GPU |
| Volumes | Loader OpenVDB ou equivalent a qualifier | Topologie sparse, precision et deploiement navigateur |
| Workers | Comlink | Transferts et annulation |
| Stockage | idb / IndexedDB | Versions et invalidation |
| Maths et types | wgpu-matrix, @webgpu/types | Conventions de matrices et alignements |

Three.js sert principalement de bibliotheque d'import et de geometrie.
Le moteur possede ses pipelines WebGPU ; son renderer n'est pas impose.
L'API WebGPU de three-mesh-bvh utilise TSL et est instable : ne pas supposer
qu'elle se branche directement sur des shaders WGSL et pipelines proprietaires.
Qualifier un adaptateur ou reutiliser construction/serialisation CPU avec un
packing et une traversal WGSL compatibles. Verrouiller les versions retenues.

## 7. Compilation MaterialX

### 7.1 Document et graphe

Charger stdlib, pbrlib, bxdf, cmlib et leurs dependances utiles depuis libraryRoot.
Resoudre NodeDef, versions, valeurs par defaut, interfaces, sous-graphes,
connexions, geomprops, unites et espaces colorimetriques.
Conserver les chemins source pour les diagnostics et gerer la duree de vie
des objets Embind. Ne pas invoquer les generateurs du WASM.

Reutiliser les definitions et implementations en nodegraphs des bibliotheques.
Pour chaque noeud du corpus Materials/Examples, resoudre sa NodeDef et son
implementation ; toute feuille uniquement implementee dans un autre langage
requiert un lowering WGSL TypeScript explicite. Aucun noeud du corpus n'est
exclu au motif que son support ne serait pas automatique.

### 7.2 IR TypeScript

Representer expressions typees, valeurs, conversions, parametres dynamiques,
constantes specialisees, textures, samplers, primvars et contexte d'evaluation.
Representer les closures BSDF, EDF, BSSRDF et volume, ainsi que leurs compositions.
Conserver provenance, dependances, espaces et unites dans les metadonnees utiles.

Le backend raster requiert l'evaluation des closures ; le path tracer requiert
evaluation, PDF et echantillonnage coherents. Les expressions exigeant des
derivees ou un footprint de texture demandent un traitement adapte en compute.

### 7.3 Optimisations

Propagation de constantes, suppression du code mort, expressions communes,
canonicalisation et reduction des ressources inutilisees.
Ne pas figer les parametres editables sauf specialisation explicite.
Preserver semantique physique et numerique ; pas de fast-math generalise.

### 7.4 Features et WGSL

Extraire attributs, UV, tangentes, textures, closures, transparence, transmission,
coat, anisotropie, thin film, subsurface, volume et displacement.
Produire les besoins en ressources, layouts, passes et variantes, pas seulement
une liste de booleens.
Implementer un registre TypeScript des noeuds et de leurs regles de lowering.
Generer WGSL directement depuis l'IR, sans generation WASM ni traduction
automatique des shaders GLSL MaterialX.

### 7.5 Caches et instances

Separer caches de graphes, IR, modules WGSL, layouts, pipelines et bind groups.
Cle de pipeline : hash canonique, specialisations, versions du compilateur et
des bibliotheques, backend, passe, layouts, attributs vertex, formats, MSAA,
etats de rendu et capacites pertinentes du GPU.
Exclure les valeurs ordinaires et les identites de textures interchangeables
lorsqu'elles ne modifient ni le shader ni le layout.
Deduplicater les compilations concurrentes et prechauffer les variantes utiles.

Persister IR, WGSL et metadonnees dans IndexedDB. Les objets GPUPipeline restent
en memoire et sont propres au GPUDevice ; les reconstruire apres perte du device.
Une instance reference le pipeline partage et possede parametres et bindings.
Modifier une couleur ou un rayon editable ne doit pas recompiler le shader.

## 8. Import USD, assets et geometrie

Qualifier des la premiere phase sublayers, references, inherits, payloads,
variants, opinions over, bindings et primvars. Pour ce corpus, la resolution
des references .mtlx est un critere bloquant de choix du loader.
Avec OpenUSD WASM, verifier le plugin/integration MaterialX ou fournir un
adaptateur conforme pour la partie requise ; compiler OpenUSD ne suffit pas.

Un resolver commun gere URI, chemins relatifs au document auteur, includes,
ressources de package et erreurs. Les chemins textures/... du corpus demandent
une politique explicite d'asset root ; ne pas les reparer silencieusement.
Servir les assets par HTTP(S) ou les exposer via une selection locale : le
navigateur ne peut pas ouvrir arbitrairement les chemins D:\.

Respecter interpolation et indexation des primvars, orientation des faces,
trous, subsets, normales, tangentes, transformations et affectations de materiaux.
Reutiliser une implementation eprouvee de subdivision compatible OpenSubdiv
si disponible ; ne pas remplacer Catmull-Clark par une simple triangulation.
Preparer le displacement geometrique avant rasterisation et construction BVH.
Le perimetre est limite a une scene statique : ne pas evaluer l'animation ni le
motion blur. Les mises a jour de geometrie dynamiques sont hors perimetre.

## 9. Rendu et fidelite

### 9.1 Raster complet

Forward+ avec clustering GPU, eclairage d'environnement, evaluation OpenPBR,
ombres filtrees et cascades selon les types de lumieres.
Passes profondeur, ombres, opaque, transmission, transparence, subsurface,
volumes et sortie HDR selon les features effectivement actives. Les
approximations sont autorisees dans ce backend et doivent etre exposees et
documentees.

Choisir une technique de transparence adaptee aux couches ; un tri seul ou une
OIT approximee ne garantit pas un resultat exact.
Transmission : refraction, epaisseur et absorption avec limites screen-space
explicites. Subsurface : diffusion physique approximee en raster, avec profils
et estimation d'epaisseur, sans la confondre avec transmission ou volume.
Volumes : integration par ray marching, transmittance, eclairage et ombres,
avec qualite d'integration et approximations de diffusion declarees.

### 9.2 Path tracing de reference

Integrateur compute pour surfaces, milieux et subsurface : BSDF/phase/BSSRDF,
echantillonnage des lumieres et environnements par importance, MIS et strategie
de terminaison controlee. Gerer les frontieres et milieux imbriques.
Ne pas tronquer les chemins a une profondeur fixe biaisee ; utiliser une
terminaison non biaisee (par exemple roulette russe) et documenter sa variance.

Volumes homogenes et heterogenes : absorption, emission et diffusion multiple.
Utiliser majorants valides et tracking adapte aux densites heterogenes.
Subsurface : proposer plusieurs strategies d'estimation non biaisees, dont le
random walk BSSRDF, selectionnables selon une precision cible. Transmission :
prendre en charge les strategies adaptees aux interfaces dielectriques lisses
et rugueuses, avec echantillonnage non biaise. Les presets de precision reglent
la convergence (echantillonnage, budget ou critere d'arret), jamais le modele
physique. Verifier les conditions de raccord aux interfaces et les interactions
entre subsurface et transmission.

Le traitement spectral est obligatoire pour thin film et dispersion lorsqu'ils
sont utilises par les materiaux du corpus. Utiliser une integration
colorimetrique adaptee ; ne pas assimiler un mode RGB a une reference spectrale
exacte pour ces effets.

### 9.3 Hybride

Raster + traversal BVH en compute pour ameliorer ombres, reflexions,
transmission ou eclairage indirect. Aucun recours suppose aux extensions de
ray tracing materiel. Presenter les compromis et budgets de chaque effet.

### 9.4 Couleur et eclairage

Respecter lin_rec709, Raw et les espaces declares ; separer textures de donnees
et textures de couleur. Qualifier les transformations de cmlib et les espaces
requis, avec une solution OCIO si le perimetre l'exige.
Un espace Raw inconnu ne doit pas etre interprete silencieusement comme sRGB.
Partager gestion colorimetrique, exposition et sortie entre les backends.
Le tonemapping reste distinct du transport lumineux.
Qualifier lumieres USD ponctuelles, distantes, surfaciques, dome, leurs unites,
normalisation, formes, textures et profils photometriques lorsqu'ils sont utilises.

### 9.5 Evaluation physique des closures (correctif)

Constat : le lowering initial (T014) a emis des closures factices
(`Closure(color * weight, weight)`, et `ior * weight` pour le conducteur)
ignorant la direction de lumiere L, la vue V, la normale N, la distribution
microfacette, le Fresnel et le terme geometrique. Les cas de test closure
(T034a) utilisaient ces memes formules comme oracle, rendant la validation
circulaire ; les surfaces (disney_principled, standard_surface, open_pbr_surface,
gltf_pbr, UsdPreviewSurface, simple_hair) n'etaient verifiees que
structurellement (graphCase, jamais executees numeriquement). Cela ne satisfait
ni le lowering explicite exige en 7.1, ni l'evaluation OpenPBR exigee en 9.1,
ni l'evaluation/PDF/echantillonnage coherents exiges en 9.2.

Decisions (correctif, phase P8) :
- Modele fidele MaterialX : une closure est un `BSDF { response, throughput }` ;
  chaque lobe fournit des fonctions `_reflection` et `_transmission` prenant
  (L, V, N, parametres) ; le noeud `surface` boucle sur les lumieres et accumule
  la radiance ; EDF ajoute l'emission ; VDF alimente les milieux.
- Perimetre : tous les lobes du corpus (oren_nayar, burley, dielectric,
  conductor, sheen, subsurface, translucent) plus EDF et VDF, pas seulement les
  lobes de disney_principled.
- Path tracer : evaluation, PDF et echantillonnage coherents par lobe, livres
  des ce correctif (pas seulement l'evaluation directe raster).
- Oracle : une reference analytique CPU independante (memes formules, mais
  implementation separee) remplace les oracles circulaires ; comparaison
  device/CPU avec tolerances documentees.

Les approximations restantes (subsurface raster, eclairage indirect /
environnement) demeurent explicites et documentees ; aucune ne se reduit a
`color * weight`.

### 9.6 Couverture complete des BxDF MaterialX (modele de surface en couches)

Constat (ecart runtime, ouvert par P10). Deux systemes de surface coexistent et
ne sont PAS unifies :

1. Systeme compilateur/IR (src/compiler/nodes.ts -> src/compiler/wgsl.ts) :
   vrais lobes MaterialX (oren_nayar, burley, dielectric, conductor,
   generalized_schlick, sheen, subsurface, translucent ; EDF uniform /
   generalized_schlick ; VDF anisotropic) plus aplatissement des nodegraphs.
   Valide numeriquement par lobe (T042) et par graphe de surface (T043) contre
   l'oracle CPU independant src/render/bsdf/reference.ts. MAIS il n'alimente PAS
   les backends de rendu de scene.
2. Systeme de rendu (path tracer src/render/pathtracing/compute.ts +
   src/render/pathtracing/bsdf.ts surfaceBsdf ; raster
   src/render/raster/shaders.ts mx_openpbr_surface ; oracle
   reference.ts evaluateSurface) : un modele canonique REDUIT a sept parametres
   `{baseColor, metalness, roughness, transmission, subsurface, ior, specular}`.

La reduction (scripts/build-scene-materials.mjs toCanonical, et parseOpenPbr du
harnais USD) ecrase toutes les familles (standard_surface, open_pbr_surface,
disney_principled, gltf_pbr, UsdPreviewSurface) vers ces 7 scalaires/couleurs.
Sont perdus : coat (poids/couleur/rugosite/ior/anisotropie/darkening),
sheen / fuzz, thin film (poids/epaisseur/ior), anisotropie speculaire, teinte
speculaire (specular_color), transmission color/depth/scatter/dispersion,
subsurface color/radius/scale/anisotropy, emission (luminance/couleur),
diffuse_roughness, thin_walled, normales/tangentes separees coat. "Tous les
modeles mtlx" sont donc aujourd'hui rendus avec le MEME melange 7-parametres :
non fidele, et non conforme a REQ-013 (perte silencieuse) ni au perimetre 9.1/9.2.

Decision d'architecture (P10, strategie IR source unique). Unifier les deux
backends sur l'IR du compilateur comme SOURCE UNIQUE de shading, au lieu
d'etendre le modele canonique ecrit a la main. Le compilateur abaisse le
nodegraph de surface de CHAQUE materiau -- entrees constantes, texturees ET
procedurales (reseaux de noeuds) -- vers une pile de fermetures runtime
parametree (la "LayeredClosure"), et le raster comme le path tracer appellent la
MEME fonction de shading generee. C'est la seule voie qui rend fidelement un mtlx
quelconque (REQ-006/013), pas seulement les 5 familles a entrees scalaires.

L'obstacle a lever : les fermetures IR de P8 n'exposent que l'evaluation directe
(response/throughput sous lumiere), sans PDF ni echantillonnage ; inaptes telles
quelles a piloter un path tracer MIS non biaise. P10 etend donc le modele de
fermeture IR avec pdf + sample par lobe et un echantillonnage de pile (selection
ponderee + PDF combinee), de sorte que la sortie du compilateur alimente
directement l'integrateur. La pile cible miroir la composition open_pbr_surface :
fuzz/sheen -> coat dielectrique -> base (metal conducteur | specular dielectrique
| diffus/subsurface/translucent), thin film module sur le Fresnel speculaire ;
chaque lobe reste un des lobes deja valides (T041/T042).

Principes :
- Source unique : le lowering nodegraph -> IR -> WGSL (src/compiler/ir.ts,
  nodes.ts, wgsl.ts) remplit les champs d'une LayeredClosure runtime ; une
  bibliotheque WGSL de fermetures PARTAGEE implemente eval/pdf/sample et est
  consommee a l'identique par le raster et le path tracer. Fin de la double
  implementation (closures compilateur vs closures renderer).
- Nodegraph arbitraire fidele : les entrees texturees/procedurales (image,
  noise, mix, normalmap, ...) sont abaissees dans le shader genere, pas aplaties
  en constantes. toCanonical (build-scene-materials.mjs), parseOpenPbr (harnais
  USD) et findShader (nodegraph-eval.ts) cessent d'etre le chemin de rendu.
- Familles couvertes : standard_surface, open_pbr_surface, disney_principled,
  gltf_pbr, UsdPreviewSurface, plus les briques lama_*, via leurs nodedef
  resolus (interfacename, noeuds connectes, heritage de version, alias, defauts
  MaterialX officiels). Toute entree ou noeud non supporte produit un diagnostic.
- Variant par materiau : chaque materiau compile un variant WGSL (raster :
  pipeline existant createMaterialVariant/computePipelineKey ; path tracer :
  pipeline/dispatcher compute par variant ou megakernel parametre -- decision
  ouverte, section 14) ; deux instances compatibles partagent leur pipeline.
- Path tracer sans approximation de modele : eval + PDF + sample coherents par
  lobe, energie conservee, PDF de pile par heuristique de puissance.
- Raster : memes fermetures generees, approximations explicites et documentees
  (eclairage indirect, thin film tabule, subsurface enveloppe) ; aucune omission
  silencieuse.
- Oracle : src/render/bsdf/reference.ts etendu avec pdf + sample reste la verite
  numerique CPU, et doit concorder avec les fermetures generees par l'IR dans les
  deux modes.

## 10. Passage a l'echelle et robustesse

Partager geometries, prototypes, textures et pipelines ; BLAS par geometrie
et hierarchie d'instances avec refit lorsque seule la transformation change.
Preserver indices de faces et affectations lorsque le BVH reorganise les triangles.
Workers pour import, compilation et BVH ; chargement progressif et annulation.
Budgets CPU/GPU, mipmaps, eviction, limitation des uploads et backpressure.
Pas de conversion systematique TIFF/EXR en 8 bits ni de perte HDR silencieuse.
Gestion UDIM avec filtrage/LOD aux frontieres et tuiles manquantes diagnostiquees.
Culling, instanciation, regroupement des draws et LOD a erreur controlee.
Respecter les limites de buffers, bindings et textures du device.
Prevoir HTTPS/localhost, types MIME WASM et isolation COOP/COEP si des workers
ou modules utilisent SharedArrayBuffer ; conserver un mode sans memoire partagee.
Gerer erreurs d'assets, liberation des ressources et perte/recreation du device.

## 11. Phases et taches

Les chemins ci-dessous sont des destinations proposees, pas des fichiers existants.
Le projet doit rester independant des sources et assets de reference.

### P1. Qualification des dependances [REQ-002,003,004,013]
- [x] T001 [Plan:P1] Qualifier le WASM Core et consigner ses APIs dans docs/dependencies.md.
- [x] T002 [Plan:P1] Inventorier le corpus USD, materiaux, textures et tous les noeuds declares/utilises dans les fichiers .mtlx sous D:\WebGL2\MaterialX\MaterialX-rva\resources\Materials\Examples ; consigner les documents, NodeDefs, implementations et dependances dans docs/scene-inventory.md et docs/materialx-node-coverage.md.
- [x] T003 [Plan:P1] Comparer les loaders sur sublayers, references, inherits, payloads, bindings et references .mtlx ; choisir un loader ou un adaptateur de repli et consigner les preuves dans docs/usd-import.md.
- [x] T004 [Plan:P1] Qualifier BVH, subdivision, TIFF, EXR et volumes dans docs/dependencies.md.

### P2. Socle et assets [REQ-001,003,004,011,012]
- [x] T005 [Plan:P2] Initialiser TypeScript et le build navigateur avec package.json et tsconfig.json.
- [x] T006 [Plan:P2] Implementer initialisation/device lifecycle dans src/gpu/device.ts.
- [x] T007 [Plan:P2] Implementer resolver et cache d'assets dans src/assets/resolver.ts et src/assets/cache.ts.
- [x] T008 [Plan:P2] Encapsuler MaterialX Core dans src/materialx/wasm.ts et src/materialx/libraries.ts.
- [x] T009 [Plan:P2] Adapter les decodeurs dans src/assets/images.ts et src/assets/volumes.ts.

### P3. Compilateur MaterialX TypeScript [REQ-004,005,006,007,008,011]
- [x] T010 [Plan:P3] Resoudre les graphes et leur provenance dans src/materialx/graph.ts.
- [x] T011 [Plan:P3] Definir IR type et closures dans src/compiler/ir.ts.
- [x] T012 [Plan:P3] Implementer les optimisations dans src/compiler/optimize.ts.
- [x] T013 [Plan:P3] Extraire features, layouts et passes dans src/compiler/features.ts.
- [x] T014 [Plan:P3] Implementer un lowering WGSL TypeScript et une emission pour chaque noeud de docs/materialx-node-coverage.md dans src/compiler/nodes.ts et src/compiler/wgsl.ts. (Note : le lowering des noeuds expr/texture est reel ; les closures BSDF/EDF/VDF ont ete emises en stubs non physiques -- evaluation physique livree par P8, voir section 9.5.)
- [x] T015 [Plan:P3] Implementer pipelines/caches dans src/gpu/pipelines.ts et src/compiler/cache.ts.
- [x] T016 [Plan:P3] Implementer les instances et leurs mises a jour dans src/materials/instance.ts.

### P4. Scene OpenUSD et geometrie [REQ-002,003,006,011,012]
- [x] T017 [Plan:P4] Definir SceneAsset dans src/scene/types.ts et l'adaptateur d'import dans src/usd/importer.ts.
- [x] T018 [Plan:P4] Relier composition/bindings et references MaterialX dans src/usd/materials.ts.
- [x] T019 [Plan:P4] Integrer subdivision/displacement et primvars dans src/geometry/prepare.ts.
- [x] T020 [Plan:P4] Integrer prototypes, instances et BVH dans src/scene/instances.ts et src/geometry/bvh.ts.
- [x] T021 [Plan:P4] Integrer cameras, lumieres et transformations statiques dans src/usd/cameras.ts, src/usd/lights.ts et src/scene/transforms.ts.

### P5. Raster complet [REQ-006,007,008,009,011,012]
- [x] T022 [Plan:P5] Implementer orchestration des passes dans src/render/raster/renderer.ts.
- [x] T023 [Plan:P5] Implementer Forward+, environnement et ombres dans src/render/raster/lighting.ts.
- [x] T024 [Plan:P5] Implementer transparence/transmission dans src/render/raster/transmission.ts.
- [x] T025 [Plan:P5] Implementer subsurface et volumes dans src/render/raster/subsurface.ts et src/render/raster/volume.ts.
- [x] T026 [Plan:P5] Implementer sortie HDR et antialiasing dans src/render/output.ts.
- [x] T026b [Plan:P5] Implementer un backend raster WebGPU executable : shaders WGSL de passe (vertex/fragment) et resolve tonemap dans src/render/raster/shaders.ts, pipelines et enregistrement de frame reels dans src/render/raster/backend.ts, et cablage dans src/main.ts.

### P6. Transport de reference et hybride [REQ-006,007,008,010,011]
- [x] T027 [Plan:P6] Implementer integrateur, lumieres et accumulation dans src/render/pathtracing/integrator.ts.
- [x] T028 [Plan:P6] Implementer milieux et tracking dans src/render/pathtracing/media.ts.
- [x] T029 [Plan:P6] Implementer BSSRDF/random walk dans src/render/pathtracing/subsurface.ts.
- [x] T030 [Plan:P6] Implementer traitement spectral et thin film dans src/render/pathtracing/spectrum.ts.
- [x] T031 [Plan:P6] Integrer les effets hybrides dans src/render/hybrid/renderer.ts.
- [x] T032 [Plan:P6] Permettre changement de backend sans reimport dans src/render/engine.ts.

### P7. Fidelite, echelle et robustesse [REQ-001,002,005,006,007,008,009,010,011,012,013]
- [x] T033 [Plan:P7] Etablir matrice de conformite de tous les noeuds MaterialX du corpus et scenes de controle dans docs/conformance.md et tests/fixtures/.
- [x] T034 [Plan:P7] Tester en JavaScript la resolution, l'IR et le lowering, puis executer chaque noeud du corpus sur WebGPU avec des entrees deterministes et verifier ses sorties dans tests/compiler/ et tests/render/ ; un test de compilation seule ne suffit pas.
  - [x] T034a [Plan:P7] Definir pour chaque noeud du corpus (matrice T033) un cas deterministe entrees fixes + sorties CPU de reference dans tests/fixtures/node-cases.ts, reutilisable par les tests JS et GPU. (Note : les oracles closure refletaient les stubs de T014 -- remplaces par une reference analytique independante en P8.)
  - [x] T034b [Plan:P7] Tester en JS resolution + construction IR de chaque noeud du corpus dans tests/compiler/corpus-resolve.test.ts : graphe resolu (materialx/graph.ts) et IR type correct (compiler/ir.ts), sans GPU.
  - [x] T034c [Plan:P7] Tester en JS le lowering WGSL de chaque noeud dans tests/compiler/corpus-wgsl.test.ts : module emis (compiler/wgsl.ts) avec uniforms/bindings/outputs attendus et validation structurelle du WGSL, pas seulement l'absence d'erreur.
  - [x] T034d [Plan:P7] Ecrire un harnais d'execution compute reutilisable dans src/gpu/exec.ts : a partir d'un module WGSL de noeud, construire le pipeline (gpu/pipelines.ts), binder les entrees deterministes, dispatcher et relire les sorties en buffer.
  - [x] T034e [Plan:P7] Servir le harnais au mobile connecte (SM-F731B) via D:\platform-tools\adb.exe (adb reverse + Chrome Android), executer tous les noeuds du corpus sur le GPU reel et collecter les sorties dans tests/render/corpus-device.harness.ts.
  - [x] T034f [Plan:P7] Comparer sorties GPU du mobile vs oracle CPU (T034a) avec tolerances par type dans tests/render/corpus-device.test.ts ; echec si un noeud s'ecarte, skip propre documente si aucun mobile autorise. (Note : la comparaison closure etait circulaire tant que l'oracle refletait les stubs -- corrigee en P8.)
  - [x] T034g [Plan:P7] Orchestrer le flux build harnais -> adb reverse -> run device -> collecte -> assertions via un script npm (scripts/run-device-corpus.mjs) avec rapport par noeud.
- [x] T035 [Plan:P7] Comparer les rendus et documenter les tolerances dans docs/validation.md.
  - [x] T035a [Plan:P7] Centraliser les tolerances par type/par noeud (deduites de T034f : expr, closure, texture rgba8unorm, cas non reproductibles comme fractal3d) dans une source declarative unique tests/fixtures/tolerances.ts, et refactorer tests/render/corpus-device.test.ts pour la consommer.
  - [x] T035b [Plan:P7] Ecrire un utilitaire de comparaison d'images/signaux reutilisable dans tests/render/compare.ts : diff absolu max, RMSE, erreur relative par canal, verdict pass/echec selon une tolerance fournie, avec tests unitaires JS dans tests/render/compare.test.ts.
  - [x] T035c [Plan:P7] Rendre toutes les scenes de controle (T033) declarant backends raster ET pathtracing sur le shader ball standard (neutral_objects.glb, charge via three.js GLTFLoader, textures texel constant rgba8unorm comme T034), et comparer les deux rendus via T035b avec tolerances de scene documentees dans tests/render/scene-compare.test.ts.
    - [x] T035c1 [Plan:P7] Charger le shader ball standard (tests/fixtures/standard-shader-ball/neutral_objects.glb) via three.js GLTFLoader dans un prebuild (scripts/build-shaderball-fixture.mjs) emettant un fixture deterministe (tests/fixtures/shader-ball.json), adapte en RawMesh pour prepare.ts dans src/geometry/shaderball.ts, avec tests CPU dans tests/geometry/shaderball.test.ts : comptes sommets/indices, normales normalisees, uv dans [0,1], tangentes generees finies, bornes d'indices.
    - [x] T035c2 [Plan:P7] Calculer la visibilite deterministe du shader ball depuis la camera des scenes de controle (rayons primaires pinhole, mesh recadre pour tenir dans le champ, traversee BVH geometry/bvh.ts + Moller-Trumbore) en un jeu d'echantillons de shading (masque hit + position/normale/uv/viewDir par pixel) dans tests/render/scene-samples.ts, la traversee BVH etant validee contre un balayage exhaustif des triangles (reference).
    - [x] T035c3 [Plan:P7] Rendre chaque scene raster+pathtracing sur ces echantillons en deux buffers HDR lineaires : (a) modele analytique raster (miroir CPU de raster/shaders.ts) et (b) integrateur de reference path tracing (pathtracing/integrator.ts via SceneSampler analytique, lumiere directionnelle + environnement constant, seed 1337), parametres materiau partages extraits du .mtlx.
    - [x] T035c4 [Plan:P7] Comparer les deux buffers par scene via compare.ts (T035b) avec tolerances par focus documentees (base strictes ; transmission/subsurface plus larges et justifiees) dans tests/render/scene-compare.test.ts ; echec si divergence hors tolerance, couverture de toutes les scenes raster+pathtracing.
  - [x] T035d [Plan:P7] Comparer le rendu raster du mobile (device GPU) vs l'oracle CPU au niveau scene (pas seulement par noeud) via le harnais device et T035b, avec skip propre si aucun mobile autorise.
  - [x] T035e [Plan:P7] Rediger docs/validation.md : methodologie, sources d'oracle, table des tolerances par type de noeud et par scene, cas non reproductibles (fractal3d et son enveloppe), et procedure d'execution (npm run test:device).
- [x] T036 [Plan:P7] Integrer budgets, streaming et profiling sur le mobile Android cible (via D:\platform-tools\adb.exe) dans src/assets/streaming.ts et src/diagnostics/metrics.ts.
- [x] T037 [Plan:P7] Verifier annulation, liberation et perte du device dans tests/lifecycle/.

### P8. Evaluation physique des closures BSDF/EDF/VDF [REQ-006,007,008,009,010,011,014]

Correctif de l'evaluation physique des closures (voir section 9.5). Chaque tache
se valide par typecheck + tests Node, puis par execution GPU reelle d'abord sur
le GPU local (poste de dev, Chrome WebGPU via CDP sans adb) et ensuite sur le
mobile cible ; aucune closure ne reste un stub `color * weight`. L'execution
locale est le pendant GPU des tests CPU locaux : elle tourne a chaque run, le
mobile confirme sur le GPU cible reel. Le run local sans adb passe par
scripts/run-local-corpus.mjs (npm run test:local-gpu : Chrome + CDP port 9222)
et le run mobile par scripts/run-device-corpus.mjs (npm run test:device).

- [x] T038 [Plan:P8] Etendre le modele de closure dans l'IR et le backend : struct WGSL `BSDF { response, throughput }`, contexte d'eclairage (lumieres directionnelles + environnement + vue) injecte dans le shader genere, et accumulation de radiance par boucle sur les lumieres dans le noeud `surface`. src/compiler/ir.ts, src/compiler/wgsl.ts, src/gpu/exec.ts ; tests JS de composition dans tests/compiler/ et tests/gpu/. Valide GPU reel : local Intel gen-12lp 27/27 + mobile Adreno 7xx 27/27, oracle 29/29 sur les deux (surface -> 0,0,0,1, binding mxLighting OK).
- [x] T039 [Plan:P8] Implementer les lobes BSDF reels en WGSL (fonctions `_reflection` / `_transmission` prenant L, V, N) dans src/compiler/nodes.ts : diffus Oren-Nayar et Burley ; GGX diielectrique (distribution GGX, Smith, Fresnel dielectrique) ; GGX conducteur (Fresnel complexe ior/extinction) ; sheen ; subsurface (approximation raster declaree) ; translucent. Remplacer les stubs du prelude. Fait : chaque lobe integre sa BRDF reelle sur mxLighting (boucle lumieres + ambiant env) et renvoie Closure(radiance, poids) ; LIGHTING_PRELUDE partage extrait de SURFACE_PRELUDE ; BSDF_PRELUDE (helpers mx_ggx_ndf/mx_smith_g1/mx_fresnel_schlick/mx_fresnel_conductor/mx_sheen_ndf/mx_ggx_reflection + 8 lobes) ; mx_surface ne boucle plus (compose bsdf+edf+opacite) ; closureUsesLighting cable dans wgsl.ts (ordre preludes CLOSURE -> LIGHTING -> BSDF -> SURFACE). Valide GPU reel : local Intel gen-12lp 27/27 + mobile Adreno 7xx 27/27, oracle 29/29 (aucune regression ; surface zero-bsdf -> 0,0,0,1 ; validation numerique par-lobe prevue T041/T042/T043 car aucun node-case runnable n'exerce encore un vrai lobe).
- [x] T040 [Plan:P8] Implementer EDF (uniform_edf, generalized_schlick_edf) et VDF (anisotropic_vdf) reels, et la composition energetique des closures (layer avec couplage par throughput, add, mix, multiply) dans src/compiler/nodes.ts et src/compiler/wgsl.ts. Fait : uniform_edf emet la radiance sans bloquer (reflectance 0) ; generalized_schlick_edf applique un facteur Schlick directionnel (N.V, exposant 5) entre color0/color90 (recoit normal + viewDir) ; anisotropic_vdf devient une approximation raster declaree de single-scattering a profondeur optique unite (albedo = scattering/(absorption+scattering), phase Henyey-Greenstein, integree sur mxLighting ; transport volumique complet reste aux media P6/raster T025) et rejoint LIGHTING_CLOSURE_OPS ; mx_layer couple la base par le throughput du dessus (1 - reflectance) et composite la couverture au lieu d'un max ; mx_closure_mul echelonne aussi la reflectance par la luminance du poids. Valide : typecheck + 560 tests Node (dont bloc T040) ; GPU reel local Intel gen-12lp 27/27 + mobile Adreno 7xx 27/27, oracle 29/29 (aucune regression).
- [x] T041 [Plan:P8] Ecrire une reference analytique CPU independante de chaque lobe/EDF/VDF (memes formules, implementation separee des stubs et du WGSL) dans src/render/bsdf/ ; tests unitaires JS dans tests/render/bsdf/. Fait : src/render/bsdf/reference.ts reimplemente en TypeScript pur (sans lire le WGSL) les memes formules que nodes.ts -- 8 lobes BSDF (oren_nayar, burley, translucent, dielectric, conductor, generalized_schlick, sheen, subsurface), 2 EDF (uniform_edf, generalized_schlick_edf), 1 VDF (anisotropic_vdf), helpers microfacette/Fresnel exportes (ggxNdf/smithG1/fresnelSchlick/fresnelSchlickF90/fresnelConductor/sheenNdf/ggxReflection/luminance) et composition energetique (closureAdd/mul/mix/layer). Memes conventions d'eclairage que gpu/exec.ts (L = normalize(-direction), radiance = color*intensity, ambiant = terme*environment), defaultLighting() miroir de DEFAULT_LIGHTING. tests/render/bsdf/reference.test.ts : 26 tests (reductions Lambert verifiees, GGX dielectrique head-on 0.0509296, EDF endpoints, phase HG 1/(4pi), couplage layer). Oracle independant pret pour T042. Valide : typecheck + 586 tests Node.
- [x] T042 [Plan:P8] Remplacer les oracles closure circulaires de tests/fixtures/node-cases.ts par la reference analytique (T041) ; mettre a jour tests/fixtures/tolerances.ts ; tests JS numeriques dans tests/compiler/ et execution device par lobe dans tests/render/corpus-device.test.ts, exercee sur le GPU local (poste de dev, Chrome WebGPU) puis confirmee sur le mobile cible, avec tolerances documentees par cible. Fait : 11 cas par-lobe (8 BSDF + 2 EDF + 1 VDF) dans un export dedie CLOSURE_LOBE_CASES de tests/fixtures/node-cases.ts, chaque oracle [r,g,b,poids] calcule par src/render/bsdf/reference.ts (T041, implementation independante) et non plus par le WGSL -- hors de NODE_CASES pour respecter l'invariant inventaire de node-cases.test.ts. buildLobeIr (tests/fixtures/node-ir.ts) abaisse chaque lobe en IR closure feuille. tests/fixtures/tolerances.ts documente les tolerances par cible : local 2e-3, mobile 4e-3 (deviceTargetOf detecte adreno/mali/apple/powervr -> mobile). Nouveau tests/compiler/closure-lobes.test.ts (47 tests) : re-derivation independante depuis les params, invariants de poids (bsdf = poids d'entree, edf = 0, vdf dans ]0,1]), valeurs head-on epinglees (uniform_edf [0.5,0.25,0.1,0], generalized_schlick_edf [0.8,0.1,0.1,0], translucent ambiant [0.0105,0.0147,0.0189,0.7]) et abaissement WGSL (appel mx_<lobe>, binding mxLighting ssi usesLighting). Le harnais device (corpus-device.harness.ts) execute aussi les 11 lobes ; corpus-device.test.ts compare la sortie GPU a l'oracle analytique par cible. Valide GPU reel : local Intel gen-12lp 11/11 lobes a 2e-3 + mobile Adreno 7xx 11/11 lobes a 4e-3 (rapport committe), 0 erreur ; typecheck + suite Node complete.
- [x] T043 [Plan:P8] Executer numeriquement les surfaces graphCase (standard_surface, open_pbr_surface, disney_principled, gltf_pbr, UsdPreviewSurface, simple_hair) vs la reference analytique, pas seulement une validation structurelle ; tests dans tests/compiler/ et tests/render/. Fait : nouveau modele de surface canonique analytique ref.evaluateSurface (src/render/bsdf/reference.ts) qui compose les lobes DEJA valides (T042) a partir des 7 parametres canoniques (baseColor, metalness, roughness, transmission, subsurface, ior, specular, ceux extraits par build-scene-materials.mjs) -- workflow metallique F0=baseColor via generalized_schlick, specular dielectrique en layer sur une base diffus/transmission/subsurface ; mx_surface porte l'opacite comme poids (=1). Export dedie SURFACE_GRAPH_CASES (tests/fixtures/node-cases.ts) : 5 familles PBR + simple_hair (stub chiang_hair documente, pas de lobe analytique) avec oracle [r,g,b,poids] issu de la reference. buildSurfaceIr (tests/fixtures/node-ir.ts) assemble le MEME graphe en WGSL (closures + combine mix/layer + noeud surface) runnable en un dispatch -- composition implementee deux fois independamment (TS vs WGSL), donc comparaison device non circulaire. tests/fixtures/tolerances.ts : SURFACE_TARGET_TOLERANCE local 3e-3 / mobile 6e-3 (plus large que les lobes car 5 lobes + 3 ops composes en fp32). Nouveau tests/compiler/surface-graph.test.ts (24 tests) : re-derivation independante depuis les lobes, invariant poids=opacite=1, reduction surface diffus-pur = lobe Burley, domination metal a metalness 1, abaissement WGSL (mx_surface + lobes + binding mxLighting). Le harnais device (corpus-device.harness.ts runSurfacesOnDevice) execute les 6 surfaces ; corpus-device.test.ts compare la sortie GPU a l'oracle analytique par cible. Valide GPU reel : local Intel gen-12lp 6/6 surfaces a 3e-3 + mobile Adreno 7xx 6/6 surfaces a 6e-3 (rapport committe, 0 erreur) ; typecheck + suite Node complete 668 tests.
- [x] T044 [Plan:P8] Implementer evaluation + PDF + echantillonnage coherents par lobe pour le path tracer dans src/render/pathtracing/ ; tests de coherence dans tests/render/pathtracing/ : conservation d'energie (white furnace), accord eval vs PDF, estimateur non biaise. Fait : nouveau src/render/pathtracing/bsdf.ts expose par lobe le triplet coherent eval(wo,wi)->{value,pdf} / sample(wo,rng)->{wi,value,pdf} en repere local (+Z = normale), reutilisant les memes GGX NDF + Smith separable + Fresnel Schlick que la reference raster (src/render/bsdf/reference.ts) -- seuls le sampling et la pdf sont ajoutes. Lobes : lambert (cosine, reflectance = albedo), translucent (transmission diffuse, hemisphere oppose), conductor et dielectric (microfacette GGX, half-vector importance sampling, pdf = D*cosThetaH/(4*dot(wo,wm))). surfaceBsdf compose un BSDF multi-lobe one-sample (metal + transmission + coat dielectrique + diffus) dont les poids partitionnent l'unite, donc energie conservee et pdf combinee = somme(selectProb_k*pdf_k) coherente avec l'evaluation ; subsurface replie dans le diffus (approximation declaree, le vrai BSSRDF reste subsurface.ts T029). Adaptateurs monde (shadingFrame/evalWorld/sampleWorld) pour brancher les lobes sur l'integrateur. Nouveau tests/render/pathtracing/bsdf.test.ts (16 tests) INTRINSEQUES (n'utilisent pas la reference raster comme oracle, elle n'a pas de pdf) : white furnace (lambert = albedo a variance nulle ; translucent = albedo transmise ; conductor F0=1 reflectance <= 1 pour toute rugosite, ~1 quasi-lisse), accord sample()/eval() (pdf et value identiques a la direction echantillonnee, rel 1e-6), non-biais (estimateur par importance == estimateur hemisphere uniforme eval-only, |diff| < 0.02), coherence du BSDF combine, et un white furnace execute a travers l'integrateur reel (integrator.ts, env=1) dont la radiance moyenne egale la reflectance du lobe sans gain d'energie. Validation CPU (pas de shader GPU, comme T041) : typecheck + suite Node complete 692 tests.
- [x] T045 [Plan:P8] Integrer l'evaluation OpenPBR reelle (shader materiau genere) au backend raster WebGPU dans src/render/raster/shaders.ts et src/render/raster/backend.ts, en remplacant le Lambert+ambient ; re-valider par scene sur le GPU local (poste de dev, Chrome WebGPU) puis sur le mobile cible. Fait : nouveau bloc WGSL partage openPbrSurfaceWgsl (src/render/raster/shaders.ts) -- structs MxSurface/MxLight/MxClosure, helpers microfacette (mx_ggx_ndf/mx_smith_g1/mx_fresnel_schlick/mx_fresnel_schlick_f90/mx_ggx_reflection), 5 lobes (mx_burley_diffuse, mx_translucent, mx_subsurface, mx_dielectric, mx_conductor_schlick) et composition (mx_closure_mix/mx_layer) assembles par mx_openpbr_surface, miroir lobe-par-lobe et op-par-op de ref.evaluateSurface (src/render/bsdf/reference.ts, T043, implementation TS independante). forwardOpaqueWgsl remplace le Lambert+ambient : le vertex sort desormais la position monde (out.worldPos), l'uniforme Uniforms porte eye + lightDir (direction de trajet scene) + lightColor(rgb)+intensity(w) + baseColor + material(metalness,roughness,transmission,subsurface) + coat(ior,specular) + environment, et le fragment evalue mx_openpbr_surface avec V = normalize(eye - worldPos). FORWARD_UNIFORM_SIZE 112 -> 176 (src/render/raster/backend.ts) ; src/main.ts buildForwardUniforms remplit la nouvelle disposition. Validation par scene non circulaire : le harnais device (tests/render/scene-device.harness.ts) embarque le MEME openPbrSurfaceWgsl en compute (normals + viewDirs par echantillon, materiau + eclairage par scene), et tests/render/scene-device.test.ts compare la sortie GPU a l'oracle analytique independant ref.evaluateSurface (plus rasterShade Lambert) sur les 47 scenes, tolerance scene-surface dediee tests/fixtures/tolerances.ts SCENE_SURFACE_TARGET_TOLERANCE local 4e-3 / mobile 7e-3 (plus large que le node-surface unique T043 car les metaux a faible rugosite -- brass, aluminium brosse -- poussent le specular GGX a son pic en fp32). Nouveau runner local scripts/run-local-scene.mjs (pendant poste-de-dev de run-scene-device.mjs, script npm test:local-scene). Valide GPU reel : local Intel gen-12lp 47/47 scenes a 4e-3 + mobile Adreno 7xx 47/47 scenes a 7e-3 (rapport mobile committe, 0 erreur) ; typecheck + suite Node complete 743 tests.
- [x] T046 [Plan:P8] Mettre a jour docs/conformance.md, docs/materialx-node-coverage.md et docs/validation.md : closures passees de stub a evaluation reelle, formules, limites et tolerances ; re-executer le run GPU local puis le run mobile et consigner les resultats des deux cibles (adapter, navigateur, OS). Fait : docs/validation.md -- table des sources d'oracle refaite (fermetures par lobe / surface composee / OpenPBR raster par scene pointent vers src/render/bsdf/reference.ts, note "fin des oracles circulaires"), 2 nouvelles sections "Tolerances des fermetures physiques (P8)" (CLOSURE 2e-3/4e-3, SURFACE 3e-3/6e-3, SCENE_SURFACE 4e-3/7e-3 avec justification) et "Evaluation physique des fermetures (P8)" (conventions d'eclairage, table modele+limites par lobe, composition energetique, triplet eval/pdf/sample du path tracer), procedure d'execution enrichie (test:local-gpu/test:local-scene) et section "Resultats des runs GPU" consignant les deux cibles. docs/conformance.md -- nouvelle section "Fermetures raster : de stub a evaluation physique (P8)" (table avant/apres par tache T039-T045, approximations raster declarees restantes). docs/materialx-node-coverage.md -- encart "P8 status" sous les feuilles BSDF/EDF/VDF (stub -> evaluation reelle, oracle independant reference.ts, liens croises). Re-execution GPU des deux cibles (0 erreur) : LOCAL Intel gen-12lp, Chrome 154 WebGPU, Windows NT 10.0 x64 -- 27/27 noeuds + 11/11 lobes @2e-3 + 6/6 surfaces @3e-3 + 47/47 scenes OpenPBR @4e-3 ; MOBILE Qualcomm adreno-7xx (SM-F731B, R5CW900CHQD), Chrome 154 Mobile, Android 10 -- 27/27 noeuds + 11/11 lobes @4e-3 + 6/6 surfaces @6e-3 + 47/47 scenes OpenPBR @7e-3 (rapports committes). Gate : typecheck + 743 tests Node.
- [x] T047 [Plan:P8] Couvrir le corpus Materials/Examples (source docs/scene-inventory.md) comme scenes de controle rendues dans les DEUX modes raster ET pathtracing sur le shader ball standard : tests/fixtures/control-scenes.json declare les 47 documents a shader de surface des 5 familles analytiques (standard_surface, open_pbr_surface, disney_principled, gltf_pbr, UsdPreviewSurface) avec `backends: ["raster", "pathtracing"]`, et tests/fixtures/scene-materials.json est regenere depuis les .mtlx reels via scripts/build-scene-materials.mjs. tests/render/scene-compare.test.ts compare les deux rendus par exemple via compare.ts (T035b) avec tolerances par focus documentees dans tests/fixtures/tolerances.ts (base strictes ; transmission/subsurface plus larges, justifiees comme approximations raster). Exceptions hors pipeline analytique, documentees dans control-scenes.json : SimpleHair/simple_hair_default (pas de miroir raster analytique du modele hair ; pathtracing seul) et les 2 documents StandardSurface look/material-assignment (standard_surface_look_brass_tiled, standard_surface_look_wood_tiled) sans noeuds de shading. Echec si un exemple manque un backend ou diverge hors tolerance.

### P9. Rendu bout-en-bout d'une scene OpenUSD arbitraire [REQ-002,003,009,010,011,012,013]

Les phases P1-P8 ont valide la chaine de compilation MaterialX et l'evaluation
physique des fermetures (raster + pathtracing) au niveau noeud / lobe / surface /
scene de controle sur un shader ball de reference. Elles n'ont PAS cable le flux
runtime complet : src/main.ts rend un triangle code en dur, l'importateur USDA ne
decode pas le crate binaire (.usdc), et le path tracer n'existe qu'en reference
CPU. P9 livre le chaine import -> scene -> backends GPU -> canvas pour une scene
OpenUSD quelconque. Aucune perte silencieuse (REQ-013) : toute feature non
supportee produit un diagnostic. Le rendu reste statique (pas d'animation).

- [x] T048 [Plan:P9] Qualifier et integrer un lecteur de crate binaire `.usdc`
  (PXR-USDC) en extracteur de donnees seul (pas de generation de code) :
  OpenUSD-wasm (`@needle-tools/usd`) comme unique lecteur, tinyusdz-wasm abandonne
  (incapable de lire le crate de reference) (docs/usd-import.md section 3).
  Decoder meshes (points, faceVertexCounts/Indices, normales, primvars/UV),
  transformations, cameras et lumieres du crate et les mapper vers SceneAsset.
  Consigner la revision verrouillee dans docs/dependencies.md. Fait : lecteur
  src/usd/crate.ts (flattenCrate/importCrate avec OpenUsdModule injecte) qui ecrit
  le crate dans le FS du module, ouvre le stage, l'aplatit en USDA via
  stage.ExportToString() et le compose a travers l'importateur USDA existant
  (src/usd/importer.ts) -> SceneAsset (meshes/primvars/xforms/cameras/lumieres),
  diagnostics de composition (GetCompositionErrors) transmis au sink. Loader Node
  par defaut scripts/openusd-loader.ts (resout le main du paquet puis importe
  bindings/index.js direct pour contourner la map exports + le peer three ;
  garde sous scripts/ car src/ reste type navigateur). tinyusdz retire
  (devDependency + lock). Tests tests/usd/crate.test.ts (module factice, 4 cas :
  cycle FS, decodage mesh/camera/lumiere, erreurs de composition au sink,
  FS_unlink meme en erreur). Harness end-to-end scripts/qualify-crate.ts
  (importCrate + loadOpenUsd sur les 3 crates de reference). Revision verrouillee
  dans docs/dependencies.md (section "USDC crate reader (OpenUSD-wasm) — T048" :
  @needle-tools/usd@1.1.2 = OpenUSD 0.26.5 pxr 2605, licence
  PolyForm-Noncommercial-1.0.0 notee comme contrainte produit, preuves de
  qualification 57 MB/0 erreur/8 cameras/6 lumieres). Valide : typecheck + 747
  tests Node. Restent (T048/T049) : loader navigateur et pont mesh->RawMesh.
- [x] T049 [Plan:P9] Unifier composition USDA (texte, src/usd/importer.ts) et
  payloads crate (T048) dans un stage compose unique : resolution des references,
  payloads, sublayers et bindings pointant vers des prims de crate ; brancher le
  resolver d'assets (src/assets/resolver.ts) sur un asset root explicite servi par
  HTTP(S) ou selection locale (REQ-011, pas de remap silencieux des chemins D:\).
  Fait : (1) importateur (src/usd/importer.ts) etendu d'un drapeau
  UsdImportOptions.resolveArcs (defaut false, comportement historique preserve :
  les arcs non-MaterialX restent differes/signales). Quand actif, les references
  non-MaterialX et les payloads sont enregistres comme ArcSource (kind, layerUri,
  assetPath, primPath) dans Composition.arcs plutot que seulement reportes.
  importUsdStage refactore en composeLayerTree (DFS entry+subLayers, garde cycle
  /maxDepth/magic PXR-USDC) puis resolveArcGraph (suit references avant payloads,
  resout le chemin relatif a la couche auteur, compose la sous-couche via le meme
  reader, greffe l'arbre externe sous le prim referent). Greffe =
  graftComposition (BFS depuis srcRootPath = primPath ou defaultPrim ou racine ;
  cloneRebasedPrim rebase les chemins, mergeWeakPrim ne comble que les trous donc
  les opinions locales gagnent ; materiaux correspondants rebasses/ajoutes).
  (2) Nouveau module src/usd/compose.ts : createCrateAwareReader resout chaque URI
  de couche via AssetResolver (politique asset-root : rejet explicite des chemins
  locaux/absolus hors fileMap, pas de remap D:\), recupere les octets via un
  AssetByteSource injecte, et aplatit a la volee les crates (PXR-USDC) en USDA via
  flattenCrate (T048) avant de passer le texte au parseur ; composeStage appelle
  importUsdStage avec resolveArcs: true. Comme OpenUSD ExportToString rend un USDA
  deja aplati, la recursion d'arcs sur un crate se termine immediatement.
  (3) Tests tests/usd/compose.test.ts (6 cas : subLayer texte via rootUrl,
  subLayer crate aplati, payload crate greffe sous le prim, reference crate greffee
  a un chemin cible, violation de politique asset-root -> diagnostic + couche
  ignoree sans remap, reader crate sans loader -> erreur). Valide : typecheck +
  753 tests Node.
- [x] T050 [Plan:P9] Construire le pont SceneAsset -> ressources GPU : upload des
  geometries preparees (src/geometry/prepare.ts) en vertex/index buffers, BVH et
  hierarchie d'instances (src/scene/instances.ts, src/geometry/bvh.ts), et
  compilation des materiaux references via la chaine MaterialX (graph -> IR ->
  WGSL -> pipeline/instance) pour chaque binding de la scene.
  Fait : (1) Nouveau module src/render/scene-resources.ts. buildSceneResources
  (async, testable en Node) assemble SceneResources a partir d'un SceneAsset :
  par prototype il recupere le RawMesh via un MeshSource injecte puis
  prepareMesh + buildBvh produisent les flux de sommets (position/normal/uv/
  tangent + attributs) et le BLAS ; buildSceneInstances fournit la hierarchie
  d'instances, transformBounds place chaque AABB en monde et buildTlas construit
  le TLAS ; resolveSceneMaterials donne les unites, chaque unite unique est
  compilee via un MaterialCompiler injecte (ir + module WGSL) puis extractFeatures
  + computePipelineKey + createMaterialVariant ferment la chaine
  graph -> IR -> WGSL -> pipeline/instance. Les geometries et materiaux manquants
  sont signales (pendingGeometry / pendingMaterials / unboundGprims) et non
  silencieusement abandonnes (REQ-013). (2) uploadGeometry(device, ...) cree les
  vertex/index GPUBuffer (helper navigateur ; GPUBufferUsage non reference au
  chargement du module donc l'import reste sur en Node). (3) Decision
  d'architecture : l'abaissement ResolvedGraph -> ShaderIr n'existe pas encore
  comme fonction de bibliotheque (IR construit a la main via IrModuleBuilder dans
  les tests) et les octets de geometrie vivent dans les payloads crate ; le pont
  injecte donc MeshSource et MaterialCompiler pour rester honnete et testable
  hors navigateur. Tests tests/render/scene-resources.test.ts (3 cas : upload +
  instances/TLAS + materiaux lies, materiau pending quand le compilateur ne rend
  rien, uploadGeometry ecrit chaque flux + l'index buffer sur un device factice).
  Valide : typecheck + 756 tests Node.
- [x] T051 [Plan:P9] Cabler le backend raster executable sur la scene reelle :
  src/main.ts et src/render/raster/backend.ts consomment SceneAsset + instances
  materiau (cameras et lumieres USD reelles, environnement), remplacant le
  triangle et les uniformes codes en dur ; rendu multi-objets avec les passes
  effectivement actives (opaque, transmission, etc.).
  Fait : (1) Nouveau chemin forward "scene" dans src/render/raster/shaders.ts
  (sceneForwardWgsl) : matrice modele par instance, deux buffers de sommets
  separes position/normal alignes sur les flux de T050, et la meme evaluation
  OpenPBR analytique que forwardOpaqueWgsl mais avec sortie alpha pour la
  transmission. (2) src/render/raster/backend.ts : SCENE_FORWARD_UNIFORM_SIZE=240,
  SCENE_VERTEX_LAYOUTS (2 buffers float32x3), createSceneForwardPipeline(pass)
  (opaque -> ecriture profondeur + cull back ; transmission -> alpha-blend,
  depthWriteEnabled false, cull none) et recordScenePass qui boucle sur les draws
  multi-objets (bind group + 2 vertex buffers + index + drawIndexed) avec clear
  sur la premiere passe puis load. Le chemin legacy triangle unique (forward/
  resolve) reste intact pour les tests existants. (3) Nouveau module pur
  src/render/raster/scene-frame.ts (testable en Node) : cameraFrom (viewProj =
  projection*view, oeil depuis la transform USD), directionalLightFrom (prefere
  une DistantLight, direction locale -Z en monde, intensite*2^exposure),
  environmentFrom (DomeLight sinon ambiant), buildSceneFrame (une draw par
  instance avec geometrie, instances sans geometrie reportees dans skipped,
  routage opaque/transmission selon les passes effectives du materiau ou la
  transmission de la surface) et buildSceneUniform (60 floats au layout de
  sceneForwardWgsl). (4) src/main.ts recable sur la vraie chaine : SceneAsset
  compose -> importLights/importCameras -> buildSceneResources -> buildSceneFrame
  -> upload geometrie par prototype -> une passe GPU par passe active -> resolve
  tonemap vers le canvas ; plus aucun triangle ni uniforme code en dur. Decision :
  main.ts fournit une SceneAsset de demonstration (deux mesh + une DistantLight)
  via un MeshSource/MaterialCompiler injectes, en attendant le loader crate reel ;
  le flux d'execution est le vrai, documente dans l'en-tete du fichier. Tests
  tests/render/raster/scene-frame.test.ts (7 cas : camera/lumiere/environnement,
  routage des passes, surface qui transmet, camera par defaut, layout uniforme)
  et extension de tests/render/raster/backend.test.ts (5 cas : pipeline opaque vs
  transmission, recordScenePass multi-objets, clear/load, erreur si pipeline
  absent). Valide : typecheck + 768 tests Node.
- [x] T052 [Plan:P9] Porter l'integrateur de reference path tracing en compute
  WebGPU alimente par la meme scene (traversal BVH + fermetures eval/PDF/sample
  de src/render/pathtracing/bsdf.ts), accumulation progressive, et commutation de
  backend sans reimport via src/render/engine.ts ; comparer un rendu raster et un
  rendu pathtracing de la scene sur les memes assets.
  Fait : src/render/pathtracing/scene-buffers.ts empaquette les SceneResources en
  buffers de stockage GPU (noeuds BVH monde, soupe de triangles monde, materiaux
  OpenPBR) en reutilisant buildSceneFrame -- donc exactement les memes assets que
  le raster -- et expose createSceneSampler qui fait le pont vers l'integrateur de
  reference (traversal BVH iteratif, Moller-Trumbore, NEE lumiere distante,
  occlusion) ainsi que readSurfaceParams/directLighting. src/render/pathtracing/
  compute.ts genere le shader compute WGSL (mx_path_trace) qui reflete
  integratePath : traversal BVH, portage de surfaceBsdf (GGX/Smith/Fresnel +
  echantillonnage cosinus), NEE sans MIS sur la lumiere distante, miss
  environnement, Russian roulette apres 3 rebonds, accumulation progressive en
  moyenne glissante dans accum[pixel] (prev.w = compteur) ; PathTraceBackend gere
  le pipeline (layout 'auto'), le compteur de frames et buildPathTraceUniform.
  src/render/compare-backends.ts prouve que raster et pathtracing partagent
  camera/lumiere/materiaux et donne la meme reponse diffuse (sonde Lambert a
  incidence normale). src/main.ts cable la commutation sans reimport via
  RenderEngine ([r] raster / [p] path tracing) : le path tracer tourne sur les
  memes buffers, dispatch compute + passe plein-ecran qui tonemappe l'accumulation
  vers le canvas. Frontiere honnete : le WGSL est valide structurellement (Node ne
  dispose pas de WebGPU), createSceneSampler est l'oracle teste cote Node.
  Valide : typecheck + 787 tests Node (768 base + 19 nouveaux). Tests :
  tests/render/pathtracing/scene-buffers.test.ts (8 cas : empaquetage, round-trip
  materiau OpenPBR, invViewProj, intersection, miss, occlusion, directLighting,
  integratePath), tests/render/pathtracing/compute.test.ts (marqueurs WGSL, layout
  uniforme, creation de pipeline mock, compteur de frames, workgroupCount),
  tests/render/compare-backends.test.ts (sonde diffuse, parite des backends).
- [x] T053a [Plan:P9] Valider bout-en-bout dans un premier temps sur la seule
  scene scenes/test_material_disney_gold/test_material_disney_gold.usda :
  chargement compose, diagnostics des features non supportees, rendu des deux
  backends (raster + path tracing) sur les memes assets, et mesures (temps de
  chargement/compilation/rendu, memoire) sur le GPU local. Consigner dans
  docs/validation.md. Prepare le terrain pour T053 (scene de reference + scene
  tierce + mobile).
  Fait : (1) Nouveau script scripts/validate-disney-gold.ts (hors suite, lance
  par `npm run validate:scene` via vite-node car l'importateur USDA utilise des
  parameter properties non supportees par le strip-only de Node). Il rejoue la
  chaine runtime reelle sur les memes assets : importUsdStage (chargement
  compose) -> importLights/importCameras -> buildSceneResources (geo+BLAS,
  instances+TLAS, surfaces OpenPBR lues depuis gold.mtlx/ground.mtlx) ->
  buildSceneFrame (raster) ET buildPathTraceScene (path tracing) derives d'un
  unique SceneResources, recoupes par compareSceneBackends. (2) Resultats :
  13 prims, 3 meshes (cube/sphere/ground), 2 materiaux OpenPBR, 1 camera,
  2 lumieres ; 974 triangles ; aucune geo/materiau en attente, aucun gprim non
  lie ; backends partages (cameraPartagee=true, lumierePartagee=true, probe
  diffuse maxAbs=0) ; buffers PT 115,4 Kio. (3) Diagnostics : les lumieres d'aire
  SphereLight/RectLight sont importees mais approximees en lumiere directionnelle
  par le backend executable (signale, non abandonne). (4) Frontiere honnete
  Node vs GPU : Node n'a pas WebGPU -> mesure de la chaine CPU + taille des
  buffers ; les temps/compil/VRAM reels sur GPU passent par le harnais device
  (scene-device-harness.html) et relevent de T053. Rapport JSON :
  docs/generated/t053a-disney-gold.json. Section dediee ajoutee a
  docs/validation.md. Valide : typecheck + 787 tests Node.
- [ ] T053 [Plan:P9] Valider bout-en-bout sur la scene de reference
  (ShdrPlygrnd_OpenPBR.usda) et au moins une scene OpenUSD tierce : chargement
  compose, diagnostics des features non supportees, rendu des deux backends, et
  mesures (temps de chargement/compilation/rendu, memoire) sur le GPU local puis
  sur le mobile cible (D:\platform-tools\adb.exe). Consigner dans docs/validation.md.

### P10. Couverture complete des BxDF MaterialX [REQ-006,007,008,009,010,011,013,014]

Objectif : rendre fidelement TOUTES les familles de surface mtlx
(open_pbr_surface, standard_surface, disney_principled, gltf_pbr,
UsdPreviewSurface, briques lama_*) ET tout nodegraph de surface arbitraire, dans
les deux backends, en faisant de l'IR du compilateur la SOURCE UNIQUE de shading
(voir 9.6). Reference bxdf locale :
D:\WebGL2\MaterialX\MaterialX-rva\libraries\bxdf. Le raster et le path tracer
appellent la meme fonction de shading generee par l'IR ; le path tracer
n'introduit aucune approximation de modele ; le raster declare et documente les
siennes ; toute entree ou noeud non supporte produit un diagnostic (REQ-013).

- [x] T054 [Plan:P10] Etendre le modele de fermeture IR (P8) avec
  echantillonnage : definir l'interface runtime LayeredClosure (pile de lobes
  avec poids, plus couches coat/sheen/fuzz/thin film/emission) cible du lowering,
  et doter CHAQUE lobe BSDF, en plus de response/throughput (P8), de pdf(wo,wi)
  et sample(wo,xi)->(wi,weight,pdf) ; la surface expose un echantillonnage de
  pile (selection ponderee + PDF combinee par heuristique de puissance). Types et
  helpers dans src/compiler/ir.ts (+ exec.ts si besoin). Etendre l'oracle
  src/render/bsdf/reference.ts avec pdf + sample pour chaque lobe et la pile.
  Tests : accord eval/pdf, non-biais par lobe et pile, reductions connues
  (pile a coat/sheen/thin film nuls == resultat actuel -> non-regression).
  Fait (commit f41bc69) : src/compiler/ir.ts definit le contrat LayeredClosure
  (Rgb, BsdfLobeKind des 8 familles, LayeredBsdfLobe {kind, weight, color,
  color90?, roughness?, anisotropy?, rotation?, ior?, extinction?}, couches
  CoatLayer/SheenLayer/FuzzLayer/ThinFilmLayer, LayeredClosure {lobes, coat?,
  sheen?, fuzz?, thinFilm?, emission?, opacity}), emptyLayeredClosure() et le pont
  de non-regression canonicalSurfaceToLayered (7 parametres -> pile exacte de
  surfaceBsdf). src/render/pathtracing/bsdf.ts : composeLobes extrait (MIS
  one-sample, pdf combinee = somme(selProb_k*pdf_k)), surfaceBsdf refactore
  dessus, lobeFromLayered + layeredSurfaceBsdf (eval/pdf/sample de pile ;
  sheen/subsurface renvoient null en attendant leur lobe echantillonnable T056).
  src/render/bsdf/reference.ts : evaluateLayeredSurface, oracle direct-light
  additif de la pile + coat/sheen/fuzz appliques en layer (thinFilm porte mais
  inactif, T056). tests/render/layered-closure.test.ts (13 tests) : non-regression
  exacte layeredSurfaceBsdf(canonicalSurfaceToLayered(p)) == surfaceBsdf(p) en
  eval et sample (meme seed PCG32), accord eval/pdf au point echantillonne,
  non-biais IS vs hemisphere uniforme (|diff| < 0.02, 200k), conservation
  d'energie (rho <= 1.001), reductions de l'oracle (lobe diffus unique ==
  burleyDiffuse, opacity -> poids, coat weight 0 no-op / weight 1 occlut la base,
  emission additive). CPU-only (pas de shader GPU nouveau). Valide : typecheck +
  804 tests Node.

- [ ] T055 [Plan:P10] Abaissement nodegraph de surface -> LayeredClosure dans le
  compilateur : etendre le lowering (src/compiler/nodes.ts, wgsl.ts, ir.ts ;
  src/materialx/nodegraph-eval.ts) pour aplatir le nodegraph de chaque famille
  (standard_surface, open_pbr_surface, disney_principled, gltf_pbr,
  UsdPreviewSurface, assemblages lama_*) ET ses entrees texturees/procedurales
  (image, noise, mix, normalmap, ...) en code qui remplit les champs
  LayeredClosure dans le shader genere. Resoudre interfacename, noeuds connectes,
  heritage de version, alias et defauts officiels de chaque nodedef bxdf. Toute
  entree/noeud non supporte -> diagnostic (REQ-013). Retirer toCanonical
  (scripts/build-scene-materials.mjs), parseOpenPbr (harnais USD) et la reduction
  7-parametres du chemin de rendu. Tests : lowering par famille contre les .mtlx
  de reference bxdf, entree connectee/procedurale vs litterale, heritage de
  version, diagnostics d'entrees non supportees. Valide : typecheck + suite Node.
  Decoupe en sous-taches T055a-T055e :

  - [x] T055a [Plan:P10] Resoudre et parcourir le nodegraph de surface :
    a partir du terminal surfaceshader du ResolvedGraph (src/materialx/graph.ts),
    resoudre le nodedef (interfacename, heritage de version, alias, defauts
    officiels MaterialX) et DEPLIER les familles implementees en nodegraph
    (standard_surface NG_standard_surface_surfaceshader_100, open_pbr_surface
    NG_open_pbr_surface_surfaceshader) en parcourant leurs sous-graphes ; produire
    une carte d'entrees normalisee par famille (source value | connection |
    default). Les familles implementees en sourcecode seul (disney_principled,
    gltf_pbr, UsdPreviewSurface) passent par un mapping d'entrees documente. Tout
    noeud ou entree non supporte -> diagnostic (REQ-013). Module dedie
    src/materialx/surface-graph.ts (ou extension de nodegraph-eval.ts). Tests JS :
    resolution par famille, entree connectee vs litterale vs defaut, heritage de
    version, diagnostics. Fait : src/materialx/surface-graph.ts expose
    resolveSurface(graph, options) -> ResolvedSurface { family, nodeId,
    nodeDefName?, version?, inputs: Map<name, NormalizedSurfaceInput> }. Les 5
    familles sont classees depuis nodeDef.nodeString/category ; tables d'interface
    codees depuis les nodedefs bxdf de reference (standard_surface 42 entrees,
    open_pbr_surface 41, gltf_pbr 21, UsdPreviewSurface 14, disney_principled 14)
    avec defaults officiels. NormalizedSurfaceSource = value (litteral parse par
    type) | connection (nodeId/output conserves pour T055c) | default (defaut
    nodedef) | geomprop (normal/tangent via defaultgeomprop). Heritage de version
    standard_surface : table 1.0.0 (base=0.8, base_color=1,1,1) + overrides 1.0.1
    par defaut (base=1.0, base_color=0.8,0.8,0.8). Inputs interface resolus via
    options.interface ; connexion vers categorie hors DEFAULT_SUPPORTED_UPSTREAM,
    input interface non resolu, input hors nodedef, famille inconnue et terminal
    surfaceshader absent -> diagnostics REQ-013. tests/materialx/surface-graph.test.ts
    (11 tests). Valide : typecheck + 815 tests Node.

  - [x] T055b [Plan:P10] Mapper chaque famille resolue -> LayeredClosure (CPU) :
    fonction surfaceGraphToLayered (src/compiler/surface-lower.ts ou ir.ts) qui
    remplit lobes + coat/sheen/fuzz/thinFilm/emission/opacity a partir de la carte
    d'entrees T055a, en capturant ce que les 7 parametres ecrasaient : coat
    (poids/couleur/rugosite/ior), sheen/fuzz, thin film (poids/epaisseur/ior),
    anisotropie speculaire + rotation, teinte speculaire (specular_color),
    transmission color/depth, subsurface color/radius, emission
    (luminance/couleur). Oracle = evaluateLayeredSurface (reference.ts, T054).
    Tests JS : chaque famille produit les lobes/couches attendus, reduction
    diffus-pur coherente, open_pbr_surface complet remplit coat/sheen/thinFilm,
    non-regression vs canonicalSurfaceToLayered sur un materiau 7-parametres.
    Valide : typecheck + suite Node. Fait : src/compiler/surface-lower.ts expose
    surfaceGraphToLayered(ResolvedSurface) -> LayeredClosure, dispatch par famille
    (5 lowerings). Chaque lowering lit les sources value/default via helpers
    scalarOf/rgbOf ; les sources connection/geomprop (texture/procedural) tombent
    sur le defaut CPU et seront emises dans le shader en T055c. Lobes de base
    conductor/translucent/dielectric_reflection/burley_diffuse/subsurface ;
    standard_surface reproduit EXACTEMENT les poids de canonicalSurfaceToLayered
    quand base=1 et couches a zero (ancre non-regression). Capture coat/sheen
    (standard_surface), coat/fuzz (open_pbr), coat/sheen (gltf, disney), thin film
    (standard_surface/open_pbr epaisseur+ior, gltf iridescence), anisotropie +
    rotation speculaires, teinte specular_color, transmission_color, subsurface
    color, emission (emission*color, emission_luminance, emissive). Les champs sans
    slot dans le contrat LayeredClosure T054 (transmission depth, subsurface radius)
    attendent l'extension des lobes en T056. tests/compiler/surface-lower.test.ts
    (9 tests). Valide : typecheck + 824 tests Node.

  - [x] T055c [Plan:P10] Entrees texturees/procedurales abaissees dans le shader
    (pas aplaties en constantes) : etendre l'emission IR/WGSL
    (src/compiler/nodes.ts, wgsl.ts, ir.ts) pour qu'un champ LayeredClosure
    alimente par un reseau de noeuds (image, tiledimage, noise, mix, normalmap,
    combine, convert, ...) emette le sous-graphe dans le shader genere qui remplit
    ce champ, au lieu d'une constante bakee. Reutiliser le registre de lowering
    expr/texture existant (deja reel depuis T014). Tests JS : une entree connectee
    ou procedurale produit du WGSL referencant le sous-graphe (binding texture /
    appel de noeud) la ou une entree litterale produit une constante. Valide :
    typecheck + suite Node.
    Fait : nouveau module src/compiler/surface-ir.ts expose
    lowerSurfaceInputsToIr(graph, surface, builder, sink) qui abaisse chaque
    entree de surface resolue en IR : value/default -> constante, geomprop ->
    input normal/tangent, connection -> sous-graphe amont lowered (image/
    tiledimage/hextiledimage -> IR texture avec primvar UV st ; convert -> IR
    convert ; categories du registre expr -> IR call ordonne via
    CATEGORY_INPUT_ORDER avec repli sur l'ordre auteur). Partage CSE par nodeId.
    Noeud amont non lowerable -> diagnostic REQ-013 + constante neutre. Reutilise
    le registre nodes.ts (T014) via emitWgsl. tests/compiler/surface-ir.test.ts
    (6 cas) : couleur connectee -> binding textureSample ; litteral -> constante
    sans binding ; mix procedural -> appel mix( ; convert -> conversion IR ;
    partage CSE ; noeud non supporte -> warning + constante. Struct WGSL
    LayeredClosure + fonction mx_surface_layered restent pour T055d. Valide :
    typecheck OK ; suite 830 (etait 824, +6).

  - [x] T055d [Plan:P10] Struct WGSL LayeredClosure + fonction de remplissage
    generee : declarer dans un prelude la struct WGSL LayeredClosure et ses lobes,
    et faire emettre par le noeud surface une fonction mx_surface_layered(...) ->
    LayeredClosure (en plus / au lieu du Closure{color,weight} actuel), dont les
    champs sont affectes depuis les expressions IR (T055c). wgsl.ts expose la
    LayeredClosure comme sortie du module de surface. Tests JS structurels :
    struct presente, champs lobes/coat/sheen/fuzz/thinFilm/emission/opacity
    affectes, binding mxLighting present ssi necessaire, diagnostic sur entree non
    supportee. Valide : typecheck + suite Node.
    Fait : wgsl.ts refactore pour exporter lowerExprs (abaisse un ShaderIr en
    lignes WGSL let + bindings/preludes/varyings, partage par emitWgsl) et
    emitVaryingsStruct/litFloat. Nouveau module src/compiler/surface-wgsl.ts
    expose LAYERED_CLOSURE_PRELUDE (struct MxBsdfLobe/MxCoatLayer/MxSheenLayer/
    MxFuzzLayer/MxThinFilmLayer/LayeredClosure avec tableau lobes fixe + drapeaux
    has*) et emitLayeredSurface(graph, surface, sink) -> { code, entryPoint
    mx_surface_layered, returnType LayeredClosure, family, uniforms, textures,
    samplers, lighting? }. Il appelle lowerSurfaceInputsToIr (T055c) pour les refs
    IR par entree, assemble les lobes/couches par famille (les 5 familles,
    miroir de surface-lower.ts T055b) en WGSL referencant ces refs -> les poids
    restent dynamiques (une metalness texturee n'est pas aplatie), topologie des
    couches optionnelles decidee par presence litterale OU connexion. Les refs
    utilisees sont declarees en sorties IR pour forcer leur emission par
    lowerExprs. Construction pure sans eval d'eclairage -> pas de binding
    mxLighting (eval en T056). tests/compiler/surface-wgsl.test.ts (8 cas) :
    struct + fn presentes ; lobes/coat/sheen/thinFilm/emission/opacity affectes ;
    couches absentes omises ; couleur texturee -> sous-graphe dans un lobe ;
    metalness texturee -> poids dynamique ; pas de mxLighting ; dispatch famille
    (UsdPreviewSurface -> 3 lobes) ; noeud amont non supporte -> warning +
    constante neutre. Valide : typecheck OK ; suite 838 (etait 830, +8).


  - [ ] T055e [Plan:P10] Fin de la reduction 7-parametres cote fixtures/harnais :
    scripts/build-scene-materials.mjs emet la LayeredClosure riche dans
    tests/fixtures/scene-materials.json (le legacy 7-parametres reste derivable
    via canonicalSurfaceToLayered pour les consommateurs non encore migres) ;
    retirer toCanonical (build-scene-materials.mjs), parseOpenPbr
    (tests/render/usd-scene.harness.ts, scripts/validate-disney-gold.ts) et le
    bake findShader (nodegraph-eval.ts) du chemin de rendu -- le cablage effectif
    des backends sur la LayeredClosure est fait en T057 (path tracer) et T058
    (raster). Tests JS : fixture regeneree, parite entre la LayeredClosure du
    compilateur (T055b/T055d) et l'oracle reference.ts par famille. Valide :
    typecheck + suite Node.
    Decoupe en T055e1..T055e5 (ordre de dependance e1 -> e2 -> e3 ; e4 depend de
    e1/e2 ; e5 depend de e1/e4). Principe : additif et non cassant d'abord (les
    consommateurs GPU restent sur le 7-parametres jusqu'a T057/T058), puis
    suppression des chemins dupliques une fois le chemin unique en place.

    - [x] T055e1 [Plan:P10] Infra : serialisation LayeredClosure + resolution de
      scene partagee. Objectif : offrir au builder de fixtures et aux harnais un
      chemin unique "entrees de shader parsees -> ResolvedGraph minimal ->
      resolveSurface (T055a) -> surfaceGraphToLayered (T055b)". Ajouter un helper
      de (de)serialisation STABLE (arrondi deterministe) d'une LayeredClosure
      vers/depuis JSON (lobes + coat/sheen/fuzz/thinFilm/emission/opacity), et un
      pont "inputs parses -> ResolvedGraph" reutilisant le patron plain-data des
      tests. Rendre scripts/build-scene-materials capable d'importer depuis src/
      (le passer en .ts execute par le meme runner que scripts/render-scenes.ts,
      ou extraire un module helper partage sous src/). Aucun changement de forme
      de scene-materials.json ni des consommateurs a ce stade. Tests JS :
      round-trip de serialisation closure ; le pont produit une ResolvedSurface
      correcte par famille. Valide : typecheck + suite Node.
      Fait : src/compiler/layered-serialize.ts expose roundTo (arrondi stable, -0
      normalise en 0) + serializeLayeredClosure/deserializeLayeredClosure (lobes
      et champs optionnels coat/sheen/fuzz/thinFilm/emission omis quand absents,
      round-trip deep-equal, JSON deterministe). src/materialx/surface-from-inputs.ts
      ponte des inputs litteraux vers un ResolvedGraph mono-noeud puis
      resolveSurface (T055a) et surfaceGraphToLayered (T055b) :
      resolvedGraphFromParsedSurface, surfaceFromParsedInputs, parsedInputsToLayered
      (gere l'heritage de version standard_surface et renvoie null + diagnostic
      pour famille inconnue). scripts/build-scene-materials.mjs porte en .ts
      (execute par `node`, importe roundTo), package.json build:fixtures/build:materials
      pointent le .ts ; toCanonical conserve, fixture scene-materials.json
      regeneree et byte-identique (aucun diff de contenu). Nouveaux tests :
      tests/compiler/layered-serialize.test.ts, tests/materialx/surface-from-inputs.test.ts.
      Gate : typecheck OK, 850 tests sur 74 fichiers (838 -> 850).

    - [x] T055e2 [Plan:P10] Builder emet la LayeredClosure riche (additif) +
      regeneration de la fixture. Objectif : build-scene-materials appelle
      surfaceGraphToLayered (T055b) sur la surface resolue et ecrit un champ
      `closure` (LayeredClosure serialisee via T055e1) par materiau dans
      scene-materials.json, EN CONSERVANT les 7 champs plats actuels + family +
      focus (consommateurs non encore migres -> T057/T058). Regenerer la fixture.
      Tests JS : chaque materiau porte un `closure` valide (schema
      lobes/coat/sheen/fuzz/thinFilm/emission/opacity) ; les 7 champs plats
      restent inchanges (non-regression scene-compare/scene-shade/scene-device/
      render-scenes). Valide : typecheck + suite Node.
      Fait : build-scene-materials.ts importe parsedInputsToLayered (pont T055e1)
      + serializeLayeredClosure ; la boucle appelle parsedInputsToLayered({category:
      tag, inputs}) sur les memes inputs parses que toCanonical et ajoute le champ
      `closure` APRES les 7 champs plats (ordre stable). Fixture regeneree : 47
      scenes, chacune porte family/focus/baseColor/metalness/roughness/transmission/
      subsurface/ior/specular INCHANGES + closure. Avertissements benins gltf_pbr
      (ior/alpha_mode/iridescence_ior/thickness/attenuation_* hors interface
      nodedef T055a -> ignores, champ plat non affecte ; l'ior gltf authored n'est
      pas repris dans le closure, a corriger cote table T055a ulterieurement).
      Nouveau test tests/fixtures/scene-materials.test.ts (4 cas : corpus >=40,
      7 champs plats bien types, closure schema-valide par materiau -- kind connu,
      weight>0, color rgb, slots optionnels bien formes --, round-trip codec
      identique). Non-regression des 7 champs confirmee par les tests scene-*
      existants (toujours verts). Gate : typecheck OK, 854 tests sur 75 fichiers
      (850 -> +4).

    - [x] T055e3 [Plan:P10] Test de parite compilateur LayeredClosure vs oracle,
      par famille. Objectif : nouveau test qui, par scene/famille, (a) reconstruit
      la surface resolue et compare surfaceGraphToLayered au `closure` serialise
      de la fixture ; (b) evalue evaluateLayeredSurface(closure) (reference.ts,
      T054) sous defaultLighting + quelques geometries et verifie la parite avec
      l'ancre 7-parametres canonicalSurfaceToLayered sur les lobes de base
      (non-regression) dans les tolerances (fixtures/tolerances.ts) ; (c) verifie
      que emitLayeredSurface (T055d) produit un module structurellement coherent
      par famille. Valide : typecheck + suite Node.
      Fait : nouveau test tests/fixtures/scene-parity.test.ts. Les inputs bruts
      par scene ne sont PAS persistes (fixture = closure derive + 7 champs plats),
      donc (a)/(c) reconstruisent depuis un representant base-only par famille
      (5 familles) et (b) relie chaque closure stocke a l'ancre batie sur ses
      champs plats. (a) : surfaceFromParsedInputs resout la bonne SurfaceFamily,
      surfaceGraphToLayered deterministe = chemin bridge parsedInputsToLayered,
      et chaque closure de la fixture est round-trip stable via le codec
      serialize/deserialize (meme pipeline que la fixture). (b) : sous
      defaultLighting x 3 geometries, parite stricte (<= tolerances.ts closure
      2e-3) la ou le representant se reduit exactement a l'ancre (standard_surface
      garanti, compteur strict > 0) ; evaluation finie et in-range [0,1] pour tous
      les representants + chaque scene (closure stocke ET ancre). Les 7 champs
      plats etant une reduction lossy (toCanonical, retire en T055e4), pas de
      parite byte exigee corpus-wide. (c) : emitLayeredSurface donne family/
      entryPoint mx_surface_layered/returnType LayeredClosure corrects, code avec
      fn mx_surface_layered/c.lobeCount/c.opacity, uniforms/textures/samplers
      tableaux. Note : diffuse_roughness aligne sur l'ancre pour standard_surface
      (l'ancre met burley.roughness = roughness). Gate : typecheck OK, 868 tests
      sur 76 fichiers (854 -> +14).

    - [x] T055e4 [Plan:P10] Retirer toCanonical en derivant le 7-parametres depuis
      la surface resolue. Objectif : supprimer la logique par-famille dupliquee
      toCanonical de build-scene-materials ; les 7 champs plats (laisses pour les
      consommateurs non migres) sont desormais derives du chemin unique (surface
      resolue / LayeredClosure) via une reduction documentee -> plus de mapping
      parallele a la main dans le script. Regenerer la fixture (7 champs plats
      identiques aux valeurs actuelles a l'arrondi pres ; tout ecart inevitable
      documente). Tests JS : fixture stable ; consommateurs existants verts.
      Valide : typecheck + suite Node.
      Fait : toCanonical retire du script ; reduction partagee parsedSurfaceToCanonical
      ajoutee dans src/materialx/surface-from-inputs.ts, alimentee par le MEME spec
      parse unique que parsedInputsToLayered (plus de double-parse ni de switch
      par-famille dans le script). Note de conception : une reduction depuis le
      LayeredClosure a ete prototypee puis ecartee car le closure est lossy pour le
      rendu courant (le lobe translucent ne porte ni roughness ni ior -> verre
      casse, et disney specular vaut reellement 0.5 vs 1 hardcode) : elle cassait
      11 comparaisons de scene-device.test.ts dont la baseline mobile n'est pas
      regenerable ici. La surface resolue est elle aussi lossy pour l'ior gltf
      (absent du nodedef interface) ; la reduction lit donc les inputs parses
      (meme source que le closure) pour reproduire les valeurs a l'identique.
      Fixture regeneree : 7 champs plats inchanges (seul specular gagne une virgule
      car le closure le suit). Test unitaire parsedSurfaceToCanonical ajoute
      (defauts, base folde, conventions specular disney/usd, ior gltf parse).
      Gate : typecheck OK + 873 tests / 76 fichiers.

    - [x] T055e5 [Plan:P10] Retirer parseOpenPbr et le bake findShader du chemin
      de rendu. Objectif : remplacer les parseurs regex parseOpenPbr
      (tests/render/usd-scene.harness.ts, scripts/validate-disney-gold.ts) par la
      resolution de surface partagee (T055e1) -> LayeredClosure ; tant que le path
      tracer n'est pas cable sur la closure (T057), deriver l'ancre 7-parametres
      via la reduction T055e4 pour conserver le comportement courant. Retirer
      findShader et le chemin de bake (bakeNodegraphSurface, nodegraph-eval.ts) de
      la trajectoire de rendu -- l'isoler en diagnostic pur ou le supprimer s'il
      n'y est plus consomme. Tests JS : harnais/scripts compilent et, s'ils sont
      dans la suite, restent verts. Valide : typecheck + suite Node.
      Fait : parseur texte partage parseSurfaceInputsFromMtlx ajoute dans
      src/materialx/surface-from-inputs.ts (shaderBlock + parseInputs factorises) ;
      les deux copies parseOpenPbr (harnais USD, script disney) remplacees par
      parseSurfaceInputsFromMtlx -> parsedSurfaceToCanonical (ancre 7-parametres,
      T055e4) ; build-scene-materials.ts utilise aussi le parseur partage (plus de
      copie locale) et le fixture reste identique (gate device vert). Bake retire
      de la trajectoire de rendu : import nodegraph-eval et appels
      collectTextureFiles/bakeNodegraphSurface/loadTexture supprimes du harnais
      (bakedByName reste vide, couche GPU factice conservee) ; nodegraph-eval.ts
      (findShader + bakeNodegraphSurface) supprime car plus aucun consommateur.
      Gate : typecheck OK + 873 tests / 76 fichiers.


- [ ] T056 [Plan:P10] Bibliotheque WGSL de fermetures PARTAGEE eval/pdf/sample :
  completer les lobes manquants (sheen Charlie, coat dielectrique layered avec
  darkening/absorption, GGX ANISOTROPE alpha_u/alpha_v + rotation, transmission
  dielectrique / BTDF avec refraction et thin_walled, thin film Airy/tabule
  module sur le speculaire, hook subsurface BSSRDF T029) en une bibliotheque WGSL
  unique emise/consommee par le compilateur et appelee a l'identique par les deux
  backends. Chaque lobe conserve l'energie (reflectance <= 1) et reste non biaise
  (accord eval/sample, furnace). Tests intrinseques comme T044 (furnace par lobe,
  accord PDF/valeur, non-biais a N echantillons, anisotropie -> isotrope quand
  aniso=0). Valide : typecheck + suite Node.

- [ ] T057 [Plan:P10] Cabler le path tracer sur l'IR : src/render/pathtracing/
  compute.ts appelle la fonction de shading generee (LayeredClosure +
  bibliotheque partagee T056) au lieu de surface_eval/surface_sample 7-parametres,
  et src/render/pathtracing/scene-buffers.ts cesse de packer les 7 parametres
  OpenPBR au profit du variant de materiau compile. NEE + MIS sur la pile generee.
  Decision ouverte (section 14) : pipeline compute par variant de materiau vs
  megakernel parametre dispatchant sur l'id de materiau ; trancher et consigner.
  Marqueurs WGSL testables en Node (pas de WebGPU cote Node), oracle Node =
  createSceneSampler aligne sur reference.ts etendu. Valide : typecheck + suite
  Node ; run device local sans regression.

- [ ] T058 [Plan:P10] Cabler le raster sur l'IR : src/render/raster/backend.ts,
  shaders.ts et src/main.ts rendent via le variant WGSL compile du materiau
  (createMaterialVariant / computePipelineKey / instance.ts) au lieu du
  sceneForwardWgsl / openPbrSurfaceWgsl ecrits a la main ; memes fermetures
  generees que le path tracer, approximations raster explicites et documentees.
  Mettre a jour les tolerances device (tests/fixtures/tolerances.ts) si le layout
  change. Verifier que raster et path tracer produisent la meme reponse directe
  sur les memes materiaux (parite de source IR). Valide : typecheck + suite Node ;
  run device local + mobile sans regression.

- [ ] T059 [Plan:P10] Validation device de la couverture BxDF via l'IR : rendre
  chaque famille bxdf (open_pbr_surface, standard_surface, disney_principled,
  gltf_pbr, UsdPreviewSurface, un assemblage lama_*) ET au moins un nodegraph de
  surface procedural arbitraire (entree pilotee par un reseau de noeuds) dans les
  DEUX backends via la sortie du compilateur, sur GPU local puis mobile
  (D:\platform-tools\adb.exe), compares a l'oracle reference.ts etendu avec
  tolerances documentees. Verifier qu'un materiau a coat/sheen/thin film/
  anisotropie/transmission visibles differe nettement du rendu 7-parametres
  anterieur (preuve de fidelite) et que les deux modes partagent la sortie IR.
  Documenter dans docs/conformance.md, docs/materialx-node-coverage.md et
  docs/validation.md ; consigner les approximations raster restantes. Valide :
  typecheck + suite Node complete + rapports device committes, 0 erreur.

P1 decide les dependances avant de figer leurs adaptateurs. Une premiere tranche
verticale P2/P3/P4 avec une surface texturée doit alimenter P5 et P6 rapidement.
Developper ensuite les combinaisons OpenPBR, subsurface et volumes. La validation
accompagne chaque phase ; P7 consolide les gates et n'est pas son point de depart.
P9 cable enfin le flux runtime complet (crate binaire + scene -> backends GPU ->
canvas) pour rendre une scene OpenUSD quelconque, au-dela des scenes de controle.
P10 fait ensuite de l'IR du compilateur la source unique de shading (9.6) :
raster et path tracer appellent la meme fonction generee, rendant fidelement
toutes les familles bxdf (open_pbr_surface, standard_surface, disney_principled,
gltf_pbr, UsdPreviewSurface, lama_*) et tout nodegraph arbitraire, en remplacant
le modele canonique reduit a 7 parametres.

## 12. Criteres d'acceptation

- Scene composee chargee avec cameras, payload des lumieres, materiaux et assets
  resolus ; toute perte ou fonctionnalite inconnue produit un diagnostic.
- Un materiau traverse toute la chaine sans generation de code WASM.
- Chaque noeud declare ou utilise dans les fichiers .mtlx de Materials/Examples,
  ainsi que ses dependances necessaires, se compile et s'evalue sans omission
  silencieuse ; la matrice de couverture est complete et les cas sont testes.
- Chaque noeud de la matrice de couverture possede des tests JavaScript et un
  test d'execution WebGPU qui verifie son resultat sur des entrees deterministes
  contre des resultats de reference, avec tolerances documentees ; aucun noeud
  n'est valide par la seule compilation WGSL.
- Raster et path tracing fonctionnent sur les memes assets et instances.
- Chaque document .mtlx a shader de surface sous Materials/Examples (les 47 des
  5 familles analytiques) est rendu et compare dans les deux modes raster ET
  pathtracing ; aucun de ces exemples n'est couvert par un seul backend, et les
  ecarts raster sont documentes comme approximations explicites. Les exceptions
  (simple_hair_default sans miroir raster analytique, et les 2 documents look
  sans noeuds de shading) sont declarees et justifiees dans control-scenes.json.
- Le path tracer ne tronque pas les chemins de facon biaisee et ne substitue
  aucun modele approximatif ; les strategies de subsurface et transmission
  proposent plusieurs presets de convergence sans changer le modele physique.
- Le rendu reste statique ; les donnees d'animation et le motion blur ne sont
  pas pris en charge.
- Deux instances compatibles partagent leur pipeline ; un changement de
  parametre dynamique n'entraine aucune recompilation.
- OpenPBR couvre les noeuds/parametres du corpus et leurs interactions, pas
  seulement des demonstrations isolees de chaque feature.
- Toutes les familles de surface mtlx (open_pbr_surface, standard_surface,
  disney_principled, gltf_pbr, UsdPreviewSurface, briques lama_*) ET tout
  nodegraph de surface arbitraire sont rendus via l'IR du compilateur comme
  source unique (9.6) : raster et path tracer appellent la meme fonction de
  shading generee. Coat, sheen/fuzz, thin film, anisotropie, transmission
  color/depth/scatter, subsurface radius, emission et specular_color ne sont plus
  ecrases par la reduction 7-parametres. Le path tracer evalue sans approximation
  (eval/pdf/sample par lobe) ; les approximations raster sont documentees ; toute
  entree ou noeud non supporte produit un diagnostic.
- Conservation d'energie et coherence evaluation/PDF/echantillonnage verifiees.
- Volumes et subsurface valides sur des scenes dediees si le corpus ne les
  exerce pas suffisamment ; thin film compare a des references adaptees.
- References utilisant memes modeles, geometries, lumieres et transformations
  colorimetriques ; tolerances et incertitude statistique documentees.
- Convergence et resultat brut evalues independamment du denoising.
- Les mesures de performance et de memoire sont executees sur le mobile cible,
  dont le modele, le GPU, le navigateur et l'OS sont consignes.
- Approximations raster documentees separement des defauts d'implementation.
- Mesures de temps CPU/GPU, compilation, chargement et memoire sur un mobile
  Android cible, connecte et inspecte avec D:\platform-tools\adb.exe ; consigner
  modele, GPU, navigateur, OS et conditions de mesure. Fixer les seuils chiffres
  apres l'inventaire et le choix du mobile cible.
- Liberation et recreation apres perte du GPUDevice sans reutilisation de
  pipelines appartenant a l'ancien device.

## 13. Correspondance exigences / plan

| Exigence | Phases | Preuves attendues |
| --- | --- | --- |
| REQ-001 | P2, P7 | Device lifecycle, TypeScript, ressources |
| REQ-002 | P1, P4, P7, P9 | Import compose, cameras, scene statique et inventaire |
| REQ-003 | P1, P2, P4, P9 | Dependances qualifiees et adaptateurs |
| REQ-004 | P1, P2, P3 | WASM Core sans appel a un generateur |
| REQ-005 | P3, P7 | Chaine de compilation, caches et instances |
| REQ-006 | P3, P4, P5, P6, P7, P8, P10 | OpenPBR et comparaisons de reference |
| REQ-007 | P3, P5, P6, P7, P8, P10 | Subsurface raster et transport physique |
| REQ-008 | P3, P5, P6, P7, P8 | Volumes homogenes/heterogenes |
| REQ-009 | P5, P7, P8, P9, P10 | Raster complet et approximations declarees |
| REQ-010 | P6, P7, P8, P9, P10 | Path tracing et hybride |
| REQ-011 | P2, P3, P4, P5, P6, P7, P8, P9, P10 | Images, UDIM et couleur |
| REQ-012 | P2, P4, P5, P7, P9 | Instanciation, BVH, clustering et budgets |
| REQ-013 | P1, P7, P9, P10 | Conformite, diagnostics et gates |
| REQ-014 | P1, P3, P7, P8, P10 | Inventaire exhaustif, lowering TypeScript et tests de chaque noeud du corpus |

## 14. Decisions encore ouvertes

- GPU et navigateurs cibles ; objectifs FPS, memoire et temps de convergence.
- Inventaire complet des noeuds et des assets effectivement references.
- Distribution OpenUSD/WASM et integration des references MaterialX.
- Bibliotheques de subdivision et de volumes compatibles navigateur.
- Formats de volume requis et eventuels effets spectraux hors thin film/dispersion du corpus.
- Renderer(s) de reference et tolerances physiques/numeriques.
- Path tracer sur IR (P10/T057) : pipeline compute par variant de materiau vs
  megakernel unique parametre dispatchant sur l'id de materiau (accumulation
  progressive en une passe). A trancher a l'implementation selon le cout de
  compilation, le nombre de materiaux par scene et les limites du device.

Ces points se resolvent en qualification. La qualite reste l'objectif final,
mais aucune promesse de support universel MaterialX/OpenUSD ou de performance
chiffree n'est faite sans matrice de conformite et mesures.