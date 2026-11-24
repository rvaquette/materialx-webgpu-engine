// Dockable workbench (dockview-core): the render view, render controls, script editor and material
// graph are panels that can be docked by dragging their tab, floated, maximized, resized with the
// sashes, and minimized (removed from the layout, restored from the activity bar). The layout is
// remembered between visits.
import { createDockview, themeAbyss } from 'dockview-core/dist/dockview-core.js';
import type {
  DockviewApi, DockviewGroupPanel, IContentRenderer, IDockviewPanel, IHeaderActionsRenderer, SerializedDockview,
} from 'dockview-core';
import { icon, type IconName } from './icons.ts';

const LAYOUT_KEY = 'materialx-webgpu-engine.workbench.v1';

export interface PanelPlacement {
  /** Side of `reference` (the render view by default) where the panel opens. */
  direction: 'left' | 'right' | 'above' | 'below' | 'within';
  reference?: string;
  /** Initial width (left/right) or height (above/below) in pixels. */
  size?: number;
}

export interface WorkbenchPanel {
  id: string;
  title: string;
  /** The panel content, created when the panel first opens. */
  create(): HTMLElement | Promise<HTMLElement>;
  placement: PanelPlacement;
  /** Shown in the default layout. */
  visible?: boolean;
}

const STYLE = `
#workbench { position: relative; flex: 1; min-width: 0; min-height: 0; }
#workbench .dv-dockview { --dv-background-color: #101014; --dv-group-view-background-color: #14141b;
  --dv-tabs-and-actions-container-background-color: #18181f; --dv-activegroup-visiblepanel-tab-background-color: #22222c;
  --dv-tabs-and-actions-container-font-size: 12px; }
.mx-workbench-content { position: relative; width: 100%; height: 100%; display: flex; overflow: hidden; }
.mx-workbench-content > * { flex: 1; min-width: 0; min-height: 0; }
.mx-workbench-actions { display: flex; align-items: center; gap: 2px; height: 100%; padding: 0 4px; }
.mx-workbench-actions button { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 22px;
  padding: 0; color: #a8a8b8; background: none; border: 0; border-radius: 6px; cursor: pointer; }
.mx-workbench-actions button:hover { color: #fff; background: #2c2c38; }
.mx-workbench-actions svg { width: 15px; height: 15px; }
`;

class PanelContent implements IContentRenderer {
  readonly element = Object.assign(document.createElement('div'), { className: 'mx-workbench-content' });

  constructor(content: Promise<HTMLElement>) {
    void content.then(child => this.element.append(child));
  }

  init(): void {}
}

/** Header buttons of a group: minimize, float / dock, maximize / restore. */
class GroupActions implements IHeaderActionsRenderer {
  readonly element = Object.assign(document.createElement('div'), { className: 'mx-workbench-actions' });
  readonly #group: DockviewGroupPanel;
  readonly #workbench: Workbench;
  readonly #disposables: { dispose(): void }[] = [];

  constructor(group: DockviewGroupPanel, workbench: Workbench) {
    this.#group = group;
    this.#workbench = workbench;
  }

  init(): void {
    const render = (): void => this.#render();
    this.#disposables.push(this.#group.api.onDidLocationChange(render), this.#workbench.api.onDidMaximizedGroupChange(render));
    render();
  }

  #button(name: IconName, label: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = icon(name);
    button.title = label;
    button.setAttribute('aria-label', label);
    button.addEventListener('pointerdown', event => event.stopPropagation());
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      action();
    });
    return button;
  }

  #render(): void {
    const group = this.#group;
    const active = (): IDockviewPanel | undefined => group.activePanel;
    const floating = group.api.location.type === 'floating';
    const maximized = group.api.isMaximized();
    this.element.replaceChildren(
      this.#button('minimize', 'Réduire : masquer le panneau (le rouvrir depuis la barre latérale)', () => {
        const panel = active();
        if (panel) this.#workbench.hide(panel.id);
      }),
      this.#button(floating ? 'dock' : 'float', floating ? 'Ancrer le panneau' : 'Détacher en fenêtre flottante', () => {
        const panel = active();
        if (!panel) return;
        if (floating) group.api.moveTo({ position: 'right' });
        else this.#workbench.api.addFloatingGroup(panel, { width: 640, height: 480, position: { top: 60, left: 120 } });
      }),
      this.#button(maximized ? 'restore' : 'maximize', maximized ? 'Restaurer' : 'Agrandir', () => {
        if (maximized) this.#workbench.api.exitMaximizedGroup();
        else {
          const panel = active();
          if (panel) this.#workbench.api.maximizeGroup(panel);
        }
      }),
    );
    // A floating group cannot be maximized.
    if (floating) this.element.lastElementChild!.remove();
  }

  dispose(): void {
    for (const disposable of this.#disposables) disposable.dispose();
  }
}

