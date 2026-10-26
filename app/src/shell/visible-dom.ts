/** Document-wide lookups must skip a tab kept ready (see KeepAlive): React's
 * Activity hides it with display none, but its elements stay in the document. */

/** Whether the element is shown: it and its ancestors are not display none or hidden. */
export function isShown(el: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node instanceof HTMLElement && node.hidden) return false;
    if (getComputedStyle(node).display === "none") return false;
  }
  return true;
}

/** The first match of the selector that is shown (a hidden kept tab is skipped). */
export function firstVisible<E extends Element = Element>(selector: string, root: ParentNode = document): E | null {
  for (const el of root.querySelectorAll<E>(selector)) if (isShown(el)) return el;
  return null;
}
