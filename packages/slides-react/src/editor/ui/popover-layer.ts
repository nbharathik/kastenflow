// Where popovers are drawn: one layer on the page's body, outside every container that could clip or reposition a fixed box. A page
// that makes a container of a pane or a bar (a container query, a transform) turns that element into the frame for the fixed boxes
// inside it, so a menu placed by window coordinates would land shifted and be cut off. In the layer it never does.
//
// Outside the editor, a popover loses the colours and settings the editor gave it, so they are copied onto it when it opens.

/** The look the editor's host sets on the editor (or on a scope such as the link menu's): copied onto a popover drawn in the layer. */
const TOKENS = [
  "--ks-canvas",
  "--ks-raised",
  "--ks-panel",
  "--ks-well",
  "--ks-ink",
  "--ks-muted",
  "--ks-faint",
  "--ks-line",
  "--ks-line-strong",
  "--ks-accent",
  "--ks-on-accent",
  "--ks-danger",
  "--ks-success",
  "--ks-warning",
  "--ks-favourite",
  "--ks-agent",
  "--ks-on-agent",
  "--ks-hover",
  "--ks-selected",
  "--ks-pressed",
  "--ks-soft",
  "--ks-scrim",
  "--ks-shadow-pop",
  "--ks-shadow-page",
  "--ks-radius",
  "--ks-radius-md",
  "--ks-radius-lg",
  "--ks-font",
  "--ks-mono",
  "--ks-fast",
  "--ks-base",
  "--ks-slow",
  "--ks-ease",
  "--ks-bar",
  "--ks-control",
] as const;

/** The attributes the stylesheets key on (the theme and the density), taken from the nearest element that names them. */
const ATTRIBUTES = ["data-theme", "data-density"] as const;

const LAYER = "ks-popover-layer";

/** The one layer popovers are drawn in, made when the first one opens. */
export function popoverLayer(): HTMLElement {
  const found = document.body.querySelector<HTMLElement>(`:scope > .${LAYER}`);
  if (found) return found;
  const layer = document.createElement("div");
  layer.className = LAYER;
  document.body.append(layer);
  return layer;
}

/** Gives `scope` the look of the place the popover was opened from (`from`): its colours, fonts, motion, theme and density. */
export function wearLookOf(scope: HTMLElement, from: Element | null): void {
  if (!from) return;
  const computed = getComputedStyle(from);
  for (const name of TOKENS) {
    const value = computed.getPropertyValue(name).trim();
    if (value) scope.style.setProperty(name, value);
  }
  if (computed.colorScheme) scope.style.colorScheme = computed.colorScheme;
  for (const name of ATTRIBUTES) {
    const named = from.closest(`[${name}]`)?.getAttribute(name);
    if (named) scope.setAttribute(name, named);
    else scope.removeAttribute(name);
  }
}
