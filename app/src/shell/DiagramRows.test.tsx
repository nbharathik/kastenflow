// A project's diagrams in the sidebar, under its whiteboards and decks, and a
// starred diagram under Favourites: a row opens it in a tab named after it.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useDiagrams } from "../features/diagrams/store";
import { NOTE_DRAG } from "../features/workspace/drag";
import { usePrefs } from "../features/workspace/prefs";
import { useWorkspace } from "../features/workspace/store";
import { derive } from "../features/workspace/store-layout";
import { initialLayout } from "../features/workspace/tabs";
import { FavouriteDiagrams, ProjectDiagrams } from "./DiagramRows";

const FLOW = "projects/demo/diagrams/login-flow.drawio";
const info = (path: string, title: string, project: string | null) => ({ path, title, project, pages: 1, modified: 1, size: 1, preview: "fresh" as const, problem: null });

beforeEach(() => {
  localStorage.clear();
  usePrefs.setState({ favourites: [] });
  useDiagrams.setState({ list: [info(FLOW, "Login flow", "demo"), info("projects/other/diagrams/map.drawio", "Map", "other"), info("library/loose.drawio", "Loose", null)], loaded: true });
  useWorkspace.setState({ client: null, notes: [], ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
});
afterEach(cleanup);

/** A DataTransfer good enough for dragstart in jsdom. */
function transfer() {
  const data = new Map<string, string>();
  return { data, types: [] as string[], effectAllowed: "", setData: (type: string, value: string) => void data.set(type, value), getData: (type: string) => data.get(type) ?? "" };
}

describe("diagrams in the sidebar", () => {
  it("lists a project's diagrams, and only that project's", () => {
    render(
      <ul>
        <ProjectDiagrams project="demo" depth={1} />
      </ul>,
    );
    // The row, and its "…" menu (named, hidden until the row is pointed at).
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual(["Login flow", "More for Login flow"]);
    expect(screen.getByRole("button", { name: "Login flow" }).getAttribute("title")).toBe("Login flow (diagram)");
  });

  it("opens a diagram in a tab named after it, and marks the row of the one that is open", async () => {
    render(
      <ul>
        <ProjectDiagrams project="demo" depth={1} />
      </ul>,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Login flow" })));
    expect(useWorkspace.getState().place).toEqual({ view: "diagrams", path: FLOW });
    expect(screen.getByRole("button", { name: "Login flow" }).getAttribute("aria-current")).toBe("page");
  });

  it("drags as a note, so it can be dropped on a board", () => {
    render(
      <ul>
        <ProjectDiagrams project="demo" depth={1} />
      </ul>,
    );
    const row = screen.getByRole("button", { name: "Login flow" }).closest("[draggable]")!;
    const drag = transfer();
    fireEvent.dragStart(row, { dataTransfer: drag });
    expect(drag.data.get(NOTE_DRAG)).toBe(FLOW);
  });

  it("has a menu with Favourites, the open choices and the trash, named after the diagram", async () => {
    render(
      <ul>
        <ProjectDiagrams project="demo" depth={1} />
      </ul>,
    );
    fireEvent.click(screen.getByRole("button", { name: "More for Login flow" }));
    expect(screen.getByRole("menuitem", { name: "Add to Favourites" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Move to Trash" })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "Add to Favourites" })));
    expect(usePrefs.getState().favourites).toEqual([FLOW]);
  });

  it("lists a starred diagram under Favourites, whichever project it is in", () => {
    render(
      <ul>
        <FavouriteDiagrams paths={[FLOW, "library/loose.drawio", "library/gone.drawio"]} />
      </ul>,
    );
    expect(within(screen.getByRole("list")).getAllByRole("button", { name: /^(Login flow|Loose)$/ }).map((b) => b.textContent)).toEqual(["Login flow", "Loose"]);
  });

  it("shows only a few rows to begin with, then 'Show more'", () => {
    useDiagrams.setState({ list: Array.from({ length: 20 }, (_, i) => info(`projects/demo/diagrams/d${i}.drawio`, `Diagram ${i}`, "demo")) });
    render(
      <ul>
        <ProjectDiagrams project="demo" depth={1} />
      </ul>,
    );
    expect(screen.getAllByRole("button", { name: /^Diagram \d+$/ })).toHaveLength(15);
    fireEvent.click(screen.getByRole("button", { name: /^Show 5 more of 20$/ }));
    expect(screen.getAllByRole("button", { name: /^Diagram \d+$/ })).toHaveLength(20);
  });
});
