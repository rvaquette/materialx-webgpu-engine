type Command = { label: string; undo: () => Promise<void>; redo: () => Promise<void> };

/** Bounded, in-memory commands. A failed operation may have partially changed its target. */
export class History {
  #undo: Command[] = [];
  #redo: Command[] = [];
  #busy = false;
  #generation = 0;
  constructor(private readonly changed: () => void = () => {}, private readonly limit = 100) {}

  get undoLabel(): string | undefined { return this.#undo.at(-1)?.label; }
  get redoLabel(): string | undefined { return this.#redo.at(-1)?.label; }
  get busy(): boolean { return this.#busy; }

  clear(): void {
    this.#generation++;
    this.#undo = [];
    this.#redo = [];
    this.changed();
  }

  async record<T>(label: string, read: () => T, apply: (value: T) => void | Promise<void>, edit: () => void | Promise<void>): Promise<void> {
    await this.#run(async () => {
      const generation = this.#generation;
      const before = structuredClone(read());
      await edit();
      const after = structuredClone(read());
      if (generation !== this.#generation) return;
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      this.#undo.push({ label, undo: async () => { await apply(structuredClone(before)); },
        redo: async () => { await apply(structuredClone(after)); } });
      if (this.#undo.length > this.limit) this.#undo.shift();
      this.#redo = [];
    });
  }

  async undo(): Promise<void> { await this.#move(this.#undo, this.#redo, 'undo'); }
  async redo(): Promise<void> { await this.#move(this.#redo, this.#undo, 'redo'); }

  async #move(from: Command[], to: Command[], direction: 'undo' | 'redo'): Promise<void> {
    await this.#run(async () => {
      const generation = this.#generation;
      const command = from.at(-1);
      if (!command) return;
      await command[direction]();
      if (generation !== this.#generation) return;
      from.pop();
      to.push(command);
    });
  }

  async #run(action: () => Promise<void>): Promise<void> {
    if (this.#busy) throw new Error('Une opération de l’historique est déjà en cours.');
    this.#busy = true;
    this.changed();
    try { await action(); }
    catch (error) { this.clear(); throw error; }
    finally { this.#busy = false; this.changed(); }
  }
}
