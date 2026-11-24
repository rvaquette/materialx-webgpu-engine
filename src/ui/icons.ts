// Inline SVG icons (24×24, stroked with currentColor) for icon buttons of the editor and the
// remote render view. Each button keeps a text label in `title` and `aria-label`.

const PATHS = {
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>',
  bug: '<path d="M8 9h8v5a4 4 0 0 1-8 0zM9 9V7a3 3 0 0 1 6 0v2M4 13h4M16 13h4M5 8l3 2M19 8l-3 2M5 19l3-2M19 19l-3-2M12 11v7"/>',
  stepOver: '<path d="M4 15a8 8 0 0 1 15-4"/><path d="M20 6v5h-5"/><circle cx="12" cy="19" r="1.6" fill="currentColor"/>',
  resume: '<path d="M5 5v14"/><path d="M9 5v14l10-7z" fill="currentColor"/>',
  wand: '<path d="M4 20 15 9M14 4v3M19 9h-3M17 5l-2 2M18 13l-1-1M10 5l1 1"/>',
  toXml: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>',
  fromXml: '<path d="M4 6h10M4 12h16M4 18h12"/><path d="m17 3 3 3-3 3"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/><path d="M12 11v6M9.5 14.5 12 17l2.5-2.5"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  link: '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1"/><path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>',
  template: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 10v10"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  graph: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M8.5 7l7 4M8.5 17l7-4"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  code: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m8 10-2 2 2 2M16 10l2 2-2 2M13 9l-2 6"/>',
  book: '<path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10"/><circle cx="11" cy="8.5" r="2" fill="currentColor"/>',
  pulse: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  minimize: '<path d="M5 18h14"/>',
  maximize: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
  restore: '<rect x="4" y="8" width="12" height="12" rx="2"/><path d="M8 8V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-3"/>',
  float: '<rect x="3" y="9" width="12" height="11" rx="2"/><path d="M9 9V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-5"/>',
  dock: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName): string {
  return `<svg class="mx-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}

/**
 * HTML of an icon button; `label` is its accessible name and tooltip, `caption` the short text
 * shown under the icon.
 */
export function iconButton(name: IconName, label: string, attributes: Record<string, string> = {}, caption?: string): string {
  const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const { class: extraClass, ...rest } = attributes;
  const extra = Object.entries(rest).map(([key, value]) => ` ${key}="${escape(value)}"`).join('');
  const classes = `mx-icon-button${caption ? ' with-caption' : ''}${extraClass ? ` ${escape(extraClass)}` : ''}`;
  return `<button type="button" class="${classes}" title="${escape(label)}" aria-label="${escape(label)}"${extra}>${icon(name)}` +
    `${caption ? `<span class="mx-icon-caption" aria-hidden="true">${escape(caption)}</span>` : ''}</button>`;
}

/** Changes the icon, label and caption of an icon button (e.g. pause ↔ resume). */
export function setIconButton(button: HTMLButtonElement, name: IconName, label: string, caption?: string): void {
  const current = button.querySelector('.mx-icon-caption')?.textContent ?? undefined;
  const text = caption ?? current;
  button.innerHTML = icon(name);
  if (text !== undefined) {
    button.classList.add('with-caption');
    button.append(Object.assign(document.createElement('span'), { className: 'mx-icon-caption', textContent: text }));
    button.lastElementChild!.setAttribute('aria-hidden', 'true');
  }
  button.title = label;
  button.setAttribute('aria-label', label);
}

export const ICON_BUTTON_STYLE = `
.mx-icon-button { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 28px; padding: 0;
  background: #333; color: #eee; border: 1px solid #555; border-radius: 8px; cursor: pointer;
  transition: background-color 0.12s, border-color 0.12s, transform 0.06s; }
.mx-icon-button:active:not(:disabled) { transform: translateY(1px); }
.mx-icon-button.with-caption { flex-direction: column; gap: 1px; width: auto; min-width: 42px; height: auto; padding: 4px 6px; border-radius: 10px; }
.mx-icon-caption { font: 10px/1.15 system-ui, sans-serif; white-space: nowrap; }
.mx-icon-button:hover:not(:disabled) { background: #444; border-color: #6a6a78; }
.mx-icon-button:disabled { opacity: 0.4; cursor: default; }
.mx-icon-button:focus-visible { outline: 2px solid #4fc1ff; outline-offset: 1px; }
.mx-icon-button.primary { background: #0e639c; border-color: #1177bb; }
.mx-icon-button.danger { color: #f48771; }
.mx-icon-button[hidden] { display: none; }
`;
