// The small tools in the head of an embedded page, whiteboard or database
// ("open it", "present it"): icons, not words. Each has a name for screen readers
// and a tooltip, is an ordinary button so the keyboard reaches it, and shows
// when the embed is pointed at, holds the focus or is being worked on
// (embed-tools.css).

import "./embed-tools.css";

import { el, withGlyph } from "../ui/dom";

/** An icon button for an embed's head. `className` is the tool's own class (what the embed finds it by). */
export function embedTool(className: string, icon: string, label: string, title: string = label): HTMLButtonElement {
  const button = withGlyph(el("button", `kasten-embed-tool ${className}`, { type: "button", title }), icon, 14);
  button.setAttribute("aria-label", label);
  return button;
}
