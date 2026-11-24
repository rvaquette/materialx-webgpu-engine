// Application layout: the activity bar on the left shows or hides the side panels (interactive
// render controls, script editor) and opens the material tools. Panel visibility is remembered.
import { icon, type IconName } from './icons.ts';

const LAYOUT_KEY = 'materialx-webgpu-engine.layout.v1';

export type PanelId = 'render' | 'script';

function readLayout(): Partial<Record<PanelId, boolean>> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}');
    return typeof value === 'object' && value !== null ? value as Partial<Record<PanelId, boolean>> : {};
  } catch {
    return {};
  }
}

/** Whether `panel` was visible when the page was last used (`fallback` the first time). */
export function panelVisible(panel: PanelId, fallback: boolean): boolean {
  return readLayout()[panel] ?? fallback;
}

export function rememberPanel(panel: PanelId, visible: boolean): void {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ ...readLayout(), [panel]: visible })); } catch { /* not remembered */ }
}

/** Turns a button of the activity bar into an icon button labelled `label`. */
export function activityButton(button: HTMLButtonElement, name: IconName, label: string): HTMLButtonElement {
  button.classList.add('activity');
  button.innerHTML = icon(name);
  button.title = label;
  button.setAttribute('aria-label', label);
  return button;
}

/**
 * Binds `button` to show or hide `panel` (pressed while visible); `shortcut` (e.g. "F3") toggles
 * it from anywhere on the page. Returns the toggle function.
 */
export function bindPanelToggle(
  button: HTMLButtonElement, panel: HTMLElement, id: PanelId, options: { defaultVisible: boolean; shortcut?: string },
): (visible?: boolean) => void {
  const toggle = (visible = panel.hidden): void => {
    panel.hidden = !visible;
    button.setAttribute('aria-pressed', String(visible));
    rememberPanel(id, visible);
  };
  toggle(panelVisible(id, options.defaultVisible));
  button.addEventListener('click', () => toggle());
  if (options.shortcut) {
    document.addEventListener('keydown', (event) => {
      if (event.key !== options.shortcut) return;
      event.preventDefault();
      toggle();
    });
  }
  return toggle;
}
