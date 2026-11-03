# Plan d'optimisation du path tracer

Date : 2026-11-02. Statut : execution commencee, aucune acceleration encore qualifiee.

Execution demandee : P0/P1/P2 terminees sur le corpus initial PC/mobile.
Les optimisations conditionnelles P3/P4
seront choisies d'apres les mesures, pas activees sans qualification PC/mobile.

Reprise le 2026-11-03 : T008/P3 en cours. Premiere experience terminee
(distances AABB en pile : rejetee). Experience de reordonnancement physique des triangles terminee, sans gain qualifie.
Experience suivante en cours : stockage v0/e1/e2 avec aretes precalculees.
Reference et candidat restent en 8x8, avec les memes seeds et parametres de
transport. Le format/cle de cache doit distinguer les layouts ; tous les streams
par triangle et le displacement doivent rester coherents.
Les autres candidats T008 ne sont pas declares termines par cette seule experience.

## Objectif et exigences

Ce plan complete [le plan du moteur](../plan.md), sans remplacer les optimisations
existantes. Source : demande utilisateur de planifier et lancer les optimisations,
avec essais obligatoires sur mobile via `D:\platform-tools\adb.exe`.

| Exigence | Critere |
|---|---|
| REQ-001 | Reference reproductible sur PC et sur mobile physique autorise par ADB. |
| REQ-002 | Distinguer compilation, preparation, temps GPU et temps mural de rendu. |
| REQ-003 | Comparer a scene, camera, resolution, spp, seed et profondeur identiques, sans denoising ni clamp. |
| REQ-004 | Conserver les changements seulement apres validation du rendu HDR brut et tests existants. |
| REQ-005 | Essayer les tailles de workgroup avant de modifier les algorithmes. |
| REQ-006 | Etudier BVH/localite memoire, specialisation et instanciation selon les mesures. |
| REQ-007 | Documenter modele, GPU, navigateur, OS, chauffe et dispersion des mesures. |
| REQ-008 | Ne pas degrader silencieusement le mobile ; signaler toute indisponibilite ou regression. |
| REQ-009 | Sauvegarder d'abord BVH et buffers prepares dans un fichier local rechargeable, pour eviter leur recalcul aux essais suivants. |

## Contexte technique et principes

- TypeScript, WGSL/WebGPU, Vite, Vitest ; harness USD et Chrome/CDP deja presents.
- BVH binaire SAH en espace monde, cache IndexedDB, ombres any-hit pour scenes
  opaques, specialisation des lobes et suppression de fonctions deja en place.
- PC : Chrome local. Mobile connecte observe : SM-F731B, Android 16.
  Ne pas figer le GPU d'apres le modele : relever `GPUAdapter.info` au runtime.
- Aucune approximation physique, baisse de profondeur ou changement de resolution
  ne sera presente comme une acceleration equivalente.
- Workgroup par defaut 8x8 conserve tant qu'une alternative n'est pas qualifiee.
- Les resultats sont propres a chaque appareil ; pas de promesse universelle.

Conformite : preservation des estimateurs/MIS, erreurs explicites, option de
reference, pas de dependance supplementaire. Pas de migration de framework :
aucune guideline de transformation applicable.

## Etapes et taches

### P0. Premiere tache : cache des buffers dans un fichier local — REQ-002, REQ-003, REQ-004, REQ-009

Priorite ajoutee a la demande utilisateur : cette tache precede les prochaines
campagnes d'optimisation. Les essais deja lances restent des references sans cache fichier.
Le cache IndexedDB actuel conserve le BVH et les positions, mais ne constitue pas
un fichier de buffers prepare partageable entre les essais PC et mobile.