export class Workbench {
  readonly api: DockviewApi;
  readonly #panels = new Map<string, WorkbenchPanel>();
  readonly #contents = new Map<string, Promise<HTMLElement>>();
  readonly #listeners = new Set<(id: string, visible: boolean) => void>();
  #saveTimer: ReturnType<typeof setTimeout> | undefined;
  #restoring = false;

  constructor(host: HTMLElement, panels: readonly WorkbenchPanel[]) {
    if (!document.getElementById('mx-workbench-style')) {
      document.head.append(Object.assign(document.createElement('style'), { id: 'mx-workbench-style', textContent: STYLE }));
    }
    for (const panel of panels) this.#panels.set(panel.id, panel);
    this.api = createDockview(host, {
      theme: themeAbyss,
      createComponent: ({ name }) => new PanelContent(this.#content(name)),
      createRightHeaderActionComponent: group => new GroupActions(group, this),
      getTabContextMenuItems: () => ['maximize', 'float', 'separator', 'close'],
    });
    this.api.onDidAddPanel(panel => this.#notify(panel.id, true));
    this.api.onDidRemovePanel(panel => this.#notify(panel.id, false));
    this.api.onDidLayoutChange(() => this.#save());
    if (!this.#restore()) {
      for (const panel of panels) if (panel.visible) this.show(panel.id, false);
    }
  }

  /** Adds a panel spec after creation (e.g. a lazily attached editor). */
  register(panel: WorkbenchPanel): void {
    this.#panels.set(panel.id, panel);
    this.#waiting.get(panel.id)?.(panel);
    this.#waiting.delete(panel.id);
    if (this.#pending.has(panel.id)) {
      this.#pending.delete(panel.id);
      this.show(panel.id, false);
    }
  }

  /** Panels of a restored layout whose spec is registered later. */
  readonly #pending = new Set<string>();

  isVisible(id: string): boolean {
    return this.api.getPanel(id) !== undefined;
  }

  show(id: string, focus = true): void {
    const existing = this.api.getPanel(id);
    if (existing) {
      if (focus) existing.api.setActive();
      return;
    }
    const spec = this.#panels.get(id);
    if (!spec) {
      this.#pending.add(id);
      return;
    }
    const { direction, reference = 'view', size } = spec.placement;
    const anchor = reference !== id ? this.api.getPanel(reference) : undefined;
    const sized = size === undefined ? {} : direction === 'left' || direction === 'right' ? { initialWidth: size } : { initialHeight: size };
    this.api.addPanel({
      id, component: id, title: spec.title,
      ...(anchor ? { position: { referencePanel: anchor, direction } } : {}),
      ...sized,
      inactive: !focus,
    });
  }

  hide(id: string): void {
    const panel = this.api.getPanel(id);
    if (panel) this.api.removePanel(panel);
  }

  toggle(id: string): void {
    if (this.isVisible(id)) this.hide(id);
    else this.show(id);
  }

  onVisibilityChange(listener: (id: string, visible: boolean) => void): void {
    this.#listeners.add(listener);
  }

  #content(id: string): Promise<HTMLElement> {
    let content = this.#contents.get(id);
    if (!content) {
      const spec = this.#panels.get(id);
      // A restored panel whose spec is registered later waits for it.
      content = spec ? Promise.resolve(spec.create())
        : new Promise<WorkbenchPanel>((resolve) => { this.#waiting.set(id, resolve); }).then(registered => registered.create());
      this.#contents.set(id, content);
    }
    return content;
  }

  readonly #waiting = new Map<string, (panel: WorkbenchPanel) => void>();

  #notify(id: string, visible: boolean): void {
    for (const listener of this.#listeners) listener(id, visible);
  }

  #save(): void {
    if (this.#restoring) return;
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.api.toJSON())); } catch { /* not remembered */ }
    }, 300);
  }

  /** The layout of the last visit, when it is valid and has the render view. */
  #restore(): boolean {
    let layout: SerializedDockview | undefined;
    try { layout = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null') as SerializedDockview | undefined; } catch { layout = undefined; }
    if (!layout?.panels?.view) return false;
    this.#restoring = true;
    try {
      this.api.fromJSON(layout);
      return true;
    } catch {
      this.api.clear();
      return false;
    } finally {
      this.#restoring = false;
    }
  }
}
