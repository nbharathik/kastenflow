// How often the top bar draws: not for the counts and excerpt a save brings
// back, nor for a preference it does not show.

import { act, cleanup, render } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SEED } from "../features/boards/map-fixtures";
import { useBoards } from "../features/boards/store";
import { usePrefs } from "../features/workspace/prefs";
import { MemoryVault } from "../features/workspace/preview/memory-vault";
import { useWorkspace } from "../features/workspace/store";
import { noteAt } from "../features/workspace/tree";
import { TopBar } from "./TopBar";

const PAGE = "projects/trip/pages/seaside.md";

let commits = 0;

function bar() {
  render(
    <Profiler id="bar" onRender={() => void commits++}>
      <TopBar pane={useWorkspace.getState().layout.panes[0]!} first />
    </Profiler>,
  );
}

beforeEach(async () => {
  localStorage.clear();
  useBoards.setState({ list: [], loaded: false });
  await useWorkspace.getState().connect({ client: new MemoryVault(SEED) });
  useWorkspace.getState().openPath(PAGE);
});
afterEach(cleanup);

describe("the top bar's drawing", () => {
  it("does not draw again when a save brings back only the counts, excerpt and times", () => {
    bar();
    const meta = noteAt(useWorkspace.getState().notes, PAGE)!;
    const before = commits;
    for (let i = 1; i <= 5; i++) act(() => useWorkspace.getState().noteChanged({ ...meta, words: meta.words + i, excerpt: `typed ${i}`, modified: meta.modified + i }));
    expect(commits - before).toBe(0);
  });

  it("draws again when the title changes", () => {
    bar();
    const meta = noteAt(useWorkspace.getState().notes, PAGE)!;
    const before = commits;
    act(() => useWorkspace.getState().noteChanged({ ...meta, title: "Seaside, renamed" }));
    expect(commits - before).toBeGreaterThan(0);
  });

  it("does not draw again for a preference it does not show", () => {
    bar();
    const before = commits;
    act(() => usePrefs.setState({ sidebarWidth: 321 }));
    act(() => usePrefs.setState({ weekStart: 0 }));
    expect(commits - before).toBe(0);
  });

  it("draws again when this page's favourite changes", () => {
    bar();
    const before = commits;
    act(() => usePrefs.getState().toggleFavourite(PAGE));
    expect(commits - before).toBeGreaterThan(0);
  });
});