- [x] T001 [Plan:P0] Implementer la sauvegarde/relecture binaire versionnee des
  buffers prepares dans `src/render/pathtracing/scene-buffer-cache.ts`, la brancher
  dans `tests/render/usd-scene.harness.ts` et `scripts/benchmark-pathtracer.mjs`,
  et ajouter `tests/render/pathtracing/scene-buffer-cache.test.ts`.
  Le fichier est conserve sur le disque du PC sous `.cache/pathtracer/` et servi
  localement au navigateur PC et au mobile via ADB reverse ; aucune API de fichier
  Android ni permission File System Access n'est necessaire.
  Sauvegarder au minimum noeuds BVH, ordre des triangles, positions/normales/IDs,
  UV et tangentes ; inclure les autres buffers prepares seulement si leur validite
  peut etre prouvee. Camera et parametres editables ne doivent pas etre figes.
  Utiliser une cle de contenu/version couvrant geometrie, transformations,
  affectations materiaux et options de displacement ; verifier les types, tailles,
  indices et integrite avant upload. Une entree absente, obsolete ou corrompue
  produit un diagnostic explicite et un recalcul, jamais un resultat obsolete.
  Distinguer cache-miss/build/write et cache-hit/read/decode/upload dans les
  mesures. Comparer les buffers octet par octet et le rendu HDR, avec et sans
  cache, sur PC et mobile ; tester invalidation, corruption et redemarrage serveur.
  Ne pas serialiser GPUBuffer, pipelines ni objets dependants du GPUDevice.

### P1. Instrumentation et reference — REQ-001, REQ-002, REQ-003, REQ-007, REQ-008

- [x] T002 [Plan:P1] Ajouter les mesures optionnelles `timestamp-query` et le
  transfert HDR brut dans `tests/render/usd-scene.harness.ts` ; indiquer explicitement
  leur absence si le GPU ne les expose pas. Ne pas changer le viewer courant.
- [x] T003 [Plan:P1] Creer `scripts/benchmark-pathtracer.mjs` pour piloter le meme
  harness sur PC et mobile, avec port CDP attribue dynamiquement, nettoyage des
  seules ressources creees, rapport JSON partiel meme en cas d'echec.
- [x] T004 [Plan:P1] Mesurer une reference 8x8, apres chauffe exclue, repetitions
  appariees/intercalees avec les candidats. Relever Android/Chrome/GPU et etat
  thermique avant/apres ; ne pas melanger les timings de compilation et de trace.

### P2. Premiere experience : workgroups — REQ-003, REQ-004, REQ-005, REQ-008

- [x] T005 [Plan:P2] Rendre la taille de workgroup optionnelle et validee dans
  `src/render/pathtracing/compute.ts`, y compris le calcul du dispatch.
  Comparer 8x8 a 4x4, 16x4 et 16x8 sans changer les seeds.
- [x] T006 [Plan:P2] Ajouter les tests de generation/dispatch et de statistiques
  dans `tests/render/pathtracing/compute.test.ts` et
  `scripts/benchmark-pathtracer.test.mjs`, executer le typecheck.
- [x] T007 [Plan:P2] Executer les essais sur PC ET mobile, comparer les floats HDR
  et compteurs de samples de chaque candidat a la reference du meme appareil ;
  sauvegarder PNG et rapports sous `renders/pathtracer-benchmark/`.

### P3. BVH et bande passante — REQ-004, REQ-006, REQ-008

Depend de P1/P2. Demarrer par un cas dense en geometrie si le corpus initial
est trop petit pour identifier un cout d'intersection.

- [ ] T008 [Plan:P3] Tester separement dans
  `src/render/pathtracing/bvh-wgsl.ts` et
  `src/render/pathtracing/scene-buffers.ts` : reutilisation de distance d'entree
  dans la pile, reordonnancement physique des triangles en ordre de feuilles,
  puis stockage v0/e1/e2. Migrer ensemble UV, tangentes, IDs et displacement ;
  invalider le cache si le format change. Mesurer chaque candidat sur les deux GPU.
- [ ] T009 [Plan:P3] N'envisager BVH4/compression qu'apres preuve d'un goulot BVH.
  Ajouter un corpus d'intersections (rayons paralleles, limites et transparence)
  et verifier les images sur PC/mobile avant toute activation par defaut.

### P4. Shading, instanciation et convergence — REQ-003, REQ-004, REQ-006

Depend de P3 et de mesures sur des scenes appropriees. Ces experiences sont
conditionnelles, pas une autorisation de changer le modele physique.

