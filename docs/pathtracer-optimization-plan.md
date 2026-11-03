# Plan d'optimisation du path tracer

Date : 2026-11-02. Mise a jour : 2026-11-03.
Statut final : T001 a T012 cloturees dans le perimetre d'evaluation du corpus.
T010 : specialisation BSDF testee et rejetee ; prealables BLAS/TLAS et wavefront
evalues, non etablis, donc prototypes non realises. Aucun nouveau defaut qualifie.

Execution demandee : P0/P1/P2 terminees sur le corpus initial PC/mobile.
Les optimisations conditionnelles P3/P4
seront choisies d'apres les mesures, pas activees sans qualification PC/mobile.

Reprise le 2026-11-03 : T008/P3 terminee pour ses trois candidats isoles :
distances AABB en pile, triangles en ordre de feuilles et aretes precalculees.
Aucun candidat n'est qualifie pour remplacer la reference 8x8 sur PC ET mobile.
Les experiences restent explicites ; aucun changement de qualite n'est active.
T009 : le diagnostic capture/rejeu des rayons reels est implemente ; sa campagne
PC/mobile et le prototype BVH4 choisi ensuite sont detailles plus bas.
Le prototype conserve le HDR exact mais ne satisfait pas les seuils PC/mobile :
il reste opt-in. La compression n'a pas ete combinee avec cette experience.
T010 reste conditionnelle : aucun nouveau shading, wavefront ou BLAS/TLAS
n'est justifie par ces diagnostics. Son prerequis capture/rejeu BSDF est
maintenant mesure sur PC/mobile, avec limites et verdict en fin de document.
Le candidat BSDF suivant a indices statiques a aussi ete evalue sur les deux
appareils et rejete selon les seuils ; il reste strictement opt-in.
Cloture suivante de T010 : voir le verdict final en fin de document.
Les passages conditionnels plus anciens ci-dessous retracent les decisions,
pas des taches encore en cours.
T011 : pilote termine, experience isolee du jitter primaire Halton
deja present dans le viewer face au PCG du banc, sans changer le viewer.
Deux references PCG a 256 spp et seeds distinctes forment une moyenne 512 spp ;
cinq seeds de mesure appariees comparent les erreurs RGB lineaires a 8 spp.
Le test ne concerne ni les dimensions BSDF/NEE ni un arret adaptatif.
Les seuils sont fixes avant mesure : ecart des medianes GPU <= 3 %, gain RMSE
>= 5 %, puis confirmation independante et verification du bruit de reference.
Un budget GPU non comparable donne un resultat non concluant a temps egal.
Les images de chaque seed, references, compteurs, chauffe et thermique sont conserves.

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

- [x] T008 [Plan:P3] Tester separement dans
  `src/render/pathtracing/bvh-wgsl.ts` et
  `src/render/pathtracing/scene-buffers.ts` : reutilisation de distance d'entree
  dans la pile, reordonnancement physique des triangles en ordre de feuilles,
  puis stockage v0/e1/e2. Migrer ensemble UV, tangentes, IDs et displacement ;
  invalider le cache si le format change. Mesurer chaque candidat sur les deux GPU.
- [x] T009 [Plan:P3] N'envisager BVH4/compression qu'apres preuve d'un goulot BVH.
  Ajouter un corpus d'intersections (rayons paralleles, limites et transparence)
  et verifier les images sur PC/mobile avant toute activation par defaut.
  - [x] Implementer le profilage optionnel capture/rejeu des rayons reels avec
    compteurs AABB/triangles/noeuds, validation exacte des entrees et du HDR,
    et autotest negatif de corruption d'un rayon.
  - [x] Evaluer un prototype BVH borne sur PC/mobile ; conserver la reference
    tant que les seuils de gain, non-regression et fidelite ne sont pas satisfaits.
    Choix utilisateur : BVH4 non compresse, seul, apres le profilage.
    Conversion de deux niveaux binaires vers quatre enfants GPU ; triangles,
    UV, tangentes, IDs et BVH CPU/hybride restent canoniques.
    Les groupes de fratrie conservent l'ordre near-first binaire, y compris
    les egalites et any-hit. Les bornes reconstruites sont verifiees exactement.
    Cache fichier distinct incluant les noeuds larges ; shader uniquement opt-in.
    Campagne fixee avant mesure : 128x128/8 spp/8x8, trois scenes, une chauffe
    et cinq repetitions alternees reference/BVH4, HDR/compteurs exacts.
    Appliquer les seuils >= 5 % et aucune regression > 3 % sur PC/mobile ;
    confirmer independamment un resultat positif avant toute integration viewer.
    Verdict : essai termine, aucun gain qualifie ; pas d'activation par defaut.
    La qualification optique de transparence et le corpus elargi ne sont pas
    revendiques et restent obligatoires avant une eventuelle adoption future.

### P4. Shading, instanciation et convergence — REQ-003, REQ-004, REQ-006

Depend de P3 et de mesures sur des scenes appropriees. Ces experiences sont
conditionnelles, pas une autorisation de changer le modele physique.

- [x] T010 [Plan:P4] Dans `src/render/pathtracing/compute.ts` et
  `src/compiler/closure-library.ts`, tester une specialisation supplementaire
  uniquement si les mesures indiquent un cout de shading. Pour les scenes
  fortement instanciees, evaluer BLAS/TLAS dans
  `src/render/pathtracing/scene-buffers.ts` avec `src/geometry/bvh.ts`.
  Wavefront seulement si son surcout de files/passes est amorti sur mobile.
  Evaluation cloturee : candidat BSDF teste et rejete ; aucun prototype reutilise
  dans le corpus ; amortissement wavefront mobile non demontre. BLAS/TLAS et
  wavefront non implementes ni qualifies, pas declares plus lents.
  - [x] Prerequis choisi : capture/rejeu borne des appels BSDF, exactitude et
    sensibilite mesurees sur PC/mobile ; pas une implementation de specialisation.
- [x] T011 [Plan:P4] Etudier echantillonnage adaptatif/faible discrepancy dans une
  experience separee : mesurer erreur HDR a temps egal contre reference haut-spp,
  plutot que demander une identite pixel. Aucun arret adaptatif biaise implicite.

### P5. Qualification et integration — REQ-001 a REQ-009

- [x] T012 [Plan:P5] Mettre a jour ce plan avec commandes, rapports, limites et
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

## P3 : aretes de triangles precalculees — aucun gain qualifie

Le candidat explicite `triangleEdges` prepare v0/e1/e2 avec les arrondis float32
de la soustraction WGSL. Il conserve les donnees canoniques et les streams de
shading, utilise un cache distinct et actualise les aretes apres displacement.
Le CPU, l'hybride et les valeurs par defaut restent inchanges.

