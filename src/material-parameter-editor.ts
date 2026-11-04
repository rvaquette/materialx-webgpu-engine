import { ImGui } from '@mori2003/jsimgui';
import type { MaterialParameter } from './render/material-parameters.ts';

interface ParameterEditorOptions {
  parameters: () => readonly MaterialParameter[];
  apply: (changes: ReadonlyMap<string, readonly number[]>) => Promise<void>;
  error: (error: unknown) => void;
}

/** Serialize costly rebuilds and coalesce edits while preserving the latest values. */
export class MaterialParameterEditor {
  readonly #options: ParameterEditorOptions;
  #pending = new Map<string, readonly number[]>();
  #drafts = new Map<string, readonly number[]>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running = false;
  #generation = 0;

  constructor(options: ParameterEditorOptions) { this.#options = options; }

  refresh(): void {
    clearTimeout(this.#timer);
    this.#pending.clear();
    this.#drafts.clear();
    this.#generation++;
  }

  draw(): void {
    const parameters = this.#options.parameters();
    ImGui.TextWrapped(parameters.length
      ? 'Entrees explicites non liees. Valeurs lineaires ; selecteur couleur sRGB.'
      : 'Aucune entree numerique explicite et non liee.');
    if (!parameters.length) return;
    if (ImGui.Button('Reinitialiser les parametres')) {
      for (const parameter of parameters) this.#queue(parameter, parameter.initial);
      clearTimeout(this.#timer);
      void this.#flush();
    }
    for (const parameter of parameters) {
      ImGui.PushID(parameter.id);
      ImGui.SeparatorText(parameter.label);
      ImGui.Text(`${parameter.type} - ${parameter.update === 'uniform' ? 'En direct' : 'Recalcul apres modification'}`);
      const current = [...(this.#drafts.get(parameter.id) ?? parameter.value)];
      if (parameter.type === 'boolean') {
        const checked: [boolean] = [current[0] === 1];
        if (ImGui.Checkbox('Valeur', checked)) this.#queue(parameter, [checked[0] ? 1 : 0]);
      } else {
        if (parameter.type === 'float') {
          const value: [number] = [current[0]!];
          if (ImGui.SliderFloat('Curseur', value, Math.min(0, value[0]), Math.max(1, value[0] * 2))) {
            current[0] = value[0];
            this.#queue(parameter, current);
          }
        }
        if (parameter.type === 'color3') {
          const srgb = (value: number): number => value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
          const color: [number, number, number] = [srgb(current[0]!), srgb(current[1]!), srgb(current[2]!)];
          if (ImGui.ColorEdit3('Couleur sRGB', color)) {
            const linear = color.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
            current.splice(0, current.length, ...linear);
            this.#queue(parameter, current);
          }
        }
        current.forEach((value, i) => {
          const input: [number] = [value];
          const changed = parameter.type === 'integer'
            ? ImGui.InputInt(`Valeur ${i + 1}`, input)
            : ImGui.InputFloat(`Valeur ${i + 1}`, input, 0, 0, '%.6g');
          if (changed) {
            current[i] = input[0];
            if (current.every(Number.isFinite)) this.#queue(parameter, current);
            else this.#options.error(new Error(`Valeur invalide : ${parameter.label}`));
          }
        });
      }
      ImGui.PopID();
    }
  }

  #queue(parameter: MaterialParameter, values: readonly number[]): void {
    this.#drafts.set(parameter.id, [...values]);
    this.#pending.set(parameter.id, [...values]);
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => { void this.#flush(); }, parameter.update === 'uniform' ? 0 : 180);
  }

  async #flush(): Promise<void> {
    if (this.#running || !this.#pending.size) return;
    clearTimeout(this.#timer);
    const generation = this.#generation;
    const changes = this.#pending;
    this.#pending = new Map();
    this.#running = true;
    try {
      await this.#options.apply(changes);
      if (generation === this.#generation) {
        for (const id of changes.keys()) if (!this.#pending.has(id)) this.#drafts.delete(id);
      }
    } catch (error) {
      if (generation === this.#generation) this.refresh();
      this.#options.error(error);
    } finally {
      this.#running = false;
      if (this.#pending.size) void this.#flush();
    }
  }
}
