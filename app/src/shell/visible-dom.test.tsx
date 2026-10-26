// Lookups across the document pass over a tab kept ready (hidden by Activity):
// each site is tried with two kept pages in one focused pane, the hidden one first.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Activity, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { captureCard } from "../features/workspace/overlays/commands";
import { PAGE_COMMANDS } from "../features/workspace/overlays/page-commands";
import { usePrefs } from "../features/workspace/prefs";
import { useWorkspace } from "../features/workspace/store";
import { derive } from "../features/workspace/store-layout";
import { initialLayout } from "../features/workspace/tabs";
import { useFindKeys } from "../features/pages/editor/find/FindBar";
import { useShell } from "../lib/store";
import type { NoteMeta } from "../lib/vault/types";
import { OpenMenuHost } from "./open-menu";
import { Sidebar } from "./Sidebar";
import { firstVisible, isShown } from "./visible-dom";

afterEach(cleanup);

/** Two kept pages in the focused pane: "old" hidden (first in the document), "now" shown. */
function Kept({ children }: { children: (id: string) => React.ReactNode }) {
  return (
    <div className="kasten-pane is-focused">
      <Activity mode="hidden">
        <div data-testid="old">{children("old")}</div>
      </Activity>
      <Activity mode="visible">
        <div data-testid="now">{children("now")}</div>
      </Activity>
    </div>
  );
}

describe("firstVisible", () => {
  it("skips a hidden kept tab and finds the shown one", () => {
    render(<Kept>{(id) => <p className="mark" data-id={id} />}</Kept>);
    expect(isShown(screen.getByTestId("old"))).toBe(false);
    expect(isShown(screen.getByTestId("now"))).toBe(true);
    expect(document.querySelector(".mark")?.getAttribute("data-id")).toBe("old");
    expect(firstVisible(".mark")?.getAttribute("data-id")).toBe("now");
    expect(firstVisible(".missing")).toBeNull();
  });
});

describe("rename and quick note commands", () => {
  const title = (id: string) => <textarea className="kasten-page-title" aria-label={`Title ${id}`} defaultValue="t" />;

  it("rename focuses the title of the shown page", () => {
    render(<Kept>{title}</Kept>);
    PAGE_COMMANDS.find((c) => c.id === "rename-page")!.run();
    expect(document.activeElement).toBe(screen.getByLabelText("Title now"));
  });

  it("a quick note goes into the shown capture box", () => {
    render(<Kept>{(id) => <textarea data-capture-box aria-label={`Capture ${id}`} />}</Kept>);
    captureCard();
    expect(document.activeElement).toBe(screen.getByLabelText("Capture now"));
  });
});

describe("find keys", () => {
  function Page({ id, open }: { id: string; open: (id: string) => void }) {
    const root = useRef<HTMLDivElement>(null);
    const crepe = useRef({ editor: { ctx: { get: () => ({ state: { doc: { textBetween: () => "" }, selection: { from: 0, to: 0 } } }) } } });
    useFindKeys(root, crepe as never, () => open(id));
    return (
      <div className="kasten-page-editor" data-id={id} ref={root}>
        text
      </div>
    );
  }

  it("opens on the shown page and not on the hidden one before it", () => {
    const opened: string[] = [];
    render(<Kept>{(id) => <Page id={id} open={(who) => opened.push(who)} />}</Kept>);
    fireEvent.keyDown(document.body, { key: "f", code: "KeyF", ctrlKey: true });
    expect(opened).toEqual(["now"]);
  });
});

describe("sidebar rename", () => {
  const note = (path: string): NoteMeta => ({
    path, id: null, title: "Loose beta", kind: "page", icon: null, cover: null, parent: null, project: null, tags: [], modified: 0,
    created: null, updated: null, excerpt: "", words: 0, props: {}, locked: false,
  });

  beforeEach(() => {
    localStorage.clear();
    usePrefs.setState({ foldedSections: [], favourites: [], pinnedPages: [], pinnedProjects: [] });
    useShell.setState({ sidebarOpen: true });
    useWorkspace.setState({ client: null, ready: true, notes: [note("library/Loose beta.md")], ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  });

  it("renames the open page from the shown title field", () => {
    act(() => useWorkspace.getState().openPath("library/Loose beta.md"));
    render(
      <>
        <Sidebar />
        <OpenMenuHost />
        <Kept>{(id) => <textarea aria-label="Page title" data-id={id} defaultValue="Loose beta" />}</Kept>
      </>,
    );
    const nav = screen.getByRole("navigation", { name: "Sidebar" });
    fireEvent.click(within(nav).getByRole("button", { name: "More for Loose beta" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Rename/ }));
    expect(document.activeElement?.getAttribute("data-id")).toBe("now");
  });
});
