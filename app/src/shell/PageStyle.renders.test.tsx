// The page style menu draws again only for the preferences it shows.

import { act, cleanup, render } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerPage } from "../features/workspace/page/open-page";
import type { PageSession } from "../features/workspace/page/page-session";
import { usePageLayouts } from "../features/workspace/page/page-layout";
import { usePrefs } from "../features/workspace/prefs";
import { PageStyle } from "./PageStyle";

const session = { path: "library/a.md" } as unknown as PageSession;
let forget = () => {};
let commits = 0;

beforeEach(() => {
  localStorage.clear();
  forget = registerPage(session, () => {}, () => {});
  usePageLayouts.setState({ of: new Map([[session, {}]]) });
});
afterEach(() => {
  cleanup();
  forget();
  usePageLayouts.setState({ of: new Map() });
});

function menu() {
  render(
    <Profiler id="style" onRender={() => void commits++}>
      <PageStyle path="library/a.md" />
    </Profiler>,
  );
}

describe("the page style menu's drawing", () => {
  it("does not draw again for a preference it does not show", () => {
    menu();
    const before = commits;
    act(() => usePrefs.setState({ sidebarWidth: 333 }));
    act(() => usePrefs.setState({ spellcheck: false }));
    expect(commits - before).toBe(0);
  });

  it("draws again when the default font changes", () => {
    menu();
    const before = commits;
    act(() => usePrefs.setState({ font: "serif" }));
    expect(commits - before).toBeGreaterThan(0);
  });
});