| Scene | PC reference | PC aretes | Mobile reference | Mobile aretes |
|---|---:|---:|---:|---:|
| gold | 200,15 ms | 208,13 ms | 182,52 ms | 190,84 ms |
| cloth | 288,40 ms | 274,31 ms | 572,59 ms | 576,72 ms |
| tiles | 216,84 ms | 212,35 ms | 423,89 ms | 437,32 ms |

Protocole : 128x128/8 spp, cinq repetitions par scene/variante apres chauffe.
HDR et compteurs strictement identiques sur les deux appareils. Corpus GPU
17 cas avec IDs semantiques et controle GPU specifique displacement/aretes :
succes PC/mobile. Tests de round-trip cache et fixture displacement passes.

Decision : ne pas activer. Gain maximal 4,89 % (cloth PC), sous le seuil 5 % ;
gold regresse de 3,99 % PC et 4,56 % mobile, tiles mobile de 3,17 %.
Le candidat ajoute environ 16,6 Mio pour cloth et 9,2 Mio pour tiles.
La phase preparation/BVH/upload de cloth augmente de 0,50 s PC et 0,26 s mobile :
ce cout ne doit pas etre masque par le seul temps du noyau.

Rapports passes sans erreur de nettoyage :
`renders/pathtracer-benchmark/triangle-edges-pc-res128/report.json`,
`renders/pathtracer-benchmark/triangle-edges-mobile-res128/report.json`.
Controles displacement : `triangle-edges-displacement-pc-smoke` et
`triangle-edges-displacement-mobile-smoke`.
Typecheck, 339 tests pathtracing et cinq tests Node du banc passent.
Le lancement de `npm test` expose une assertion de nombre de fixtures non liee
a ce candidat (45 scenes presentes, 59 attendues) ; le succes de la suite globale
n'est donc pas revendique et cette divergence n'est pas corrigee ici.

## Suite conditionnelle et qualification

T008 est terminee : trois hypotheses testees, aucun gagnant PC/mobile.
T009 : le corpus d'intersections, le diagnostic capture/rejeu et le prototype
BVH4 non compresse sont evalues. Aucun gain qualifie, reference conservee.
La compression reste non executee ; le resultat de ce prototype ne suffit pas
a conclure sur d'autres constructions BVH4 ni sur la bande passante.
T010 : specialisation supplementaire, BLAS/TLAS et wavefront non executes ;
les timings seuls ne permettent pas de conclure a un cout dominant du shading.
T011 : pilote de faible discrepancy primaire termine ci-dessous ; adaptation et
dimensions BSDF/NEE non implementees. Aucune convergence globale n'est qualifiee.
T012 : synthese et decision d'integration terminees pour cette iteration.
Integration viewer d'un nouveau parcours non applicable a ce stade,
car aucun candidat ne satisfait les seuils. Le viewer conserve sa reference.
Le cache fichier du banc est fonctionnel et valide ; sa generalisation au viewer
n'est pas implicite. Ne pas presenter l'ensemble du plan comme termine.

## P4/T011 : convergence du jitter primaire — pilote PC et mobile termine

Experience : reutilisation de `camera_jitter` Halton du viewer, sans changer ses
defauts. Dans le banc uniquement, les deux tirages PCG du jitter sont conserves
pour ne pas decaler les dimensions aleatoires du transport. La seed est un uint32
dans un slot libre de l'uniforme, pas une constante recompilant chaque pipeline.
Les chemins par defaut et la taille de l'uniforme sont conserves.

Protocole fixe avant mesure : 128x128, 8 spp, 8x8, profondeur/camera identiques,
sans clamp/denoising, cinq seeds appariees 1 a 5 et une chauffe par variante.
Reference propre a chaque GPU : moyenne de deux images PCG 256 spp, seeds
1048576 et 2097152. Les erreurs sont des RMSE RGB lineaires, hors compteurs.
Les compteurs exacts, valeurs finies, reproductibilite de seed 1 apres chauffe
et cinq HDR distincts par variante/scene sont verifies. Les images HDR de chaque
seed et les references sont conservees, pas seulement les PNG.

| Scene | GPU PC PCG/Halton (ms) | GPU mobile PCG/Halton (ms) | Gain RMSE PC | Gain RMSE mobile |
|---|---:|---:|---:|---:|
| gold | 237,831 / 323,758 | 185,074 / 182,452 | +11,81 % | +11,69 % |
| cloth | 282,978 / 256,811 | 575,996 / 590,742 | +10,36 % | +10,36 % |
| tiles | 187,703 / 480,723 | 421,003 / 424,346 | -2,29 % | -2,27 % |

Sur mobile, les budgets GPU different respectivement de -1,42 %, +2,56 % et
+0,79 % : ils satisfont la tolerance predefinie de 3 %. Gold/cloth donnent donc
un signal de convergence favorable a budget comparable, non confirme.
Tiles ne montre pas de gain RMSE. Sur PC, les budgets ne sont pas comparables
(-9,25 % a +156,11 %) et plusieurs mesures sont tres dispersees ; aucune
amelioration a temps egal n'est revendiquee a partir de ces chiffres PC.
Ne pas normaliser artificiellement l'erreur par le temps ni expliquer ces
ecarts par une pression de registres sans profilage materiel.

