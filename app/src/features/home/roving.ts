// Arrow keys inside a Home card: Up and Down move between its rows, Home and
// End go to the first and last. A row's main control carries `data-rove`.
// Tab still walks every control, and a field that is being typed in keeps
// its arrow keys.

import type { KeyboardEvent } from "react";

/** The rows of the card that can be reached: not in a folded part, not disabled. */
export function rovers(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[data-rove]")].filter((el) => !el.closest("[inert]") && !(el as HTMLButtonElement).disabled);
}

export function roveKeys(event: KeyboardEvent<HTMLElement>): void {
  const target = event.target as HTMLElement;
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (target.matches("input:not([type='checkbox']), textarea, select, [contenteditable='true']")) return;
  // A row of side-by-side controls (the week) answers to Left and Right instead.
  const [next, prev] = event.currentTarget.hasAttribute("data-rove-across") ? ["ArrowRight", "ArrowLeft"] : ["ArrowDown", "ArrowUp"];
  const key = event.key;
  if (key !== next && key !== prev && key !== "Home" && key !== "End") return;
  const here = target.closest<HTMLElement>("[data-rove]");
  if (!here) return;
  const all = rovers(event.currentTarget);
  const at = all.indexOf(here);
  if (at < 0) return;
  const to = key === "Home" ? 0 : key === "End" ? all.length - 1 : Math.min(all.length - 1, Math.max(0, at + (key === next ? 1 : -1)));
  event.preventDefault();
  all[to]?.focus();
}
