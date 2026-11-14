import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForExportPage } from './export-browser-session.mjs';

test('waits for the export page to finish navigating, including context replacement', async () => {
  const url = 'http://127.0.0.1:1234/__export_scene.html';
  const responses = [
    { url: 'about:blank', readyState: 'complete' },
    new Error('Execution context was destroyed.'),
    { url, readyState: 'loading' },
    { url, readyState: 'interactive' },
  ];
  let calls = 0;
  const connection = { async send() {
    const response = responses[calls++];
    if (response instanceof Error) throw response;
    return { result: { value: response } };
  } };
  await waitForExportPage(connection, url, 2000);
  assert.equal(calls, responses.length);
});

test('reports an export page that never loads', async () => {
  const connection = { async send() {
    return { result: { value: { url: 'about:blank', readyState: 'complete' } } };
  } };
  await assert.rejects(waitForExportPage(connection, 'http://127.0.0.1:1234/__export_scene.html', 20),
    /Timed out loading export page.*about:blank/);
});

test('propagates unexpected browser errors', async () => {
  const connection = { async send() { throw new Error('Export browser disconnected.'); } };
  await assert.rejects(waitForExportPage(connection, 'http://127.0.0.1:1234/__export_scene.html'),
    /Export browser disconnected/);
});
