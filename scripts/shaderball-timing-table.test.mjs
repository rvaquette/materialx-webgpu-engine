import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTimingTable } from './shaderball-timing-table.mjs';

test('timing table sums current cases without overlapping totals or saved cases', () => {
  const report = {
    server: 'static',
    timings: { serverStartup: 50, browserStartup: 950, cleanup: 500, commandTotal: 10000 },
    cases: [{ timings: { render: 999999 } }],
  };
  const table = formatTimingTable(report, [
    { timings: { render: 1000, sceneResources: 2000, total: 7000, caseWall: 8000 } },
    { timings: { render: 2000, rasterPreparation: 1000, total: 7000 } },
    { status: 'failed' },
  ]);
  assert.match(table, /Démarrage serveur statique \+ Chrome\/CDP\s+\|\s+1,0 s/);
  assert.match(table, /Rendu\s+\|\s+3,0 s/);
  assert.match(table, /Préparation des ressources de scène\s+\|\s+2,0 s/);
  assert.match(table, /Préparation raster\s+\|\s+1,0 s/);
  assert.match(table, /Autres opérations et nettoyage\s+\|\s+3,0 s/);
  assert.match(table, /Total du script\s+\|\s+10,0 s/);
  assert.doesNotMatch(table, /BVH|NaN|999/);
});

test('timing table handles an early failure or an entirely resumed run', () => {
  const table = formatTimingTable({ timings: { commandTotal: 200 } }, []);
  assert.match(table, /Démarrage Vite \+ Chrome\/CDP/);
  assert.match(table, /Autres opérations et nettoyage\s+\|\s+0,2 s/);
  assert.doesNotMatch(table, /Rendu|NaN/);
});

test('memory table takes maxima, not sums of sequential cases', () => {
  const cpu = {
    node: { rss: 1048576, peakRss: 2097152, heapUsed: 1, external: 1, arrayBuffers: 1 },
    chrome: { rss: 3145728, privateBytes: 4194304 },
  };
  const table = formatTimingTable({ timings: { commandTotal: 0 }, memory: { cpu } }, [
    { memory: { gpu: { peakBufferBytes: 1048576, peakTextureBytes: 2097152, peakBytes: 3145728, unknownFormats: [] } } },
    { memory: { gpu: { peakBufferBytes: 2097152, peakTextureBytes: 1048576, peakBytes: 2097152, unknownFormats: ['bc1-rgba-unorm'] } } },
  ]);
  assert.match(table, /CPU Node : RSS \(max. relevé\)\s+\|\s+1,0 Mio/);
  assert.match(table, /CPU Chrome \+ enfants : RSS \(max. relevé\)\s+\|\s+3,0 Mio/);
  assert.match(table, /GPU estimé : pic buffers\s+\|\s+2,0 Mio/);
  assert.match(table, /GPU estimé : pic total simultané\s+\|\s+3,0 Mio/);
  assert.match(table, /GPU formats non comptabilisés\s+\|\s+bc1-rgba-unorm/);
});