- [ ] T010 [Plan:P4] Dans `src/render/pathtracing/compute.ts` et
  `src/compiler/closure-library.ts`, tester une specialisation supplementaire
  uniquement si les mesures indiquent un cout de shading. Pour les scenes
  fortement instanciees, evaluer BLAS/TLAS dans
  `src/render/pathtracing/scene-buffers.ts` avec `src/geometry/bvh.ts`.
  Wavefront seulement si son surcout de files/passes est amorti sur mobile.
- [ ] T011 [Plan:P4] Etudier echantillonnage adaptatif/faible discrepancy dans une
  experience separee : mesurer erreur HDR a temps egal contre reference haut-spp,
  plutot que demander une identite pixel. Aucun arret adaptatif biaise implicite.

### P5. Qualification et integration — REQ-001 a REQ-009

- [ ] T012 [Plan:P5] Mettre a jour ce plan avec commandes, rapports, limites et
  verdicts ; n'integrer dans `src/render/viewer.ts` que les candidats qualifies
  sur PC et mobile. Garder 8x8 si aucun gagnant robuste n'existe.

## Strategie de validation et seuils

- SPA/harness GPU : Node existant, Chrome local, Chrome Android debuggable,
  mobile deverrouille, ADB autorise. Aucun envoi vers un service tiers.
- Corpus initial : `test_material_disney_gold`, `renderman_teapot_cloth`,
  `renderman_teapot_tiles` sous `scenes/pathtracer/` ; completer par procedural, geometrie
  dense, alpha, verre, volumes, HDR et displacement avant qualification globale.
- Parcours : import/compilation, trace progressif identique, ombres/alpha,
  lecture HDR finie, liberation GPU, absence de device loss.
- Au moins une chauffe et cinq repetitions mesurees par candidat et par scene ;
  varier l'ordre, reporter mediane et min/max. Augmenter le budget si le bruit
  domine ; ne jamais decider sur un rendu unique.
- Workgroups : image HDR et compteurs strictement identiques sur un meme GPU.
  Transformations arithmetiques : fixer une tolerance justifiee AVANT l'essai ;
  documenter toute perte d'identite et verifier statistiquement la convergence.
- Gain candidat : objectif median >= 5 %, sans regression mediane > 3 % sur
  l'autre cible ou une scene qualifiee ; confirmer par une deuxieme session.
  Sinon : resultat non concluant, candidat non active par defaut.
- `timestamp-query` indisponible : rapport explicite `null`, temps mural
  submit/fence disponible, precision GPU non revendiquee.
- Echec ADB/WebGPU, NaN, mauvais compteur, image noire inattendue ou erreur WGSL :
  echec, jamais skip assimile a un succes.
- Relever etat thermique/batterie ; une session avec throttling ou forte derive
  doit etre repetee apres refroidissement.

## Structure et commandes

```text
docs/pathtracer-optimization-plan.md
docs/pathtracer-optimization-checkpoints/{spec-to-plan,plan-to-tasks}.yaml
scripts/benchmark-pathtracer.mjs
scripts/benchmark-pathtracer.test.mjs
.cache/pathtracer/*.bin
renders/pathtracer-benchmark/{local,mobile}/report.json
```

```powershell
npm run typecheck
npx vitest run tests\render\pathtracing\compute.test.ts
node --test scripts\benchmark-pathtracer.test.mjs
node scripts\benchmark-pathtracer.mjs --target local
node scripts\benchmark-pathtracer.mjs --target mobile
node scripts\benchmark-pathtracer.mjs --target local --res 64 --spp 2 --repeats 1 --scenes test_material_disney_gold --cache-test --out-dir renders\pathtracer-benchmark\cache-check-local
node scripts\benchmark-pathtracer.mjs --target mobile --res 64 --spp 2 --repeats 1 --scenes test_material_disney_gold --cache-test --out-dir renders\pathtracer-benchmark\cache-check-mobile
```

## Requirement Mapping

