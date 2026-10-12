// A small way to build the popup's elements: a tag, its attributes and what is
// inside. Attributes that are functions are listeners (`onclick`), a few names
// are properties (`value`, `checked`, `disabled`), the rest are attributes.

export type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

const PROPERTIES = new Set(["value", "checked", "disabled", "selected", "hidden", "required", "readOnly"]);

/** Puts `children` in `root` in place of what it held; empty ones are left out. */
export function fill(root: HTMLElement, ...children: Child[]): void {
  root.replaceChildren(...children.filter((child): child is Node | string => child !== null && child !== undefined && child !== false));
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    if (typeof value === "function") el.addEventListener(key.replace(/^on/, ""), value);
    else if (key === "class") el.className = String(value);
    else if (PROPERTIES.has(key)) (el as unknown as Record<string, unknown>)[key] = value;
    else if (value !== false) el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}
