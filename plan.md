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
- [x] T014 [Plan:P3] Implementer un lowering WGSL TypeScript et une emission pour chaque noeud de docs/materialx-node-coverage.md dans src/compiler/nodes.ts et src/compiler/wgsl.ts.
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
  - [x] T034a [Plan:P7] Definir pour chaque noeud du corpus (matrice T033) un cas deterministe entrees fixes + sorties CPU de reference dans tests/fixtures/node-cases.ts, reutilisable par les tests JS et GPU.
  - [x] T034b [Plan:P7] Tester en JS resolution + construction IR de chaque noeud du corpus dans tests/compiler/corpus-resolve.test.ts : graphe resolu (materialx/graph.ts) et IR type correct (compiler/ir.ts), sans GPU.
  - [x] T034c [Plan:P7] Tester en JS le lowering WGSL de chaque noeud dans tests/compiler/corpus-wgsl.test.ts : module emis (compiler/wgsl.ts) avec uniforms/bindings/outputs attendus et validation structurelle du WGSL, pas seulement l'absence d'erreur.
  - [x] T034d [Plan:P7] Ecrire un harnais d'execution compute reutilisable dans src/gpu/exec.ts : a partir d'un module WGSL de noeud, construire le pipeline (gpu/pipelines.ts), binder les entrees deterministes, dispatcher et relire les sorties en buffer.
  - [x] T034e [Plan:P7] Servir le harnais au mobile connecte (SM-F731B) via D:\platform-tools\adb.exe (adb reverse + Chrome Android), executer tous les noeuds du corpus sur le GPU reel et collecter les sorties dans tests/render/corpus-device.harness.ts.
  - [x] T034f [Plan:P7] Comparer sorties GPU du mobile vs oracle CPU (T034a) avec tolerances par type dans tests/render/corpus-device.test.ts ; echec si un noeud s'ecarte, skip propre documente si aucun mobile autorise.
  - [x] T034g [Plan:P7] Orchestrer le flux build harnais -> adb reverse -> run device -> collecte -> assertions via un script npm (scripts/run-device-corpus.mjs) avec rapport par noeud.
- [ ] T035 [Plan:P7] Comparer les rendus et documenter les tolerances dans docs/validation.md.
  - [x] T035a [Plan:P7] Centraliser les tolerances par type/par noeud (deduites de T034f : expr, closure, texture rgba8unorm, cas non reproductibles comme fractal3d) dans une source declarative unique tests/fixtures/tolerances.ts, et refactorer tests/render/corpus-device.test.ts pour la consommer.
  - [x] T035b [Plan:P7] Ecrire un utilitaire de comparaison d'images/signaux reutilisable dans tests/render/compare.ts : diff absolu max, RMSE, erreur relative par canal, verdict pass/echec selon une tolerance fournie, avec tests unitaires JS dans tests/render/compare.test.ts.
  - [ ] T035c [Plan:P7] Rendre toutes les scenes de controle (T033) declarant backends raster ET pathtracing sur le shader ball standard (neutral_objects.glb, charge via three.js GLTFLoader, textures texel constant rgba8unorm comme T034), et comparer les deux rendus via T035b avec tolerances de scene documentees dans tests/render/scene-compare.test.ts.
    - [x] T035c1 [Plan:P7] Charger le shader ball standard (tests/fixtures/standard-shader-ball/neutral_objects.glb) via three.js GLTFLoader dans un prebuild (scripts/build-shaderball-fixture.mjs) emettant un fixture deterministe (tests/fixtures/shader-ball.json), adapte en RawMesh pour prepare.ts dans src/geometry/shaderball.ts, avec tests CPU dans tests/geometry/shaderball.test.ts : comptes sommets/indices, normales normalisees, uv dans [0,1], tangentes generees finies, bornes d'indices.
    - [x] T035c2 [Plan:P7] Calculer la visibilite deterministe du shader ball depuis la camera des scenes de controle (rayons primaires pinhole, mesh recadre pour tenir dans le champ, traversee BVH geometry/bvh.ts + Moller-Trumbore) en un jeu d'echantillons de shading (masque hit + position/normale/uv/viewDir par pixel) dans tests/render/scene-samples.ts, la traversee BVH etant validee contre un balayage exhaustif des triangles (reference).
    - [x] T035c3 [Plan:P7] Rendre chaque scene raster+pathtracing sur ces echantillons en deux buffers HDR lineaires : (a) modele analytique raster (miroir CPU de raster/shaders.ts) et (b) integrateur de reference path tracing (pathtracing/integrator.ts via SceneSampler analytique, lumiere directionnelle + environnement constant, seed 1337), parametres materiau partages extraits du .mtlx.
    - [ ] T035c4 [Plan:P7] Comparer les deux buffers par scene via compare.ts (T035b) avec tolerances par focus documentees (base strictes ; transmission/subsurface plus larges et justifiees) dans tests/render/scene-compare.test.ts ; echec si divergence hors tolerance, couverture de toutes les scenes raster+pathtracing.
  - [ ] T035d [Plan:P7] Comparer le rendu raster du mobile (device GPU) vs l'oracle CPU au niveau scene (pas seulement par noeud) via le harnais device et T035b, avec skip propre si aucun mobile autorise.
  - [ ] T035e [Plan:P7] Rediger docs/validation.md : methodologie, sources d'oracle, table des tolerances par type de noeud et par scene, cas non reproductibles (fractal3d et son enveloppe), et procedure d'execution (npm run test:device).
