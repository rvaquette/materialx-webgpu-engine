# Plan d'optimisation du path tracer

Date : 2026-11-02. Statut : execution commencee, aucune acceleration encore qualifiee.

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
campagnes d'optimisation. Les essais deja lances restent des references a froid.
Le cache IndexedDB actuel conserve le BVH et les positions, mais ne constitue pas
un fichier de buffers prepare partageable entre les essais PC et mobile.

- [ ] T001 [Plan:P0] Implementer la sauvegarde/relecture binaire versionnee des
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
- [ ] T004 [Plan:P1] Mesurer une reference 8x8, apres chauffe exclue, repetitions
  appariees/intercalees avec les candidats. Relever Android/Chrome/GPU et etat
  thermique avant/apres ; ne pas melanger les timings de compilation et de trace.

### P2. Premiere experience : workgroups — REQ-003, REQ-004, REQ-005, REQ-008

- [x] T005 [Plan:P2] Rendre la taille de workgroup optionnelle et validee dans
  `src/render/pathtracing/compute.ts`, y compris le calcul du dispatch.
  Comparer 8x8 a 4x4, 16x4 et 16x8 sans changer les seeds.
- [x] T006 [Plan:P2] Ajouter les tests de generation/dispatch et de statistiques
  dans `tests/render/pathtracing/compute.test.ts` et
  `scripts/benchmark-pathtracer.test.mjs`, executer le typecheck.
- [ ] T007 [Plan:P2] Executer les essais sur PC ET mobile, comparer les floats HDR
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
