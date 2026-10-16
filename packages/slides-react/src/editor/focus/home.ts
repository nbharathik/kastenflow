// Where the keys go when nothing has the focus. The editor's shortcuts (Delete, Ctrl+Z, copy and paste) are heard where the focus is
// inside it, so the moment the focus falls to the page (a menu that closed, a dialog whose opener is gone, a window that was left and
// came back) they are dead until something is clicked. Every place that gives the focus back goes through here: it returns it to
// where it was if that place can still take it, and to the editor's home otherwise.

/** What takes the keys for the view shown, in the order they are looked for: the slide, the grid of slides, the outline. */
const HOMES = [".ks-stage", ".ks-grid-view", ".ks-outline-view"] as const;
/** The editor itself. */
export const EDITOR = ".ks-editor";

/** The editors that are shown, the one used last at the end (an editor can hold another: the layout designer is one). */
const editors: HTMLElement[] = [];

/** The editor that was shown or used last: where the focus goes when a place has no editor of its own to name. */
export function lastEditorRoot(): HTMLElement | null {
  return [...editors].reverse().find((root) => root.isConnected) ?? null;
}

/** Notes that this editor is the one in use (it was mounted, or something in it took the focus). */
export function noteEditor(root: HTMLElement | null): void {
  if (!root) return;
  const at = editors.indexOf(root);
  if (at >= 0) editors.splice(at, 1);
  editors.push(root);
}

/** Forgets an editor that is going away; the one used before it is the last again. */
export function forgetEditor(root: HTMLElement | null): void {
  const at = root ? editors.indexOf(root) : -1;
  if (at >= 0) editors.splice(at, 1);
}

/** The editor an element is in. */
export const editorOf = (element: Element | null | undefined): HTMLElement | null => element?.closest<HTMLElement>(EDITOR) ?? null;

/** Whether the page has no real focus: it is on the body, or on nothing. */
export function focusIsLost(): boolean {
  const now = document.activeElement;
  return now === null || now === document.body || now === document.documentElement || !now.isConnected;
}

/** Whether the element can be given the focus now: it is on the page, it is not the page itself, and nothing inert is round it. */
export function canTakeFocus(element: Element | null | undefined): element is HTMLElement {
  return element instanceof HTMLElement && element.isConnected && element !== document.body && element !== document.documentElement && !element.closest("[inert]");
}

/** The place in an editor that takes the keys for the view it shows; the editor itself (it can take the focus) when no view has one. */
export function homeOf(root: HTMLElement | null = lastEditorRoot()): HTMLElement | null {
  if (!root?.isConnected) return null;
  const main = root.querySelector<HTMLElement>(".ks-center") ?? root;
  for (const selector of HOMES) {
    const found = main.querySelector<HTMLElement>(selector);
    if (found) return found;
  }
  return root;
}

/** Gives the focus to the editor's home. Answers whether the focus is there now. */
export function focusHome(root: HTMLElement | null = lastEditorRoot()): boolean {
  const home = homeOf(root);
  if (!canTakeFocus(home)) return false;
  if (document.activeElement !== home) home.focus({ preventScroll: true });
  return document.activeElement === home;
}

/**
 * Gives the focus back after something that had taken it is gone (a dialog, a menu). To `before` when that can still take it, else to
 * the editor's home. Not when something else has the focus by now (a field the closing asked for, a text box): that was on purpose.
 */
export function giveFocusBack(before: Element | null | undefined, root: HTMLElement | null): void {
  if (!focusIsLost()) return;
  if (canTakeFocus(before)) {
    before.focus({ preventScroll: true });
    if (document.activeElement === before) return;
  }
  focusHome(root ?? editorOf(before) ?? lastEditorRoot());
}

/** What had the focus a moment ago, as something to give it back to: not the page, which is where it falls when nothing has it. */
export function focusedNow(): HTMLElement | null {
  const now = document.activeElement;
  return now instanceof HTMLElement && now !== document.body && now !== document.documentElement ? now : null;
}
