const forwards = (await import('node:child_process')).execFileSync('D:\\platform-tools\\adb.exe', ['forward', '--list']).toString().trim().split(/\r?\n/);
for (const line of forwards) {
  const port = line.split(/\s+/)[1]?.replace('tcp:', '');
  if (!port) continue;
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const t = list.find(p => /^http:\/\/localhost:(?!5180)\d+\//.test(p.url));
  if (!t) continue;
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { awaitPromise: true, returnByValue: true, expression: `globalThis.__mxRunScript('log(JSON.stringify(stats()))').then(r => r.logs?.[0] ?? r.message)` } }));
  const value = await new Promise(r => ws.addEventListener('message', e => r(JSON.parse(e.data).result?.result?.value)));
  const s = JSON.parse(value);
  console.log(`${s.backend} ${s.pathTracer} : ${s.samples} ${s.adaptive ? 'balayages' : 'spp'}, ${s.elapsed?.toFixed(0)} s actives, ${s.samplesPerSecond?.toFixed(1)}/s, bruit max ${(s.maxNoise * 100).toFixed(1)} % (cible 25 %), restant estimé ${s.remaining?.toFixed(0) ?? '-'} s, arrêt ${s.stopReason ?? '-'}`);
  ws.close();
}
process.exit(0);

