// Up and Down move between the buttons of a list (the outline, the build's
// problems), so a list is one stop in the Tab order, not one stop per row.
// A row may carry buttons of its own beside it (`data-aside`, such as "Fix this
// one"): Up and Down skip them, Right goes to the row's next button and Left
// comes back.

import type { KeyboardEvent } from "react";

export function arrowFocus(event: KeyboardEvent<HTMLElement>): void {
  const active = document.activeElement as HTMLElement | null;
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    const row = active?.closest("li");
    const group = row ? [...row.querySelectorAll<HTMLElement>("button")] : [];
    const at = active ? group.indexOf(active) : -1;
    const next = group[at + (event.key === "ArrowRight" ? 1 : -1)];
    if (at >= 0 && next) {
      event.preventDefault();
      next.focus();
    }
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not([data-aside])")];
  if (rows.length === 0) return;
  // From a row's own button, Up and Down start from the row.
  const from = active?.hasAttribute("data-aside") ? (active.closest("li")?.querySelector<HTMLElement>("button:not([data-aside])") ?? active) : active;
  const at = rows.indexOf(from as HTMLElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : Math.min(rows.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)));
  event.preventDefault();
  rows[next]?.focus();
}
