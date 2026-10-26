// The "+" at the end of a pane's tabs. A plain click makes a Home tab (in
// the pane to the right when "New tabs open to the right" is on), or another
// browser tab when the tab in front is one; the small arrow beside it and a
// right-click show the other ways to start one.

import { useRef, useState } from "react";

import { startNewBoard } from "../features/boards/store";
import { onBrowserTab, openWebTab } from "../features/browser/commands";
import { keyTitle } from "../features/shortcuts/store";
import { newItems } from "../plugins/contributions";
import { smartChoices } from "../features/smart/author/starter-list";
import { startNewDeck } from "../features/slides/store";
import { usePrefs } from "../features/workspace/prefs";
import { useWorkspace } from "../features/workspace/store";
import { Icon } from "../ui/Icon";
import type { MenuEntry } from "./Menu";
import { availableNav } from "./nav";
import { PointMenu } from "./PointMenu";

const icon = (name: Parameters<typeof Icon>[0]["name"]) => <Icon name={name} className="size-4" />;

/** What the "+" menu offers: pages and journal days in a new tab or to the
 * right, the Slides view, a new deck or whiteboard, the Graph, and the
 * switch that sends a plain "+" to the right. */
export function newTabItems(): MenuEntry[] {
  const ws = useWorkspace.getState();
  const prefs = usePrefs.getState();
  return [
    { label: "New page", icon: icon("compose"), onSelect: () => ws.newPage({}, "tab") },
    { label: "New page to the right", icon: icon("split"), onSelect: () => ws.newPage({}, "right") },
    "divider",
    { label: "Today's journal", icon: icon("journal"), onSelect: () => void ws.openJournal(undefined, "tab") },
    { label: "Journal to the right", icon: icon("split"), onSelect: () => void ws.openJournal(undefined, "right") },
    "divider",
    { label: "Slides", icon: icon("present"), onSelect: () => ws.go({ view: "slides" }, "tab") },
    { label: "New deck", icon: icon("present"), onSelect: () => startNewDeck(null, "tab") },
    { label: "New whiteboard", icon: icon("board"), onSelect: () => startNewBoard(null, "tab") },
    { label: "New smart page", icon: icon("code"), submenu: smartChoices().map((choice) => ({ label: choice.label, icon: icon(choice.icon), onSelect: choice.run })) },
    // Views that are not there yet stay off the menu (the registry says which are).
    ...(availableNav().some((item) => item.id === "graph") ? [{ label: "Graph", icon: icon("graph"), onSelect: () => ws.go({ view: "graph" }, "tab") }] : []),
    ...(availableNav().some((item) => item.id === "browser") ? [{ label: "Browser", icon: icon("globe"), onSelect: () => ws.go({ view: "web" }, "tab") }] : []),
    // What plugins start, after the app's own.
    ...newItems().map((item) => ({ label: item.label, icon: icon(item.icon), onSelect: item.run })),
    "divider",
    { label: "New tabs open to the right", checked: prefs.plusOpensRight, onSelect: () => prefs.set({ plusOpensRight: !prefs.plusOpensRight }) },
  ];
}

export function NewTabButton() {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const more = useRef<HTMLButtonElement>(null);
  const ws = useWorkspace.getState();
  return (
    <>
      <button
        type="button"
        aria-label="New tab"
        title={keyTitle("New tab", "new-tab")}
        className="kasten-tab-new"
        onClick={() => {
          // Beside a browser tab, the "+" makes another browser tab, as Ctrl+T does.
          if (onBrowserTab()) openWebTab();
          else if (usePrefs.getState().plusOpensRight) ws.openRight({ view: "home" });
          else ws.openTab({ view: "home" });
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <Icon name="plus" className="size-4" />
      </button>
      <button
        ref={more}
        type="button"
        aria-label="More ways to start a tab"
        title="More ways to start a tab"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        className="kasten-tab-new-more"
        onClick={() => {
          const box = more.current?.getBoundingClientRect();
          setMenu(menu ? null : { x: box?.left ?? 0, y: (box?.bottom ?? 0) + 4 });
        }}
      >
        <Icon name="chevron-down" className="size-3" />
      </button>
      {menu && <PointMenu x={menu.x} y={menu.y} label="New tab" items={newTabItems()} anchor={more} onClose={() => setMenu(null)} />}
    </>
  );
}
