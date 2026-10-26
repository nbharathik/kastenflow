// Up and Down move between the buttons of a list (the outline, the build's
// problems), so a list is one stop in the Tab order, not one stop per row.

import type { KeyboardEvent } from "react";

export function arrowFocus(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("button")];
  if (rows.length === 0) return;
  const at = rows.indexOf(document.activeElement as HTMLElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : Math.min(rows.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)));
  event.preventDefault();
  rows[next]?.focus();
}