La reference 512 spp reste bruitee : son bruit RMSE estime (deux seeds seulement,
pas une borne d'erreur) vaut environ 0,0073 / 0,0405 / 0,0229 pour gold/cloth/tiles.
Une qualification positive exigerait references plus convergentes et confirmation
independante. Cette iteration ne justifie aucune activation nouvelle : PC non
qualifie, pas de gagnant sur tout le corpus ; le viewer garde son Halton existant.
L'adaptation et les dimensions de transport restent hors de ce pilote.

Rapports finaux passes, sans erreur de nettoyage :

- PC, 42 rendus : `renders/pathtracer-benchmark/sampling-local-uniform/report.json`.
- Mobile, 14 rendus par scene :
  `renders/pathtracer-benchmark/sampling-mobile-gold/report.json`,
  `renders/pathtracer-benchmark/sampling-mobile-cloth/report.json`,
  `renders/pathtracer-benchmark/sampling-mobile-tiles/report.json`.

Le mobile a necessite des reprises apres pertes ADB/CDP. Les campagnes
interrompues ne sont pas melangees aux sessions finales completes ; les sessions
mobiles finales sont separees par scene. Temperature batterie 22,3 a 23,8 C,
statut thermique Android 0 avant/apres chaque session finale. Les releves par
tour sont dans les rapports. Les onglets interrompus identifiables ont ete fermes ;
aucun forward/reverse ADB ne reste apres nettoyage.

Deux corrections de banc sont associees au pilote : repartition des timestamps
sur des query sets de 4096 entrees (8192 au total pour 256 spp), et reprise bornee
avec diagnostic des erreurs reseau transitoires au demarrage de CDP.
Les rapports d'echec precedents restent conserves, sans les presenter comme succes.

Commandes reproductibles (choisir de nouveaux repertoires de sortie) :

```powershell
node scripts\benchmark-pathtracer.mjs --target local --sampling-test --out-dir renders\pathtracer-benchmark\sampling-local-new
node scripts\benchmark-pathtracer.mjs --target mobile --sampling-test --scenes test_material_disney_gold --out-dir renders\pathtracer-benchmark\sampling-mobile-gold-new
node scripts\benchmark-pathtracer.mjs --target mobile --sampling-test --scenes renderman_teapot_cloth --out-dir renders\pathtracer-benchmark\sampling-mobile-cloth-new
node scripts\benchmark-pathtracer.mjs --target mobile --sampling-test --scenes renderman_teapot_tiles --out-dir renders\pathtracer-benchmark\sampling-mobile-tiles-new
```

Le diagnostic ci-dessous a guide le choix de l'experience BVH4 executee ensuite,
sans separer les couts materiels ni justifier une nouvelle architecture de shading.
T010 reste conditionnelle, non executee.

Validation finale de cette iteration : typecheck, 346 tests pathtracing,
11 tests Node du banc et service HTTP du harness passes. Le validateur runtime
standalone passe ses cinq assertions (dont 17 tests de geometrie deja configures).
Ce resultat cible ne constitue pas un succes revendique de toute la suite `npm test`.

## P3/T009 : profilage capture/rejeu des rayons reels

Diagnostic explicitement optionnel, sans modification du shader de production
ni du viewer. Le pipeline instrumente conserve transport, shading et tirages.
Il capture les entrees exactes de chaque requete, le hit et les comptes de tests
AABB/triangles/noeuds, puis rejoue ces hits dans le meme transport.
La verification compare tous les bits des entrees et les comptes d'evenements ;
le HDR brut et les compteurs de samples doivent rester exactement identiques.
Un autotest negatif corrompt un bit de l'origine du premier rayon, exige sa
detection puis restaure le journal avant les etapes normales.

Protocole : 64x64/2 spp, 8x8, trois scenes, une chauffe et cinq repetitions
mesurees par variante. Reference/instrumentation et controle/rejeu alternent.
Chaque diagnostic contient capture, verification, controle et rejeu ; les temps
de readback et d'autotest ne sont pas inclus dans leurs timestamps GPU.
Le journal de 128 evenements par sample reserve 64,125 Mio ; les allocations
au-dela de 128 Mio ou de la limite storage du GPU echouent avant creation.
Debordement, donnees non finies, divergence ou echec d'autotest sont bloquants.

La reduction appariee controle/rejeu est une **sensibilite au remplacement du
parcours**, pas une fraction additive du temps BVH ni une acceleration livree.
Le rejeu lit le journal et conserve le shading ; l'instrumentation modifie aussi
le comportement du pipeline, meme quand elle ne capture pas.
Ni occupation, ni registres, ni bande passante ne sont mesures directement.
Une forte reduction justifie une experience BVH bornee, pas une explication
materielle precise ou une refonte wavefront.

Campagnes finales completes : Intel gen-12lp/Chrome 156 sur PC et Qualcomm
adreno-7xx/Chrome 156 sur SM-F731B, Android 16 via ADB. Chaque rapport contient
36 invocations (chauffes incluses), avec toutes les validations exactes et
`replayMismatchDetected=true`. Les comptes de travail sont stables entre
repetitions d'un appareil ; l'identite inter-GPU n'est pas exigee.

| Appareil / scene | Reference (ms) | Controle (ms) | Rejeu (ms) | Reduction appariee mediane [min ; max] |
|---|---:|---:|---:|---:|
| PC gold | 62,990 | 49,888 | 10,343 | 77,88 % [76,21 ; 80,91] |
| PC cloth | 82,788 | 70,411 | 6,133 | 90,89 % [90,49 ; 91,77] |
| PC tiles | 70,789 | 63,737 | 6,402 | 89,96 % [87,02 ; 90,77] |
| Mobile gold | 62,194 | 51,315 | 16,843 | 62,71 % [62,44 ; 68,07] |
| Mobile cloth | 156,697 | 97,190 | 10,420 | 89,01 % [88,85 ; 89,45] |
| Mobile tiles | 154,665 | 70,058 | 11,469 | 83,83 % [83,26 ; 84,32] |

Ce tableau rapporte des medianes GPU par etape et la mediane des reductions
appariees, pas le rapport des medianes. Le controle instrumente differe de la
reference de -20,80/-14,95/-9,96 % sur PC et -17,49/-37,98/-54,70 % sur mobile
(gold/cloth/tiles) : une attribution numerique au temps BVH de production serait
donc invalide. Les controles PC restent disperses : gold 41,79 a 59,08 ms,
cloth 55,51 a 123,12 ms, tiles 47,24 a 98,99 ms. Les deux ordres controle/rejeu
gardent un signal fort ; gold mobile presente un effet d'ordre (62,58 contre
67,93 % de reduction mediane), conserve dans le rapport, sans moyenne masquante.

Travail capture pour 8192 samples primaires ; valeurs PC / mobile :

| Scene | Rayons | Tests AABB | Tests triangles | Noeuds visites | Max evenements/sample |
|---|---:|---:|---:|---:|---:|
| gold | 19854 / 19862 | 190245 / 190324 | 37708 / 37747 | 93904 / 93945 | 15 |
| cloth | 25235 / 25235 | 1060563 / 1060559 | 119448 / 119452 | 522614 / 522610 | 7 |
| tiles | 28995 / 28994 | 953853 / 953902 | 122083 / 122113 | 475170 / 475186 | 7 |

Temperature batterie mobile 24,2 a 25,0 C, statut thermique Android 0
avant/apres ; releves par tour conserves. Pas de device loss ni d'erreur de
nettoyage. Diagnostics non bloquants conserves : favicon HTTP 404 et avertissement
Chrome Windows sur `powerPreference`. Aucun tunnel ADB forward/reverse restant.

Rapports passes :

- `renders/pathtracer-benchmark/profile-pc-complete/report.json`
- `renders/pathtracer-benchmark/profile-mobile-complete/report.json`

Le rapport interrompu `profile-local-final` et les premiers essais sans autotest
negatif sont conserves mais exclus de ces chiffres. Les premieres campagnes
completes donnaient deja une sensibilite forte sur les deux GPU ; elles ne
remplacent pas la validation renforcee finale.

Decision a l'issue du profilage : prochaine experience justifiee, un seul
prototype BVH isole, sans combiner BVH4 et compression. Garder reference, cle de
cache distincte, corpus d'intersections/HDR PC-mobile, seuils >= 5 % et <= 3 %
de regression puis confirmation independante avant toute integration viewer.
La qualification transparence et corpus elargi reste requise avant adoption.
Le diagnostic seul ne terminait pas T009 ; son prototype est maintenant evalue
ci-dessous. T010 reste conditionnelle. Aucun nouveau defaut, estimateur ou niveau
de qualite ne change.

