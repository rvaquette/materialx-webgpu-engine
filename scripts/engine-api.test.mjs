import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { ENGINE_API_REPORT, engineApiReport } from './engine-api.mjs';

test('the engine package API matches the frozen report (npm run api:engine after an intended change)', async () => {
  const actual = engineApiReport().split('\n');
  const expected = (await readFile(ENGINE_API_REPORT, 'utf8')).replace(/\r\n/g, '\n').split('\n');
  const line = actual.findIndex((text, i) => text !== expected[i]);
  if (line < 0 && actual.length === expected.length) return;
  const at = line < 0 ? Math.min(actual.length, expected.length) : line;
  assert.fail(`Public API changed at docs/engine-api.md line ${at + 1}:\n- ${expected[at] ?? '<end>'}\n+ ${actual[at] ?? '<end>'}\n` +
    'Review the compatibility rules in docs/ENGINE_API.md, then run npm run api:engine.');
});
