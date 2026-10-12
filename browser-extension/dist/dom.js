// A small way to build the popup's elements: a tag, its attributes and what is
// inside. Attributes that are functions are listeners (`onclick`), a few names
// are properties (`value`, `checked`, `disabled`), the rest are attributes.
const PROPERTIES = new Set(["value", "checked", "disabled", "selected", "hidden", "required", "readOnly"]);
/** Puts `children` in `root` in place of what it held; empty ones are left out. */
export function fill(root, ...children) {
    root.replaceChildren(...children.filter((child) => child !== null && child !== undefined && child !== false));
}
export function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined)
            continue;
        if (typeof value === "function")
            el.addEventListener(key.replace(/^on/, ""), value);
        else if (key === "class")
            el.className = String(value);
        else if (PROPERTIES.has(key))
            el[key] = value;
        else if (value !== false)
            el.setAttribute(key, value === true ? "" : String(value));
    }
    for (const child of children) {
        if (child === null || child === undefined || child === false)
            continue;
        el.append(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return el;
}
