#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

// Créer un dossier renders s'il n'existe pas
const outputDir = './renders';
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Message d'information
console.log(`
╔════════════════════════════════════════════════════════╗
║  Coffee Pot Render - Disney vs Path Tracer (256 SPP)   ║
╚════════════════════════════════════════════════════════╝

Pour générer les rendus, veuillez:

1. Ouvrir le navigateur:
   http://127.0.0.1:5173/test-coffee-pot.html

2. Attendre que les deux rendus se complètent (256/256 SPP)

3. Cliquer sur le bouton "Export PNGs" pour télécharger les images

Les rendus seront sauvegardés dans: ${outputDir}/

Options disponibles:
- Path Tracer: Raytrace complet avec Monte Carlo integration
- Disney: Rasterization avec matériaux PBR

Spécifications:
- Résolution: 512x512
- Samples Per Pixel: 256
- Scène: coffee_pot.usda
`);

// Afficher les fichiers existants
const existing = fs.readdirSync(outputDir).filter(f => f.startsWith('coffee-pot-'));
if (existing.length > 0) {
  console.log(`\n✓ Fichiers rendus existants (${existing.length}):`);
  existing.forEach(f => {
    const fPath = path.join(outputDir, f);
    const stat = fs.statSync(fPath);
    const size = (stat.size / 1024).toFixed(2);
    console.log(`  - ${f} (${size} KB)`);
  });
}
