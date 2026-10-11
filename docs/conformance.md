# Matrice de conformité MaterialX

Cette matrice recense **tous les nœuds MaterialX** utilisés par le corpus de
référence (`MaterialX-rva/resources/Materials/Examples`) et leur niveau de prise
en charge par chaque backend. Elle est la contrepartie lisible des fixtures
machine :

- Inventaire des nœuds : [`tests/fixtures/materialx-nodes.json`](../tests/fixtures/materialx-nodes.json)
- Scènes de contrôle déterministes : [`tests/fixtures/control-scenes.json`](../tests/fixtures/control-scenes.json)

Les tests d'exécution par nœud (T034) et la comparaison de rendus (T035)
consomment ces fixtures. Le test [`tests/fixtures/conformance.test.ts`](../tests/fixtures/conformance.test.ts)
garantit que cette matrice et les fixtures restent cohérentes.

## Légende des niveaux

| Niveau | Signification |
| --- | --- |
| `supported` | Évaluation exacte (fonction déterministe ou BSDF/transport analytique). |
| `reference` | Transport de référence non biaisé (path tracing). |
| `approximated` | Approximation **déclarée** côté raster (plan 9.1). |

## Corpus

| Famille | Matériaux | Surface racine |
| --- | --- | --- |
| StandardSurface | 21 | `standard_surface` |
| OpenPbr | 10 | `open_pbr_surface` |
| DisneyPrincipled | 5 | `disney_principled` |
| GltfPbr | 6 | `gltf_pbr` |
| UsdPreviewSurface | 6 | `UsdPreviewSurface` |
| SimpleHair | 1 | `simple_hair` |

## Nœuds par catégorie

### Surfaces

| Nœud | Familles | Raster | Path tracing |
| --- | --- | --- | --- |
| `standard_surface` | StandardSurface | supported | reference |
| `open_pbr_surface` | OpenPbr | supported | reference |
| `disney_principled` | DisneyPrincipled | supported | reference |
| `gltf_pbr` | GltfPbr | supported | reference |
| `UsdPreviewSurface` | UsdPreviewSurface | supported | reference |
| `surface` | SimpleHair | supported | reference |
| `simple_hair` | SimpleHair | approximated | reference |

### BSDF / cheveux

| Nœud | Familles | Raster | Path tracing |
| --- | --- | --- | --- |
| `chiang_hair_bsdf` | SimpleHair | approximated | reference |
| `chiang_hair_absorption_from_color` | SimpleHair | supported | supported |
| `chiang_hair_roughness` | SimpleHair | supported | supported |
| `deon_hair_absorption_from_melanin` | SimpleHair | supported | supported |

### Texturing

| Nœud | Familles | Raster | Path tracing |
| --- | --- | --- | --- |
| `image` | StandardSurface | supported | supported |
| `tiledimage` | StandardSurface, UsdPreviewSurface | supported | supported |
| `hextiledimage` | StandardSurface | supported | supported |
| `gltf_image` | GltfPbr | supported | supported |
| `gltf_colorimage` | GltfPbr | supported | supported |
| `normalmap` | StandardSurface | supported | supported |
| `gltf_normalmap` | GltfPbr | supported | supported |

### Géométrie / placement

| Nœud | Familles | Raster | Path tracing |
| --- | --- | --- | --- |
| `place2d` | StandardSurface | supported | supported |
| `texcoord` | StandardSurface | supported | supported |
| `position` | StandardSurface | supported | supported |

### Math

| Nœud | Familles | Raster | Path tracing |
| --- | --- | --- | --- |
| `add` | StandardSurface | supported | supported |
| `subtract` | StandardSurface | supported | supported |
| `multiply` | StandardSurface | supported | supported |
| `divide` | StandardSurface | supported | supported |
| `power` | StandardSurface | supported | supported |
| `max` | StandardSurface | supported | supported |
| `clamp` | StandardSurface | supported | supported |
| `sin` | StandardSurface | supported | supported |
| `dotproduct` | StandardSurface | supported | supported |
| `mix` | StandardSurface, SimpleHair | supported | supported |

### Couleur

| Nœud | Familles | Raster | Path tracing |
| --- | --- | --- | --- |
| `hsvtorgb` | StandardSurface | supported | supported |
| `rgbtohsv` | StandardSurface | supported | supported |
| `convert` | StandardSurface | supported | supported |
| `constant` | StandardSurface | supported | supported |

### Canaux

| Nœud | Familles | Raster | Path tracing |
| --- | --- | --- | --- |
| `combine3` | StandardSurface | supported | supported |
| `separate3` | GltfPbr | supported | supported |
| `extract` | StandardSurface | supported | supported |

### Procédural

| Nœud | Familles | Raster | Path tracing |
| --- | --- | --- | --- |
| `fractal3d` | StandardSurface | supported | supported |

## Effets à approximation déclarée (raster)

Conformément au plan 9.1, les effets suivants sont **exacts en path tracing** et
**approximés en raster**, avec l'approximation déclarée dans le module raster
correspondant :

| Effet | Module raster | Référence path tracing |
| --- | --- | --- |
| Transmission / réfraction | `src/render/raster/transmission.ts` | `src/render/pathtracing/media.ts` |
| Transparence (OIT) | `src/render/raster/transmission.ts` | intégrateur |
| Subsurface | `src/render/raster/subsurface.ts` | `src/render/pathtracing/subsurface.ts` |
| Volumes | `src/render/raster/volume.ts` | `src/render/pathtracing/media.ts` |
| Thin film / dispersion (spectral) | approximation RGB déclarée | `src/render/pathtracing/spectrum.ts` |
| Cheveux (chiang) | approximation raster | intégrateur + BSDF cheveux |

## Scènes de contrôle

Caméra, lumière directionnelle, résolution et graine du sampler sont fixées pour
garantir des rendus déterministes et comparables entre backends.

| Scène | Famille | Backends | Focus |
| --- | --- | --- | --- |
| `standard_surface_default` | StandardSurface | raster, pathtracing, hybrid | base |
| `standard_surface_thin_film` | StandardSurface | pathtracing | thin_film, spectral |
| `standard_surface_glass` | StandardSurface | raster, pathtracing | transmission |
| `standard_surface_jade` | StandardSurface | raster, pathtracing | subsurface |
| `open_pbr_default` | OpenPbr | raster, pathtracing, hybrid | base |
| `open_pbr_soapbubble` | OpenPbr | pathtracing | thin_film, spectral |
| `open_pbr_glass` | OpenPbr | raster, pathtracing | transmission |
| `open_pbr_honey` | OpenPbr | pathtracing | volume, subsurface |
| `disney_principled_default` | DisneyPrincipled | raster, pathtracing | base |
| `disney_principled_glass` | DisneyPrincipled | raster, pathtracing | transmission |
| `gltf_pbr_default` | GltfPbr | raster, pathtracing | base |
| `gltf_pbr_glass` | GltfPbr | raster, pathtracing | transmission |
| `usd_preview_surface_default` | UsdPreviewSurface | raster, pathtracing | base |
| `simple_hair_default` | SimpleHair | pathtracing | hair |