Validation cible finale : `npm run typecheck`, 357 tests pathtracing dans 29
fichiers et 12 tests Node du banc passent ; `git diff --check` sans erreur.
Le rapport runtime standalone precedent reste celui du pilote T011 et n'est
pas presente comme une nouvelle execution du profilage.

## P3/T009 : prototype BVH4 non compresse — aucun gain qualifie

Choix utilisateur apres profilage : BVH4 seul, sans compression. Le convertisseur
regroupe deux niveaux du SAH binaire en quatre enfants GPU, 48 floats par noeud
large. Les tests de slabs des quatre enfants partagent des operations vectorielles.
Les groupes de fratrie gardent exactement le near-first binaire, ses egalites
et l'ordre any-hit, plutot qu'un nouveau tri global des quatre enfants.
Les unions de bornes supprimees sont verifiees exactement. Une pile de 96 entrees
couvre les hierarchies binaires de profondeur < 64 ; pas d'approximation physique.

Le BVH binaire CPU/hybride et tous les streams de triangles restent canoniques.
Seul le buffer de noeuds lie au compute est remplace. Le cache fichier conserve
le stream large sous une cle distincte ; la validation compare sa derivation
aux noeuds canoniques (cout de verification inclus dans decode, pas de nouveau
build SAH). Les quatre rapports finaux utilisent des cache hits.
Les limites de stockage GPU sont verifiees avant upload.

Protocole fixe : 128x128/8 spp, 8x8, une chauffe et cinq repetitions alternees
par variante/scene/appareil. 72 rendus finaux, HDR brut et compteurs exactement
identiques. Corpus GPU hors chronometrage : 290 cas / 614 evaluations, incluant
egalites, limites, signed zero, vide, quatre enfants actifs et 256 requetes a
travers plusieurs couches d'un BVH profond. Ce dernier teste les intersections
successives, pas le transport optique complet de materiaux transparents.
Les tests CPU couvrent packing, topologie, isolation/round-trip/verification
du cache, inflation displacement, UV/tangentes et bindings canoniques.

| Scene | PC reference / BVH4 (ms) | Gain PC | Mobile reference / BVH4 (ms) | Gain mobile |
|---|---:|---:|---:|---:|
| gold | 210,216 / 385,221 | -83,25 % | 192,086 / 192,348 | -0,14 % |
| cloth | 307,197 / 317,632 | -3,40 % | 569,901 / 551,223 | +3,28 % |
| tiles | 211,119 / 234,440 | -11,05 % | 426,574 / 409,862 | +3,92 % |

Decision : **ne pas activer ce prototype**. Aucun gain mobile n'atteint 5 % et
les trois scenes PC regressent. Une confirmation d'adoption n'est donc pas lancee.
Les chiffres concernent cette conversion BVH4 groupee, pas toutes les
constructions a quatre voies. Aucun diagnostic registres/occupation/bande passante
n'est deduit de ces seuls temps.

Dispersion conservee : BVH4 PC cloth 315,75 a 1112,54 ms et tiles 214,33 a
759,79 ms, contre des references 289,51 a 323,78 ms et 206,25 a 218,61 ms.
Les outliers ne sont pas retires des cinq repetitions. Gold PC reste nettement
plus lent sur toute sa plage 381,96 a 391,29 ms (reference 195,38 a 228,77 ms).
Sur mobile, les plages BVH4 sont 183,30 a 193,46 ms (gold), 547,49 a 552,14 ms
(cloth), 408,68 a 411,04 ms (tiles). Temperature batterie 24,4 a 26,6 C ;
statut thermique Android 0 sur tous les releves finaux.

Memoire du buffer de noeuds GPU, reference / BVH4 :
gold 28560 / 25536 octets, cloth 14430192 / 14367936, tiles 7935312 / 8001792.
Le buffer large remplace le binaire sur GPU ; le CPU et le fichier de cache
conservent les deux representations. Ce n'est pas une experience de compression.

Rapports finaux passes, sans erreur de nettoyage :

- PC : `renders/pathtracer-benchmark/bvh4-pc-final/report.json`.
- Mobile gold : `renders/pathtracer-benchmark/bvh4-mobile-gold-final/report.json`.
- Mobile cloth : `renders/pathtracer-benchmark/bvh4-mobile-cloth-final-v2/report.json`.
- Mobile tiles : `renders/pathtracer-benchmark/bvh4-mobile-tiles-stable-final/report.json`.

Les reprises ne sont pas fusionnees avec ces campagnes completes :
le premier corpus developpait les rayons en switch et sa compilation PC a ete
interrompue ; il utilise maintenant un buffer de rayons et reutilise les memes
pipelines hors chronometrage entre fixtures. Deux pertes de device Android
pendant la compilation BVH4 ont precede la simplification du tri des fratries :
deux valeurs scalaires remplacent les petits tableaux locaux temporaires,
avec la meme semantique et sans changement des slabs vectoriels.
Une recompilation redondante du corpus a aussi bloque une session cloth.
Les benchmarks de l'ancien shader et ces echecs sont conserves mais exclus
du tableau. Le shader chronometre est identique dans les quatre rapports finaux ;
seule la reutilisation des pipelines du corpus non chronometre a change.

Des pertes USB ont interrompu les campagnes mobiles groupees puis tiles.
Les sessions finales sont independantes par scene ; tiles a ete relancee apres
confirmation utilisateur de stabilisation de la connexion. Les onglets de
benchmark interrompus identifiables ont ete fermes, sans fermer Chrome globalement.
Aucun tunnel ADB forward/reverse restant. Les rapports d'echec conservent leurs
erreurs de nettoyage ; seules les quatre campagnes finales sont declarees passees.

Commandes reproductibles : `--bvh-test --bvh-candidate bvh4`, avec les memes
scenes/seuils et de nouveaux repertoires de sortie ; voir [validation](validation.md).
Validation finale : typecheck, 370 tests pathtracing dans 30 fichiers et 13 tests
Node du banc passent ; shader/corpus/HDR verifies sur Intel gen-12lp et
Qualcomm adreno-7xx, Chrome 156. Aucun nouveau defaut du viewer ni de l'hybride.
Le controle PC final a 32x32/1 spp apres reutilisation des pipelines du corpus
est aussi passe : `renders/pathtracer-benchmark/bvh4-pc-corpus-final/report.json` ;
il ne remplace pas les mesures 128x128 du tableau.
T009 est terminee pour le choix BVH4 evalue negativement. Compression, autre
construction BVH4 et T010 restent des hypotheses non executees, pas des gains promis.

### T010 — Profiling BSDF choisi, protocole avant campagne

Apres le verdict BVH4, le choix utilisateur est le profiling shading, pas une
reecriture wavefront ou BLAS/TLAS. Le diagnostic isole uniquement les appels
integrateur `mx_closure_eval`, `mx_closure_specular_eval` et `mx_closure_sample`,
y compris leurs operations internes. Les graphes materiaux, textures, construction
des closures, opacite, reperes, lumieres, MIS, transport et parcours restent actifs.

