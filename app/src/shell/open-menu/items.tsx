// What the Open menu offers, as items for `Menu` and `MenuItems`: sidebar
// rows put these ahead of their own (Rename, Move to, …), every other
// surface shows just these.

import { linkFor } from "../../features/workspace/links";
import { useWorkspace } from "../../features/workspace/store";
import { noteAt } from "../../features/workspace/tree";
import { Icon, type IconName } from "../../ui/Icon";
import type { MenuItem } from "../Menu";
import type { OpenTarget } from "./store";
import { isDeckTarget, openAs, pathOf } from "./target";

const icon = (name: IconName) => <Icon name={name} className="size-4" />;

/** The text of a link to `target`, to paste into a page; null where there is none. */
export function linkText(target: OpenTarget): string | null {
  const path = pathOf(target);
  if (!path || path.startsWith("#")) return null;
  const { notes } = useWorkspace.getState();
  const note = noteAt(notes, path);
  if (note) return linkFor(note, notes);
  // A journal day nobody wrote in is still linked by its day.
  const day = /^journal\/\d{4}\/(\d{4}-\d{2}-\d{2})\.md$/.exec(path)?.[1];
  if (day) return `[[${day}]]`;
  // A diagram is shown in a page by an embed, named by its file.
  if (path.endsWith(".drawio")) return `![[${path.slice(path.lastIndexOf("/") + 1)}]]`;
  return /\.(canvas|deck|pdf)$/i.test(path) ? `[[${path}]]` : null;
}

/** Copies a link to `target` and says so. */
export function copyLink(target: OpenTarget): void {
  const text = linkText(target);
  if (!text) return;
  void navigator.clipboard?.writeText(text);
  useWorkspace.getState().toast("Link copied");
}

/** The Open menu's items for `target`: Open, in a new tab, to the right, in
 * a side or center peek, in the side stack, and Copy link. A deck has no
 * peek, and a place that is no page has no link. */
export function openItems(target: OpenTarget): (MenuItem | "divider")[] {
  const path = pathOf(target);
  const peeks = Boolean(path) && !isDeckTarget(target) && !path!.startsWith("#");
  return [
    { label: "Open", icon: icon("open"), onSelect: () => openAs(target, "here") },
    { label: "Open in new tab", icon: icon("external"), hint: "Ctrl+click", onSelect: () => openAs(target, "tab") },
    { label: "Open to the right", icon: icon("split"), hint: "Ctrl+Alt+click", onSelect: () => openAs(target, "right") },
    ...(peeks
      ? [
          { label: "Open in side peek", icon: icon("peek-side"), onSelect: () => openAs(target, "peek-side") },
          { label: "Open in center peek", icon: icon("peek-center"), onSelect: () => openAs(target, "peek-center") },
        ]
      : []),
    // The stack holds pages: a view has none to put there.
    ...(path ? [{ label: "Open in side stack", icon: icon("stack"), hint: "Shift+click", onSelect: () => openAs(target, "stack") }] : []),
    ...(linkText(target) !== null ? ["divider" as const, { label: "Copy link", icon: icon("link"), onSelect: () => copyLink(target) }] : []),
  ];
}