- [ ] T036 [Plan:P7] Integrer budgets, streaming et profiling sur le mobile Android cible (via D:\platform-tools\adb.exe) dans src/assets/streaming.ts et src/diagnostics/metrics.ts.
- [ ] T037 [Plan:P7] Verifier annulation, liberation et perte du device dans tests/lifecycle/.

P1 decide les dependances avant de figer leurs adaptateurs. Une premiere tranche
verticale P2/P3/P4 avec une surface texturée doit alimenter P5 et P6 rapidement.
Developper ensuite les combinaisons OpenPBR, subsurface et volumes. La validation
accompagne chaque phase ; P7 consolide les gates et n'est pas son point de depart.

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
- Le path tracer ne tronque pas les chemins de facon biaisee et ne substitue
  aucun modele approximatif ; les strategies de subsurface et transmission
  proposent plusieurs presets de convergence sans changer le modele physique.
- Le rendu reste statique ; les donnees d'animation et le motion blur ne sont
  pas pris en charge.
- Deux instances compatibles partagent leur pipeline ; un changement de
  parametre dynamique n'entraine aucune recompilation.
- OpenPBR couvre les noeuds/parametres du corpus et leurs interactions, pas
  seulement des demonstrations isolees de chaque feature.
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
| REQ-002 | P1, P4, P7 | Import compose, cameras, scene statique et inventaire |
| REQ-003 | P1, P2, P4 | Dependances qualifiees et adaptateurs |
| REQ-004 | P1, P2, P3 | WASM Core sans appel a un generateur |
| REQ-005 | P3, P7 | Chaine de compilation, caches et instances |
| REQ-006 | P3, P4, P5, P6, P7 | OpenPBR et comparaisons de reference |
| REQ-007 | P3, P5, P6, P7 | Subsurface raster et transport physique |
| REQ-008 | P3, P5, P6, P7 | Volumes homogenes/heterogenes |
| REQ-009 | P5, P7 | Raster complet et approximations declarees |
| REQ-010 | P6, P7 | Path tracing et hybride |
| REQ-011 | P2, P3, P4, P5, P6, P7 | Images, UDIM et couleur |
| REQ-012 | P2, P4, P5, P7 | Instanciation, BVH, clustering et budgets |
| REQ-013 | P1, P7 | Conformite, diagnostics et gates |
| REQ-014 | P1, P3, P7 | Inventaire exhaustif, lowering TypeScript et tests de chaque noeud du corpus |

## 14. Decisions encore ouvertes

- GPU et navigateurs cibles ; objectifs FPS, memoire et temps de convergence.
- Inventaire complet des noeuds et des assets effectivement references.
- Distribution OpenUSD/WASM et integration des references MaterialX.
- Bibliotheques de subdivision et de volumes compatibles navigateur.
- Formats de volume requis et eventuels effets spectraux hors thin film/dispersion du corpus.
- Renderer(s) de reference et tolerances physiques/numeriques.

Ces points se resolvent en qualification. La qualite reste l'objectif final,
mais aucune promesse de support universel MaterialX/OpenUSD ou de performance
chiffree n'est faite sans matrice de conformite et mesures.