Protocole fixe : 32x32, 1 spp, 8x8, trois scenes gold/cloth/tiles, une chauffe
exclue puis cinq repetitions PC et Android via ADB. Reference sans instrumentation
et controle instrumente alternent ; capture puis verification precedent les
paires controle/rejeu, dont l'ordre alterne aussi. Les entrees completes de
closure (meme lobes inactifs), directions et tirages sont serialises en scalaires
sans hash ni padding. Chaque sample dispose de 64 evenements ; allocation
plafonnee a 128 MiB et aux limites storage du device, debordement fatal.

Avant exploitation des temps : egalite des bits HDR/compteurs entre tous les
stages et la reference sur le meme GPU, egalite de toutes les entrees et comptes,
autotest negatif par corruption d'un bit du premier evenement non vide, journal
restaure, workload stable entre repetitions. Aucune comparaison bit a bit entre
GPU. Readbacks, autotest, compilation et preparation exclus des timestamps GPU.
Les rapports distinguent perturbation du controle, dispersion et reductions
appariees selon l'ordre. Ces reductions mesurent une sensibilite au remplacement
des appels BSDF par des lectures, pas la part totale du shading ni un gain livre.
Les smoke tests 8x8 PC/Android passent ; ils ne sont pas les mesures finales.
Aucune specialisation supplementaire ni changement de defaut avant decision.

### T010 — Resultats du prerequis BSDF PC/Android

Six sessions finales independantes, 32x32/1 spp, 8x8, cinq repetitions apres
chauffe : 72 rendus reference/controle en incluant les chauffes. Les stages
internes de capture/verification/rejeu sont supplementaires. Sur chaque GPU,
les fichiers HDR `.f32` reference/profile sont identiques en octets ; tous les
stages, entrees completes, comptes et autotests negatifs passent. Les workloads
sont stables entre repetitions du meme appareil. Aucun changement de production.

Medianes GPU en ms ; sensibilite = mediane des reductions appariees
`100 * (1 - rejeu / controle)`, pas reduction des medianes ni gain livre :

| Appareil / scene | Reference | Controle | Rejeu | Perturbation controle | Sensibilite appariee | Min / max (%) |
|---|---:|---:|---:|---:|---:|---:|
| PC gold | 13,667 | 23,497 | 17,780 | +71,93 % | +11,06 % | +3,73 / +28,01 |
| PC cloth | 45,752 | 59,183 | 58,411 | +29,36 % | +2,68 % | +0,07 / +8,10 |
| PC tiles | 33,747 | 46,132 | 45,006 | +36,70 % | +0,70 % | -7,32 / +4,32 |
| Android gold | 22,938 | 23,855 | 22,086 | +4,00 % | +7,59 % | +6,09 / +8,01 |
| Android cloth | 85,524 | 46,727 | 44,499 | -45,36 % | +3,41 % | +0,14 / +13,60 |
| Android tiles | 67,633 | 46,268 | 45,023 | -31,59 % | +2,84 % | +2,27 / +16,18 |

Le controle est parfois plus rapide que la reference sur mobile : c'est une
**perturbation du pipeline instrumente**, pas une optimisation qualifiee.
Les ordres sont rapportes sans retirer d'outlier : sur Android cloth,
rejeu-first / controle-first donnent +0,74 / +8,51 %, et tiles +2,74 / +9,57 %.
Sur PC gold, +10,57 / +19,53 % avec une large dispersion. Ne pas attribuer
ces ecarts a des registres, a l'occupation ou a la bande passante sans compteurs.
Les temperatures batterie Android vont de 24,3 a 27,4 C, statut thermique 0
sur tous les releves. Cela ne mesure pas directement une frequence GPU.

Journal de 31 473 664 octets (30,016 MiB) par rendu, capacite closure 3 lobes,
1 024 samples, 64 evenements reserves par sample :

| Scene | Eval | Sample | Total appels | Somme lobes actifs/appel | Max evenements/sample |
|---|---:|---:|---:|---:|---:|
| gold PC | 404 | 943 | 1 347 | 2 941 | 7 |
| gold Android | 403 | 943 | 1 346 | 2 939 | 7 |
| cloth, deux GPU | 721 | 1 246 | 1 967 | 4 430 | 6 |
| tiles, deux GPU | 1 235 | 1 410 | 2 645 | 5 668 | 6 |

L'ecart gold entre GPU est accepte : seuls les parcours intra-GPU doivent etre
identiques. Aucun appel specular-eval separe dans ces scenes ; son branchement
environnement est couvert par generation WGSL, pas revendique comme exerce par
ces mesures GPU. Les graphes/textures et la construction des closures restent
actifs : aucun verdict sur leur cout global.

Rapports finaux sous `renders/pathtracer-benchmark/` :

- `shading-pc-gold-final/report.json`
- `shading-pc-cloth-final/report.json`
- `shading-pc-tiles-final/report.json`
- `shading-mobile-gold-final/report.json`
- `shading-mobile-cloth-final/report.json`
- `shading-mobile-tiles-final/report.json`

Les smoke tests 8x8 et les essais echoues sont exclus. `shading-pc-final`
a echoue au demarrage Chrome (fichier DevTools temporairement EBUSY, desormais
retente avec diagnostic). `shading-pc-final-v2` a termine gold puis bloque au
chargement des bibliotheques MaterialX de cloth ; pas de resultat cloth ni
de campagne groupee declaree reussie. Les sessions finales independantes passent,
avec nettoyage des ressources detenues. Aucune interruption USB finale.

**Decision : prerequis profiling termine, T010 optimisation reste conditionnelle.**
Gold fournit un signal cible pour une future specialisation BSDF isolee,
a confirmer independamment puis a qualifier sur tout le corpus PC/mobile.
Cloth/tiles ne justifient pas de reecriture generale ; ce diagnostic ne prouve
pas que tout le shading est peu couteux. Aucun wavefront, BLAS/TLAS ou nouveau
modele physique autorise/implemente implicitement, aucun gain renderer revendique.
Les seuils d'adoption 5 % / regression maximale 3 % restent inchanges et ne
s'appliquent pas comme une qualification au rejeu diagnostic.

Validation : typecheck, 376 tests pathtracing (31 fichiers), 14 tests Node
du banc, controles GPU/HDR des six rapports. Le resultat standalone anterieur
reste celui du pilote sampling ; succes du `npm test` global non revendique.

### T010 — Confirmation independante gold, protocole fixe

Choix utilisateur : confirmer le signal avant tout candidat BSDF.
REQ-001/002/003/004/006/007/008 ; reutilisation du banc CDP et des controles
GPU existants, sans nouveau shader, dependance ou changement du viewer.