| REQ ID | Plan Items | Preuves attendues |
|---|---|---|
| REQ-001 | P1, P2, P5 | rapports local/mobile, T003/T004/T007/T012 |
| REQ-002 | P0, P1 | cache/build/read/upload et timings GPU/muraux, T001/T002/T004 |
| REQ-003 | P0, P1, P2, P4 | options fixes, invalidation et HDR, T001/T002/T005/T007/T011 |
| REQ-004 | P0, P2, P3, P4, P5 | tests, comparaison buffers/HDR, T001/T006 a T012 |
| REQ-005 | P2 | shader et dispatch parametrables, T005 a T007 |
| REQ-006 | P3, P4 | experiences conditionnelles, T008 a T011 |
| REQ-007 | P1 | metadata appareil et thermique, T003/T004 |
| REQ-008 | P1, P2, P3, P5 | erreurs et regressions visibles, T003/T007/T008/T012 |
| REQ-009 | P0, P5 | fichier binaire local, reload PC/mobile et invalidation, T001/T012 |

## Execution initiale (avant ajout de la priorite P0)

- Instrumentation et variantes implementees ; typecheck, 63 tests compute et
  3 tests du banc valides.
- Essais courts PC/mobile : timestamps GPU disponibles, HDR et compteurs
  identiques pour les quatre workgroups. Rapport mobile :
  `renders/pathtracer-benchmark/smoke-mobile/report.json`.
- Campagne PC sans cache fichier terminee : 72 rendus (dont 12 chauffes), trois
  scenes, cinq repetitions par workgroup ; parite HDR exacte.
  Rapport : `renders/pathtracer-benchmark/local-2/report.json`.
  La commande a signale une deconnexion CDP pendant la fermeture de Chrome ;
  les mesures sont presentes mais cette execution n'est pas un succes de bout
  en bout du runner. Le nettoyage est ajuste pour verifier la sortie effective.
  Controle subsequent du runner et de sa fermeture : succes, code de sortie 0,
  rapport `renders/pathtracer-benchmark/cleanup-check/report.json`.
- Aucun changement de workgroup active dans le viewer. La campagne mobile
  repetee et les experiences suivantes attendent T001/P0 pour eviter de reconstruire
  les memes donnees a chaque essai.
- Le validateur runtime MCP est indisponible (initialisation du serveur echouee).
  Les validations directes TypeScript, unitaires et GPU restent distinctes.
- Suite pathtracing/viewer : 288 tests passent, un echec preexistant dans
  `tests/render/pathtracing/scene-buffers.test.ts:102` attend 20 floats de lumiere
  alors que `PT_LIGHT_FLOATS` vaut deja 28 dans la revision de depart.
  Corrige a la demande utilisateur : l'assertion utilise maintenant
  `PT_LIGHT_FLOATS` ; les 22 tests de ce fichier passent.

### Premiere lecture des workgroups PC (non qualifiee sur mobile)

Medianes de temps GPU a 128x128, 8 spp, cinq repetitions, hors chauffe :

| Scene | 8x8 | 4x4 | 16x4 | 16x8 |
|---|---:|---:|---:|---:|
| test_material_disney_gold | 105,36 ms | 108,46 ms | 198,62 ms | 209,18 ms |
| renderman_teapot_cloth | 311,67 ms | 296,63 ms | 306,56 ms | 320,64 ms |
| renderman_teapot_tiles | 211,09 ms | 186,29 ms | 209,64 ms | 211,57 ms |

4x4 est un candidat a confirmer (gain de 11,7 % sur tiles, mais regression de
2,9 % sur gold et seulement 4,8 % de gain sur cloth). Les variantes 16x4/16x8
regressent fortement sur gold. Aucune n'est adoptee : il manque la campagne
mobile repetee, une seconde session et la qualification du viewer.
Le mobile des essais courts expose Qualcomm Adreno 7xx / Chrome 156 ; etat
thermique Android 0, batterie 23,8 a 23,9 degres C pendant ce seul controle.

## T001 : cache fichier implemente et qualifie

Les fichiers binaires sous `.cache/pathtracer/` contiennent noeuds BVH, triangles
avec normales et IDs materiaux, permutation, UV et tangentes. La cle SHA-256 couvre
les streams/indices sources, transformations, ordre des affectations materiaux et
options de displacement. Le format versionne inclut une empreinte d'integrite et
valide dimensions, indices, topologie et bornes avant upload.
Le rechargement evite la transformation/packing des triangles et la construction
SAH ; camera, materiaux editables, variantes et eclairage restent prepares a neuf.
Le middleware local ne sert/ecrit que des noms SHA-256 sous le repertoire de cache.
Cette integration concerne le banc d'essai ; le viewer garde son cache IndexedDB.

