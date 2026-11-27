// Priorité 24 : images source pour l'étude du transport vidéo des rendus.
// Génère une séquence raster déterministe à 24 i/s depuis une scène USD animée.
// npm run script -- examples/scripts/p24-render-transport-frames.js --out docs/images/p24

const mobile = capabilities()?.mobile === true;
const pathTraceResolution = mobile ? 256 : 512;
const pad = value => String(value).padStart(3, "0");
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
await scene("./scenes/bench/animated.usda");
const range = timeline();
check(range, "la scène doit exposer une timeline");
check(range.fps === 24, `cadence inattendue : ${range.fps}`);

const first = range.start;
const last = Math.min(range.end, first + 12);
const rasterRuns = [];
for (const [width, directory] of [[512, "01-raster"], [256, "03-raster-256"]]) {
  render.resolution = width;
  render.backend = "raster";
  const frames = [];
  for (let time = first; time <= last; time += 1) {
    const started = performance.now();
    await setTime(time);
    check(stats().time === time, `timecode ${time} appliqué`);
    await save(`${directory}/frame-${pad(time - first)}.png`);
    frames.push({ time, elapsedMs: Math.round(performance.now() - started) });
  }
  const times = frames.map(frame => frame.elapsedMs);
  rasterRuns.push({
    resolution: `${width}x${width}`,
    frames: frames.length,
    frameBudgetMs: 1000 / range.fps,
    medianCaptureMs: median(times),
    maxCaptureMs: Math.max(...times),
    frames,
  });
}

const pathTraceFrames = [];
render.resolution = pathTraceResolution;
render.backend = "pathtracing";
render.depth = 4;
const samples = mobile ? 8 : 32;
for (const time of [first, first + 6, last]) {
  const started = performance.now();
  await setTime(time);
  await render(samples);
  await save(`02-pathtracing/frame-${pad(time - first)}.png`);
  pathTraceFrames.push({ time, samples, elapsedMs: Math.round(performance.now() - started) });
}

const report = {
  scene: "scenes/bench/animated.usda",
  fps: range.fps,
  start: first,
  end: last,
  raster: rasterRuns,
  pathTracingResolution: `${pathTraceResolution}x${pathTraceResolution}`,
  pathTracing: { frames: pathTraceFrames },
};
log(JSON.stringify(report));
for (const run of rasterRuns) {
  log(`Raster ${run.resolution}: ${run.frames.length} frames, médiane ${run.medianCaptureMs} ms, max ${run.maxCaptureMs} ms (budget ${run.frameBudgetMs.toFixed(1)} ms à ${range.fps} i/s).`);
}
log(`Path tracing : ${pathTraceFrames.map(frame => `${frame.time}=${frame.elapsedMs} ms/${frame.samples} spp`).join(", ")}.`);