- [x] T010-C1 [Plan:P4] Executer `scripts/benchmark-pathtracer.mjs` sur PC,
  scene `test_material_disney_gold`, `--shading-profile --repeats 10`,
  resolution 32x32, 1 spp, 8x8, seed et camera inchanges. Nouvelle session
  Chrome et sortie `renders/pathtracer-benchmark/shading-pc-gold-confirm/report.json`.
- [x] T010-C2 [Plan:P4] Executer le meme protocole sur Android autorise via
  `D:\platform-tools\adb.exe`, apres la campagne PC, sortie distincte
  `renders/pathtracer-benchmark/shading-mobile-gold-confirm/report.json`.
- [x] T010-C3 [Plan:P4] Verifier les deux rapports et fichiers HDR persistes,
  comparer les workloads aux sessions initiales du meme GPU, documenter
  perturbation, dispersion, ordre, thermique et verdict dans ce plan et
  `docs/pathtracer-optimization-checkpoints/tasks-to-impl.yaml`.

Strategie de validation : une chauffe exclue par variante puis dix paires
mesurees, cinq rejeu-first et cinq controle-first ; aucun autre benchmark GPU
concurrent. Readiness HTTP et CDP, HDR brut bit-exact a chaque stage,
entrees/comptes exacts et corruption d'un bit detectee puis restauree.
Echec explicite si une condition manque ; aucun remplacement des timestamps
par le temps mural et aucune suppression d'outlier. Les fichiers reference/profile
doivent etre identiques en octets. Les workloads doivent rester identiques a
la premiere campagne du meme GPU ; pas de comparaison exacte entre GPU.

Critere de confirmation fixe **avant mesure** : mediane de sensibilite appariee
>= 5 % sur chacun des deux appareils, mediane positive dans chacun des deux
ordres et au moins 8 reductions positives sur 10 par appareil. Sinon signal
non confirme selon ce protocole, meme si un sous-ensemble est positif.
Rapporter aussi le minimum/maximum et l'ecart controle/reference ; une forte
perturbation limite toujours l'attribution. Ce critere de diagnostic n'est
pas une qualification d'acceleration (5 % / regression maximale 3 % sur le
corpus complet puis viewer). Ne pas implementer automatiquement un candidat
apres cette confirmation ; rendre la decision et ses limites.

### T010 — Verdict de confirmation gold

Les deux sessions independantes passent (code retour 0), 22 rendus chacune :
deux chauffes exclues puis dix reference et dix controles, avec stages internes
capture/verification/rejeu supplementaires. Les GPU restent Intel gen-12lp et
Qualcomm adreno-7xx, Chrome 156. Aucun shader ou code de production modifie.

| Appareil | Reference / controle / rejeu (ms, medianes) | Sensibilite appariee | Min / max (%) | Rejeu-first / controle-first (%) | Paires positives |
|---|---:|---:|---:|---:|---:|
| PC | 14,127 / 18,980 / 17,720 | +11,46 % | -18,91 / +23,73 | +10,13 / +12,76 | 8/10 |
| Android | 22,970 / 23,986 / 22,249 | +7,32 % | +5,54 / +9,51 | +8,42 / +6,56 | 10/10 |

Tous les criteres predeclares sont satisfaits : mediane >= 5 % sur les deux
appareils, mediane positive dans chaque ordre (cinq paires par ordre), au moins
8/10 reductions positives. Le signal BSDF gold est donc **confirme selon ce
protocole**, pas qualifie comme une acceleration. Les medianes initiales
appariees etaient +11,06 % PC et +7,59 % Android ; elles ne sont pas fusionnees
avec la confirmation.

L'ecart controle/reference reste +34,35 % sur PC, +4,42 % sur Android.
Les temps controle PC vont de 13,805 a 24,884 ms et rejeu de 14,025 a 21,383 ms ;
les deux premieres paires sont negatives (-18,91 et -12,75 %), conservees.
La dispersion et la perturbation interdisent toujours une attribution additive
ou materielle. Android : controle 23,658 a 24,445 ms, rejeu 21,823 a 22,413 ms ;
temperature batterie 26,0 a 26,5 C, statut thermique 0 sur tous les releves.

Exactitude verifiee : HDR/compteurs et entrees de chaque stage, autotest negatif,
workloads egaux aux campagnes initiales du meme GPU (1 347 appels PC,
1 346 Android ; journal 31 473 664 octets). Les fichiers HDR reference/profile
persistes sont identiques en octets, ainsi que les references entre campagne
initiale et confirmation sur le meme appareil. Pas de comparaison inter-GPU.
Les rapports finaux ne contiennent aucune erreur de nettoyage ; aucun tunnel
ADB forward/reverse ni processus Chrome du profil benchmark restant.

Preuves :
- `renders/pathtracer-benchmark/shading-pc-gold-confirm/report.json`
- `renders/pathtracer-benchmark/shading-mobile-gold-confirm/report.json`

Decision suivante : une specialisation BSDF isolee ciblee sur gold devient
pertinente a etudier, sans nouvelle architecture generale. Son choix concret
et son implementation ne font pas partie de cette confirmation. Un futur
candidat devra mesurer un vrai pipeline sans journal, conserver le HDR,
passer gold/cloth/tiles sur PC ET Android aux seuils 5 % / regression maximale
3 %, puis confirmer et qualifier le viewer avant adoption. T010 reste ouverte.

### T010 — Candidat isole : evaluation BSDF a indices statiques

Demande utilisateur : executer le candidat suivant. Choix borne : derouler
uniquement les boucles de somme des poids et d'evaluation du melange de base
jusqu'a la capacite scene deja calculee (1 a 8 lobes). Les indices deviennent
constants ; chaque bloc conserve le garde `index < c.lobeCount`, le filtre des
poids et l'ordre des additions/multiplications/divisions. Aucune hypothese
sur l'absence de coat, fuzz, anisotropie ou film ; selection de lobe, tirages,
formules BSDF, MIS, materiaux et geometrie inchanges. L'objectif est de tester
le cout des acces dynamiques dans ces deux boucles, sans promettre de gain.

REQ-001/002/003/004/006/007/008 ; reference et viewer inchanges, candidat opt-in
`--bsdf-test`, incompatible avec les diagnostics/rejeu et autres experiences.
Pas de nouveau cache ni representation de buffers.

- [x] T010-U1 [Plan:P4] Ajouter generation bornee dans
  `src/compiler/closure-library.ts`, option explicite dans
  `src/render/pathtracing/compute.ts`, tests de capacites/gardes/formules et
  preservation des fonctions hors scope dans `tests/compiler/closure-library.test.ts`.
- [x] T010-U2 [Plan:P4] Brancher `tests/render/usd-scene.harness.ts`,
  `usd-image-harness.html`, `scripts/benchmark-pathtracer.mjs` et ses tests :
  variantes reference/unrolled alternees, metadata, cinq repetitions minimum,
  absence de journal et HDR exact obligatoires.