Controles PC/mobile reussis : refresh, hit apres redemarrage serveur et rechargement
page, verification octet par octet contre calcul neuf, puis bypass. Images HDR
et compteurs exactement identiques sur chaque GPU.

| Mesure gold 64x64 / 2 spp (un controle, pas un benchmark statistique) | PC | Mobile |
|---|---:|---:|
| Calcul a neuf | 72,69 ms | 19,45 ms |
| Lecture fichier au hit | 9,03 ms | 37,50 ms |
| Decodage/validation au hit | 12,66 ms | 16,41 ms |
| Preparation dynamique au hit | 3,66 ms | 2,48 ms |
| Recalcul geometrie/BVH au hit | 0 ms | 0 ms |

Ce petit cas mobile n'est PAS accelere au total : lecture/validation depassent
le calcul a neuf. Mesurer une scene dense avant de generaliser le gain.
L'import USD/maillages et la compilation MaterialX ne sont pas caches par T001.
L'ecriture initiale PC a presente un pic de 5 s ; ce cout ponctuel est expose
separement dans le rapport, pas masque dans le temps de trace.

Rapports : `renders/pathtracer-benchmark/cache-local-t001-final/report.json` et
`renders/pathtracer-benchmark/cache-mobile-t001-final/report.json` (statut passed,
nettoyage termine). Validation parent : typecheck, 119 tests Vitest
cache/scene-buffers/compute, un test middleware Vitest et trois tests Node du banc.
Le test middleware doit etre lance via Vitest, pas `node --test` : il importe du
TypeScript avec syntaxe non prise en charge par le mode strip-only de Node.

## P2 : campagne mobile repetee et decision

Commande terminee avec code 0 :

```powershell
node scripts\benchmark-pathtracer.mjs --target mobile --out-dir renders\pathtracer-benchmark\mobile-cached-p2
```

72 rendus : 12 chauffes exclues, cinq repetitions par variante et trois scenes,
128x128 / 8 spp. Cache fichier : 70 hits, deux misses ; le transport ne change pas.
Parite HDR et compteurs exacte pour tous les workgroups. ADB forward/reverse
retires en fin de commande. Temperature batterie finale 29,0 degres C,
etat thermique Android 0.

| Scene | 8x8 | 4x4 | 16x4 | 16x8 |
|---|---:|---:|---:|---:|
| test_material_disney_gold | 188,74 ms | 179,18 ms | 190,97 ms | 203,62 ms |
| renderman_teapot_cloth | 569,64 ms | 631,77 ms | 582,48 ms | 627,18 ms |
| renderman_teapot_tiles | 425,26 ms | 444,01 ms | 410,06 ms | 455,87 ms |

Decision : conserver 8x8. Le candidat 4x4 gagne 5,1 % sur gold mobile mais
regresse de 10,9 % sur cloth et 4,4 % sur tiles. 16x4 regresse fortement sur
gold PC et 16x8 ne presente aucun avantage global. Aucun candidat ne passe les
seuils du plan ; inutile de l'activer dans le viewer ou de revendiquer un gain.
Les timings GPU sont exploitables pour cette decision negative, mais ne constituent
pas une comparaison du temps total de chargement PC/mobile (cache different).

Validation finale : typecheck, 324 tests Vitest pathtracing/viewer et trois tests
Node du banc passent. La correction du test de taille des lumieres est incluse.
P3/P4 restent ouvertes : prochaine experience, localite/parcours BVH a rendu
constant sur scene dense, avec cache invalide si le format evolue. Aucun changement
de parcours, de shading ou d'estimateur n'est encore implemente par ces phases.

## P3 : distances d'entree dans la pile BVH — candidat rejete

