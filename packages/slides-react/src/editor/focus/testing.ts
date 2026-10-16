// Helpers for the tests of where the focus is. A failed comparison of two elements prints the whole page; these say in a few words where the
// focus is instead.

import { expect } from "vitest";

/** An element in a few words: its tag, id and classes. */
export function describeNode(node: Element | null): string {
  if (node === null) return "nothing";
  if (node === document.body) return "the page (body)";
  const id = node.id ? `#${node.id}` : "";
  const classes = typeof node.className === "string" && node.className.trim() !== "" ? `.${node.className.trim().split(/\s+/).join(".")}` : "";
  const name = node.getAttribute("aria-label");
  return `${node.tagName.toLowerCase()}${id}${classes}${name ? ` "${name}"` : ""}`;
}

/** The focus is on this element. */
export function expectFocusOn(element: Element | null): void {
  expect(document.activeElement === element, `the focus is on ${describeNode(document.activeElement)}, not on ${describeNode(element)}`).toBe(true);
}

/** The focus is on something inside this element (or on it). */
export function expectFocusIn(root: Element | null): void {
  const now = document.activeElement;
  expect(root !== null && now !== null && root.contains(now), `the focus is on ${describeNode(now)}, outside ${describeNode(root)}`).toBe(true);
}