- [x] T010-U3 [Plan:P4] Smoke gold 32x32/1 spp PC et Android via ADB, puis si
  exactitude valide, campagnes separees gold/cloth/tiles 128x128/8 spp,
  une chauffe exclue et cinq repetitions par variante, 8x8, sans clamp/denoising.
- [x] T010-U4 [Plan:P4] Documenter tous les resultats et echecs, mettre a jour
  checkpoint et rapport. Candidat rejetable des la divergence HDR ou regression ;
  gain >= 5 % et aucune regression mediane > 3 % sur le corpus PC/mobile requis
  avant confirmation independante puis qualification viewer. Pas de promotion
  automatique ni cumul avec BVH4/rejeu.

### T010 — Verdict du candidat BSDF a indices statiques

Six campagnes independantes PC/Android terminees sans echec runtime :
128x128/8 spp, 8x8, une chauffe par variante exclue puis cinq repetitions,
ordre alterne, 72 rendus au total en incluant les chauffes. HDR et compteurs
numeriquement exacts a chaque comparaison du banc ; les six paires de fichiers
`.f32` reference/unrolled persistees sont egalement identiques en octets.
Metadata BSDF/parcours/workgroup/compteurs et absence de journal verifiees.
Les sessions gold 32x32/1 spp ont seulement servi de smoke et sont exclues
des statistiques ci-dessous.

| Appareil / scene | Reference GPU (ms) | Unrolled GPU (ms) | Gain median GPU |
|---|---:|---:|---:|
| PC gold | 191,791 | 204,968 | -6,87 % |
| PC cloth | 306,231 | 320,150 | -4,55 % |
| PC tiles | 204,811 | 213,648 | -4,31 % |
| Android gold | 193,593 | 192,938 | +0,34 % |
| Android cloth | 567,542 | 560,071 | +1,32 % |
| Android tiles | 424,608 | 430,178 | -1,31 % |

Decision : **candidat rejete pour adoption**. Les trois regressions PC depassent
3 %, aucun gain mobile n'atteint 5 %. Les outliers PC sont conserves :
cloth unrolled 291,891 a 691,613 ms contre reference 284,344 a 340,922 ms ;
tiles unrolled 179,840 a 546,108 ms contre 183,162 a 244,066 ms.
Gold PC : 197,352 a 220,731 ms contre 189,416 a 227,350 ms.
Pas de diagnostic materiel a partir de ces seuls temps.

Les gains mobiles par scene ne sont pas generalisables au viewer.
Le signal de rejeu BSDF gold ne garantissait pas le gain de ce candidat :
remplacer un appel par des lectures et derouler deux boucles sont deux
experiences distinctes. Le gain mobile gold du petit smoke ne se retrouve pas
a 128x128/8 spp ; il n'est pas utilise comme qualification de substitution.
Pas de confirmation independante supplementaire ni qualification viewer
necessaires pour un candidat deja rejete ; elles restent obligatoires pour
un futur candidat positif.

Rapports sous `renders/pathtracer-benchmark/` :
- `bsdf-unrolled-pc-gold-final/report.json`
- `bsdf-unrolled-pc-cloth-final/report.json`
- `bsdf-unrolled-pc-tiles-final/report.json`
- `bsdf-unrolled-mobile-gold-final/report.json`
- `bsdf-unrolled-mobile-cloth-final/report.json`
- `bsdf-unrolled-mobile-tiles-final/report.json`

Tous les chargements de cache sont des hits. Intel gen-12lp et Qualcomm
adreno-7xx, Chrome 156 ; Android SM-F731B, statut thermique 0 sur tous les
releves, temperature batterie 24,9 a 27,6 C. Aucun tunnel ADB forward/reverse,
profil Chrome de benchmark ou erreur de nettoyage restant.

Validation finale : typecheck, 390 tests dans 32 fichiers (377 pathtracing
et 13 de la bibliotheque closure partagee), 15 tests Node du banc, tous passent.
Les tests couvrent capacites 1/3/8, gardes runtime et ordre arithmetique,
conservation des fonctions hors scope et exclusion du profiling. Le corpus
GPU est celui des trois scenes, pas une preuve exhaustive des huit lobes,
de la transparence ou de toutes les couches. Aucun defaut change, aucune
modification raster/hybride, aucun shader profile utilise pour ces timings.
Les quatre sous-taches T010-U sont terminees ; les autres pistes conditionnelles
T010 (autre specialisation, BLAS/TLAS, wavefront) ne sont pas executees.

### T010 — Cloture conditionnelle des trois volets

Perimetre choisi par l'utilisateur : evaluer les trois pistes, prototyper
celles justifiees, documenter les autres puis cloturer. Le candidat BSDF
precedent constitue l'essai de specialisation ; il est termine et rejete.
Pas de recherche sans fin d'un gagnant imposee par T010.

- [x] T010-A1 [Plan:P4] Mesurer l'instanciation reellement consommee par
  `buildPathTraceScene`, memes draws, exclusions des proxies de lumiere et
  positions manquantes : instances/prototypes, triangles uniques et deployes.
  Valider contre `triangleCount`, avec fixtures reutilisees, distinctes et vides.
- [x] T010-A2 [Plan:P4] Collecter cet inventaire sur gold/cloth/tiles,
  PC et Android ADB, reference seule, 32x32/1 spp, une chauffe et une repetition
  de reproductibilite, dans six nouveaux rapports `--architecture-test`.
  Pas de mesure de performance BLAS/TLAS, ni nouveau shader ou buffers GPU.
- [x] T010-A3 [Plan:P4] Evaluer le prerequis wavefront avec les six rapports
  capture/rejeu de parcours deja verifies, et les etats transport/scheduling
  existants. Rapporter appels closest/any-hit par sample, sans les confondre
  avec profondeur, occupation ou files de bounces mesurees.
- [x] T010-A4 [Plan:P4] Rendre les verdicts bornes au corpus et cloturer T010
  comme evaluation : prototype absent si son prealable n'est pas etabli,
  jamais comme preuve qu'une architecture ne peut pas etre plus rapide.

Criteres de decision : BLAS/TLAS demande une reutilisation de prototypes
significative dans les draws rendus ; un gain potentiel de triangles n'est
pas un gain memoire mesure et n'inclut ni matrices, TLAS, materiaux ou displacement.
Wavefront demande une evidence que tri/compaction et passes supplementaires
seraient amortis sur mobile ; les temps de sensibilite ne prouvent pas ce point.
Sans ces prealables, ne pas introduire de changement d'architecture de production.
Les seuils d'adoption 5 % / regression maximale 3 % restent inchanges.

### T010 — Verdict final par volet et cloture

