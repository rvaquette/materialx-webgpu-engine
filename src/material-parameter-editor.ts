import type { MaterialParameter } from './render/material-parameters.ts';

interface ParameterEditorOptions {
  container: HTMLElement;
  parameters: () => readonly MaterialParameter[];
  apply: (changes: ReadonlyMap<string, readonly number[]>) => Promise<void>;
  error: (error: unknown) => void;
}

function linearToHex(values: readonly number[]): string {
  return '#' + values.map(value => {
    const linear = Math.max(0, Math.min(1, value));
    const srgb = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
    return Math.round(srgb * 255).toString(16).padStart(2, '0');
  }).join('');
}

function hexToLinear(hex: string): number[] {
  return [1, 3, 5].map(offset => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
}

/** Coalesce slider events; never race expensive displacement/pipeline rebuilds. */
export class MaterialParameterEditor {
  readonly #options: ParameterEditorOptions;
  #pending = new Map<string, readonly number[]>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running = false;
  #generation = 0;
  #reset: HTMLButtonElement | undefined;

  constructor(options: ParameterEditorOptions) { this.#options = options; }

  refresh(): void {
    clearTimeout(this.#timer);
    this.#pending.clear();
    this.#generation++;
    const { container, parameters } = this.#options;
    container.replaceChildren();
    const values = parameters();
    const note = document.createElement('p');
    note.textContent = values.length
      ? 'Entrées explicites et non liées du shader de surface. Couleurs numériques linéaires ; sélecteur couleur sRGB.'
      : 'Aucune entrée numérique explicite et non liée sur le shader de surface.';
    container.appendChild(note);
    if (!values.length) return;
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Réinitialiser les paramètres';
    reset.disabled = !values.some(parameter => parameter.value.some((value, i) => value !== parameter.initial[i]));
    reset.addEventListener('click', () => {
      clearTimeout(this.#timer);
      this.#pending.clear();
      for (const parameter of parameters()) {
        this.#pending.set(parameter.id, parameter.initial);
      }
      void this.#flush(true);
    });
    this.#reset = reset;
    container.appendChild(reset);
    const grid = document.createElement('div');
    grid.className = 'parameter-grid';
    values.forEach((parameter, index) => {
      const row = document.createElement('fieldset');
      row.className = 'parameter-row';
      row.dataset.parameter = parameter.id;
      const legend = document.createElement('legend');
      legend.textContent = parameter.label;
      row.appendChild(legend);
      const badge = document.createElement('small');
      badge.textContent = parameter.update === 'uniform' ? `${parameter.type} - En direct, recompilation si nécessaire` : `${parameter.type} - Recalcul après modification`;
      row.appendChild(badge);
      const controls = document.createElement('div');
      controls.className = 'parameter-values';
      let current = [...parameter.value];
      let slider: HTMLInputElement | undefined;
      let picker: HTMLInputElement | undefined;
      const numbers: HTMLInputElement[] = [];
      const sync = (): void => {
        numbers.forEach((input, i) => { input.value = String(current[i]); });
        if (picker) picker.value = linearToHex(current);
        if (slider) {
          slider.min = String(Math.min(Number(slider.min), current[0]!));
          slider.max = String(Math.max(Number(slider.max), current[0]!));
          slider.value = String(current[0]);
        }
      };
      const change = (): void => {
        if (!current.every(Number.isFinite)) return;
        this.#pending.set(parameter.id, [...current]);
        clearTimeout(this.#timer);
        this.#timer = setTimeout(() => { void this.#flush(); }, parameter.update === 'uniform' ? 0 : 180);
      };
      if (parameter.type === 'boolean') {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = current[0] === 1;
        checkbox.setAttribute('aria-label', parameter.label);
        checkbox.addEventListener('change', () => { current = [checkbox.checked ? 1 : 0]; change(); });
        controls.appendChild(checkbox);
      } else {
        if (parameter.type === 'float') {
          slider = document.createElement('input');
          slider.type = 'range';
          slider.min = String(Math.min(0, current[0]!));
          slider.max = String(Math.max(1, current[0]! * 2));
          slider.step = 'any';
          slider.setAttribute('aria-label', `${parameter.label} curseur`);
          slider.addEventListener('input', () => { current = [Number(slider!.value)]; sync(); change(); });
          controls.appendChild(slider);
        }
        if (parameter.type === 'color3') {
          picker = document.createElement('input');
          picker.type = 'color';
          picker.setAttribute('aria-label', `${parameter.label} couleur`);
          picker.addEventListener('input', () => { current = hexToLinear(picker!.value); sync(); change(); });
          controls.appendChild(picker);
        }
        current.forEach((_value, component) => {
          const input = document.createElement('input');
          input.type = 'number';
          input.step = parameter.type === 'integer' ? '1' : 'any';
          input.id = `parameter-${index}-${component}`;
          input.setAttribute('aria-label', `${parameter.label}${current.length > 1 ? ` ${component + 1}` : ''}`);
          input.addEventListener('input', () => {
            if (input.value === '' || !input.validity.valid) return;
            current[component] = input.valueAsNumber;
            if (picker) picker.value = linearToHex(current);
            if (slider) {
              slider.min = String(Math.min(Number(slider.min), current[0]!));
              slider.max = String(Math.max(Number(slider.max), current[0]!));
              slider.value = String(current[0]);
            }
            change();
          });
          input.addEventListener('change', () => {
            if (input.value === '' || !input.validity.valid) {
              current = [...(parameters().find(p => p.id === parameter.id)?.value ?? parameter.value)];
              sync();
              this.#options.error(new Error(`Valeur invalide : ${parameter.label}`));
            }
          });
          numbers.push(input);
          controls.appendChild(input);
        });
        sync();
      }
      row.appendChild(controls);
      grid.appendChild(row);
    });
    container.appendChild(grid);
  }

  async #flush(reset = false): Promise<void> {
    if (this.#running || this.#pending.size === 0) return;
    clearTimeout(this.#timer);
    const generation = this.#generation;
    const changes = this.#pending;
    this.#pending = new Map();
    this.#running = true;
    if (this.#reset) this.#reset.disabled = true;
    try {
      await this.#options.apply(changes);
      if (reset && generation === this.#generation) this.refresh();
      if (this.#reset) this.#reset.disabled = !this.#options.parameters().some(parameter =>
        parameter.value.some((value, i) => value !== parameter.initial[i]));
    } catch (error) {
      if (generation === this.#generation) this.refresh();
      this.#options.error(error);
    } finally {
      this.#running = false;
      if (this.#pending.size) void this.#flush();
    }
  }
}