Experience terminee sur scenes denses (cloth : 483 920 triangles / 300 629 noeuds ;
tiles : 268 752 triangles / 165 319 noeuds). Le candidat conserve la distance AABB
du noeud differe dans une deuxieme pile privee de 64 floats pour supprimer le test
AABB au depilement. Il reste accessible explicitement via `bvhTraversal: 'cachedEntry'`.
Les valeurs par defaut compute et hybride restent la reference, identique au code
initial ; aucun changement de format du cache pour ce candidat.

Chaque campagne : 128x128, 8 spp, 8x8, cinq repetitions intercalees et une chauffe
exclue par scene/variante, cache hit, timestamps GPU, sans clamp/denoising.

| Scene | PC reference | PC candidat | Mobile reference | Mobile candidat |
|---|---:|---:|---:|---:|
| gold | 194,86 ms | 193,82 ms | 183,83 ms | 247,99 ms |
| cloth | 312,47 ms | 259,06 ms | 567,21 ms | 730,01 ms |
| tiles | 207,89 ms | 456,92 ms | 426,12 ms | 584,45 ms |

Decision : rejeter l'activation par defaut, regressions mobile de 28,7 a 37,2 %,
et forte regression tiles PC. Une premiere campagne PC tres dispersee a ete repetee ;
les valeurs PC ci-dessus proviennent de la seconde session. Une pression accrue
sur les registres est plausible, mais non demontree sans profilage materiel.
Thermique Android : statut 0, batterie 25,0 a 25,4 degres C.

HDR brut et compteurs strictement identiques. Corpus GPU analytique : 17 cas
par appareil (paralleles, zero signe, limites, egalites, ombres any-hit et buffers
vides), 34 comparaisons reference/candidat. Typecheck, 149 tests Vitest et cinq
tests Node du banc passent ; aucun echec de nettoyage.

Rapports : `renders/pathtracer-benchmark/bvh-entry-local/report.json`,
`renders/pathtracer-benchmark/bvh-entry-local-confirm/report.json`,
`renders/pathtracer-benchmark/bvh-entry-mobile/report.json`.
Details : `renders/pathtracer-benchmark/bvh-entry/runtime-validation-report.md`.
Les fichiers HDR sauvegardes des trois campagnes ont aussi ete compares octet
par octet (108 images dont 90 mesurees). T008 reste ouverte pour les layouts.

## P3 : triangles en ordre de feuilles — aucun gain qualifie

Le layout experimental `leafOrder` reordonne les triangles avec normales/IDs,
UV et tangentes dans l'ordre des feuilles et supprime la lecture dependante de
la permutation lors du parcours GPU. Les cles du cache distinguent reference et
candidat ; les donnees CPU/hybrides de reference et les defauts restent inchanges.

| Scene | PC reference | PC leafOrder | Mobile reference | Mobile leafOrder |
|---|---:|---:|---:|---:|
| gold | 214,23 ms | 217,68 ms | 188,88 ms | 183,96 ms |
| cloth | 309,69 ms | 307,00 ms | 579,99 ms | 584,19 ms |
| tiles | 209,19 ms | 213,02 ms | 425,92 ms | 436,08 ms |

Meme protocole 128x128/8 spp, cinq repetitions intercalees et une chauffe exclue.
72 rendus sur les deux appareils : HDR et compteurs exactement identiques.
Corpus GPU 17 cas/34 comparaisons par appareil, avec IDs semantiques et ordre any-hit.
Validation : typecheck, 152 tests Vitest et cinq tests Node passent.
Les tests couvrent separation/reutilisation des caches, camera/materiaux dynamiques
et preservation des donnees de displacement.

Decision : ne pas activer. Aucun gain n'atteint 5 % ; variation maximale positive
2,6 % (gold mobile), regression maximale 2,38 % (tiles mobile).
Pas de campagne de confirmation necessaire pour adopter ce resultat negatif.
Rapports passes sans erreur de nettoyage :
`renders/pathtracer-benchmark/triangle-layout-full-pc/report.json`,
`renders/pathtracer-benchmark/triangle-layout-full-mobile/report.json`.
Les controles courts sont sous `triangle-layout-smoke-pc` et
`triangle-layout-smoke-mobile`. T008 reste ouverte pour le stockage v0/e1/e2.