| Volet | Travail effectue | Decision sur le corpus actuel |
|---|---|---|
| Specialisation BSDF | Profiling/rejeu, confirmation gold, candidat de deux boucles a indices statiques, six campagnes PC/mobile 128x128/8 spp | Candidat rejete : regressions PC > 3 %, gains mobiles < 5 %. Aucun changement par defaut. |
| BLAS/TLAS | Inventaire des draws effectivement packes et controle GPU reference PC/mobile | Pas de prototype : aucune reutilisation de prototype, donc prealable « fortement instancie » absent. Aucun gain/perte BLAS/TLAS mesure. |
| Wavefront | Analyse du transport/scheduling et des six profils reels de parcours deja valides | Pas de prototype : amortissement des files/tri/compaction/passes non demontre sur mobile. Ni gain ni regression wavefront mesures. |

#### Inventaire BLAS/TLAS

La fonction `pathTraceInstancingInventory` dans
[scene-buffers.ts](../src/render/pathtracing/scene-buffers.ts) utilise les memes
draws/exclusions que le packing du path tracer. Le nombre deploye doit egaler
`ptScene.triangleCount`, y compris quand le cache fichier est relu. Deux geometries
semblables avec des IDs de prototype distincts ne sont pas declarees partageables.
Une deduplication de contenu serait une autre experience, non realisee ici.

| Scene | Instances rendues | Prototypes uniques | Prototypes reutilises | Triangles uniques / deployes | Reutilisation potentielle |
|---|---:|---:|---:|---:|---:|
| gold | 3 | 3 | 0 | 974 / 974 | 0 % |
| cloth | 4 | 4 | 0 | 483 920 / 483 920 | 0 % |
| tiles | 3 | 3 | 0 | 268 752 / 268 752 | 0 % |

Ces comptes sont identiques sur PC et Android, stables entre chauffe/repetition,
et les triangles deployes correspondent aux buffers prepares. Les ressources
scene possedent deja des BLAS/TLAS CPU ; le path tracer GPU utilise actuellement
la soupe mondiale et son BVH global. Leur simple presence CPU n'est pas une
integration GPU, et l'inventaire ne mesure ni les octets d'une representation
future ni un temps de parcours futur.

Six rapports reference seule, 32x32/1 spp, une chauffe et une repetition chacun :
12 rendus valides, pas une campagne de qualification de performance.
Fichiers HDR reference persistes identiques en octets aux references des campagnes
BSDF initiales, sur le meme GPU. Aucun shader, modele physique ou buffer GPU
ajoute pour cet inventaire ; calcul CPU hors timestamps de rendu.

- `renders/pathtracer-benchmark/architecture-pc-gold-final-v2/report.json`
- `renders/pathtracer-benchmark/architecture-pc-cloth-final/report.json`
- `renders/pathtracer-benchmark/architecture-pc-tiles-final/report.json`
- `renders/pathtracer-benchmark/architecture-mobile-gold-final/report.json`
- `renders/pathtracer-benchmark/architecture-mobile-cloth-final-v2/report.json`
- `renders/pathtracer-benchmark/architecture-mobile-tiles-final/report.json`

Le premier essai PC gold a echoue au nettoyage du profil Chrome (EPERM) :
rapport conserve en echec, repertoire temporaire explicitement identifie et
supprime apres verification, puis nouvelle session complete. Le premier essai
Android cloth a perdu la connexion USB : rapport conserve en echec avec erreurs
de nettoyage. Apres reconnexion, seul son onglet identifie par URL/port a ete
ferme via un tunnel temporaire detenu, puis la session a ete relancee. Les
six rapports finaux passent sans erreur de nettoyage ; aucun tunnel ADB
forward/reverse ni processus Chrome du profil benchmark restant.
Statut thermique Android 0, temperature batterie 24,6 a 24,7 C dans ces sessions.

#### Evaluation du prealable wavefront

Sources runtime deja validees (pas de nouvelle execution de ces campagnes) :
`profile-pc-complete/report.json` et `profile-mobile-complete/report.json`
sous `renders/pathtracer-benchmark/`. Chaque scene comprend 8 192 samples
captures a 64x64/2 spp ; les entrees, comptes, HDR et autotests negatifs
de ces rapports avaient passe. Les valeurs suivantes sont de vrais nombres
d'appels au parcours, **pas** des nombres de bounces ou des compteurs d'occupation :

| Scene | Closest/sample (PC et Android) | Any-hit/sample PC / Android | Max appels/sample PC et Android |
|---|---:|---:|---:|
| gold | 1,77649 | 0,64709 / 0,64807 | 15 |
| cloth | 1,98975 | 1,09070 / 1,09070 | 7 |
| tiles | 2,14697 | 1,39246 / 1,39233 | 7 |

Le megakernel de [compute.ts](../src/render/pathtracing/compute.ts) conserve
actuellement direction/origine, throughput/radiance, RNG, MIS, dernier repere,
medium actif, canal spectral et couverture. Il gere aussi des evenements nuls
d'opacite et des collisions de volume, qui ne sont pas interchangeables avec
un simple bounce de surface. Un wavefront equivalent devrait persister ces
etats et conserver les tirages par sample, la logique roulette et l'ordre
d'accumulation. Les ombres devraient aussi conserver les contributions avant
recombinaison. Le banc actuel soumet des tiles/samples sans queues compactees ;
les 64 iterations maximales du code ne signifient pas 64 bounces effectifs.

Ces moyennes courtes n'excluent pas un benefice de regroupement ; elles ne
mesurent ni divergence des lanes, ni distribution par profondeur, ni cout
des queues/passes. Aucune mesure disponible n'etablit que leur surcout serait
amorti sur mobile. Le critere conditionnel original n'est donc pas satisfait :
**wavefront non retenu pour prototype dans ce lot**, sans conclusion sur sa
vitesse potentielle. Pas de temps « estime » presente comme un benchmark,
pas de microbenchmark de dispatch vide substitue au vrai transport.

#### Conclusion et conditions de reouverture

T010 est **cloturee comme evaluation conditionnelle du corpus**, conformement
au perimetre choisi. Cela ne signifie ni implementation de BLAS/TLAS/wavefront,
ni epuisement de toutes les optimisations possibles. Les trois volets ont un
verdict ; aucune tache active ne reste dans ce plan.

Reouvrir une experience distincte si un corpus reel fortement instancie est
fourni, si des profils de files/compaction mettent en evidence un amortissement
mobile, ou si un nouveau candidat BSDF concret est identifie. Toute adoption
future conserve les exigences HDR, PC/mobile, gain >= 5 %, regression maximale
3 %, confirmation independante et qualification viewer. Les defauts reference
8x8, les estimateurs et le rendu restent inchanges.

Validation finale : typecheck, 392 tests dans 32 fichiers (379 pathtracing,
13 closure partagee) et 16 tests Node du banc passent, codes retour 0.
Couverture ajoutee : identite de prototypes, partage reel, geometries distinctes,
scene vide, positions absentes, proxies exclus, egalite avec triangles prepares,
stabilite des rapports et exclusion des autres experiences. Verification finale
des six rapports, fichiers HDR et nettoyage : code retour 0.
Le `npm test` global et l'ancien rapport standalone ne sont pas revendiques
comme reexecutes pour ce lot.
