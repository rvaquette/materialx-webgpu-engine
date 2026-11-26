import { describe, expect, it } from 'vitest';
import { History } from '../src/history.ts';

describe('application history', () => {
  it('restores isolated snapshots, branches after undo, and ignores no-ops', async () => {
    let value = { position: [1, 2] };
    const history = new History();
    const read = () => value;
    const apply = (next: typeof value) => { value = next; };
    await history.record('move', read, apply, () => { value.position[0] = 3; });
    await history.record('no-op', read, apply, () => {});
    expect(history.undoLabel).toBe('move');
    await history.undo();
    expect(value.position).toEqual([1, 2]);
    await history.redo();
    expect(value.position).toEqual([3, 2]);
    await history.undo();
    await history.record('branch', read, apply, () => { value.position[1] = 4; });
    expect(history.redoLabel).toBeUndefined();
    await history.undo();
    expect(value.position).toEqual([1, 2]);
  });

  it('clears history on failed edits or restores, and propagates errors', async () => {
    let value = 0;
    let fail = false;
    const history = new History();
    const read = () => value;
    const apply = (next: number) => { value = next; if (fail) throw new Error('restore failed'); };
    await history.record('change', read, apply, () => { value = 1; });
    fail = true;
    await expect(history.undo()).rejects.toThrow('restore failed');
    expect(history.undoLabel).toBeUndefined();
    expect(history.redoLabel).toBeUndefined();
    await expect(history.record('failed', read, apply, () => { throw new Error('edit failed'); })).rejects.toThrow('edit failed');
    expect(history.busy).toBe(false);
  });

  it('prevents concurrent traversal and never resurrects a cleared command', async () => {
    let value = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const history = new History();
    const pending = history.record('slow', () => value, next => { value = next; }, async () => {
      await gate;
      value = 1;
    });
    await expect(history.undo()).rejects.toThrow('déjà en cours');
    history.clear();
    release();
    await pending;
    expect(history.undoLabel).toBeUndefined();
  });

  it('limits the number of undo commands', async () => {
    let value = 0;
    const history = new History(() => {}, 2);
    for (let i = 1; i <= 3; i++) {
      await history.record(String(i), () => value, next => { value = next; }, () => { value = i; });
    }
    await history.undo();
    await history.undo();
    expect(value).toBe(1);
    expect(history.undoLabel).toBeUndefined();
  });
});
