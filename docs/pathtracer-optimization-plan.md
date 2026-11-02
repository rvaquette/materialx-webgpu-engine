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

### P1. Instrumentation et reference — REQ-001, REQ-002, REQ-003, REQ-007, REQ-008

- [ ] T001 [Plan:P1] Ajouter les mesures optionnelles `timestamp-query` et le
  transfert HDR brut dans `tests/render/usd-scene.harness.ts` ; indiquer explicitement
  leur absence si le GPU ne les expose pas. Ne pas changer le viewer courant.
- [ ] T002 [Plan:P1] Creer `scripts/benchmark-pathtracer.mjs` pour piloter le meme
  harness sur PC et mobile, avec port CDP attribue dynamiquement, nettoyage des
  seules ressources creees, rapport JSON partiel meme en cas d'echec.
- [ ] T003 [Plan:P1] Mesurer une reference 8x8, apres chauffe exclue, repetitions
  appariees/intercalees avec les candidats. Relever Android/Chrome/GPU et etat
  thermique avant/apres ; ne pas melanger les timings de compilation et de trace.

### P2. Premiere experience : workgroups — REQ-003, REQ-004, REQ-005, REQ-008

- [ ] T004 [Plan:P2] Rendre la taille de workgroup optionnelle et validee dans
  `src/render/pathtracing/compute.ts`, y compris le calcul du dispatch.
  Comparer 8x8 a 4x4, 16x4 et 16x8 sans changer les seeds.
- [ ] T005 [Plan:P2] Ajouter les tests de generation/dispatch et de statistiques
  dans `tests/render/pathtracing/compute.test.ts` et
  `scripts/benchmark-pathtracer.test.mjs`, executer le typecheck.
- [ ] T006 [Plan:P2] Executer les essais sur PC ET mobile, comparer les floats HDR
  et compteurs de samples de chaque candidat a la reference du meme appareil ;
  sauvegarder PNG et rapports sous `renders/pathtracer-benchmark/`.

### P3. BVH et bande passante — REQ-004, REQ-006, REQ-008

Depend de P1/P2. Demarrer par un cas dense en geometrie si le corpus initial
est trop petit pour identifier un cout d'intersection.

- [ ] T007 [Plan:P3] Tester separement dans
  `src/render/pathtracing/bvh-wgsl.ts` et
  `src/render/pathtracing/scene-buffers.ts` : reutilisation de distance d'entree
  dans la pile, reordonnancement physique des triangles en ordre de feuilles,
  puis stockage v0/e1/e2. Migrer ensemble UV, tangentes, IDs et displacement ;
  invalider le cache si le format change. Mesurer chaque candidat sur les deux GPU.
- [ ] T008 [Plan:P3] N'envisager BVH4/compression qu'apres preuve d'un goulot BVH.
  Ajouter un corpus d'intersections (rayons paralleles, limites et transparence)
  et verifier les images sur PC/mobile avant toute activation par defaut.

### P4. Shading, instanciation et convergence — REQ-003, REQ-004, REQ-006

Depend de P3 et de mesures sur des scenes appropriees. Ces experiences sont
conditionnelles, pas une autorisation de changer le modele physique.

- [ ] T009 [Plan:P4] Dans `src/render/pathtracing/compute.ts` et
  `src/compiler/closure-library.ts`, tester une specialisation supplementaire
  uniquement si les mesures indiquent un cout de shading. Pour les scenes
  fortement instanciees, evaluer BLAS/TLAS dans
  `src/render/pathtracing/scene-buffers.ts` avec `src/geometry/bvh.ts`.
  Wavefront seulement si son surcout de files/passes est amorti sur mobile.
- [ ] T010 [Plan:P4] Etudier echantillonnage adaptatif/faible discrepancy dans une
  experience separee : mesurer erreur HDR a temps egal contre reference haut-spp,
  plutot que demander une identite pixel. Aucun arret adaptatif biaise implicite.

### P5. Qualification et integration — REQ-001 a REQ-008

- [ ] T011 [Plan:P5] Mettre a jour ce plan avec commandes, rapports, limites et
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
| REQ-001 | P1, P2, P5 | rapports local/mobile, T002/T003/T006/T011 |
| REQ-002 | P1 | timings GPU/muraux/compilation, T001/T003 |
| REQ-003 | P1, P2, P4 | options fixes et HDR, T001/T004/T006/T010 |
| REQ-004 | P2, P3, P4, P5 | tests, comparaison HDR, T005 a T011 |
| REQ-005 | P2 | shader et dispatch parametrables, T004 a T006 |
| REQ-006 | P3, P4 | experiences conditionnelles, T007 a T010 |
| REQ-007 | P1 | metadata appareil et thermique, T002/T003 |
| REQ-008 | P1, P2, P3, P5 | erreurs et regressions visibles, T002/T006/T007/T011 |
