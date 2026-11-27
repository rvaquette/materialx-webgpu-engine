/** Coalesces animation frames while an asynchronous scene update is in flight. */
export function schedulePlaybackFrames(
  update: (time: number) => Promise<boolean>, onError: (error: unknown) => void,
): () => void {
  let active = true;
  let pending = false;
  let queued: number | undefined;
  let frame = 0;
  const stop = (): void => {
    active = false;
    cancelAnimationFrame(frame);
  };
  const run = (time: number): void => {
    pending = true;
    void update(time).then(keepPlaying => {
      pending = false;
      if (!active) return;
      if (!keepPlaying) { stop(); return; }
      if (queued !== undefined) {
        const latest = queued;
        queued = undefined;
        run(latest);
      }
    }, error => {
      stop();
      onError(error);
    });
  };
  const tick = (time: number): void => {
    if (!active) return;
    frame = requestAnimationFrame(tick);
    if (pending) queued = time;
    else run(time);
  };
  frame = requestAnimationFrame(tick);
  return stop;
}
