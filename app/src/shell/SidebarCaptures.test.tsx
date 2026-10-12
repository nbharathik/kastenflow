// The sidebar's Captures entry: under the Inbox once there are captures or a way
// to make them is on, open on the capture tag's database, and no place in the
// person's pinned order.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetBrowserPrefs, useBrowserPrefs } from "../features/browser/prefs";
import { resetExtension, useExtension } from "../features/extension/store";
import { usePrefs } from "../features/workspace/prefs";
import { useWorkspace } from "../features/workspace/store";
import { derive } from "../features/workspace/store-layout";
import { initialLayout } from "../features/workspace/tabs";
import type { NoteMeta } from "../lib/vault/types";
import { useShell } from "../lib/store";
import { Sidebar } from "./Sidebar";

const note = (path: string, tags: string[] = []): NoteMeta => ({
  path,
  id: null,
  title: path.replace(/^.*\//, "").replace(/\.md$/, ""),
  kind: "card",
  icon: null,
  cover: null,
  parent: null,
  project: null,
  tags,
  modified: 0,
  created: null,
  updated: null,
  excerpt: "",
  words: 0,
  props: {},
  locked: false,
});

const sidebar = () => screen.getByRole("navigation", { name: "Sidebar" });
const names = () => [...sidebar().querySelectorAll("button[data-nav-main]")].map((b) => b.textContent?.replace(/\d+$/, "") ?? "");

beforeEach(() => {
  localStorage.clear();
  // Both switches are known (off), so the views do not ask the app and then overwrite what a test sets.
  resetBrowserPrefs();
  useBrowserPrefs.setState({ enabled: false, known: true });
  resetExtension();
  useExtension.setState({ status: { enabled: false, port: 7434, running: false, problem: null, paired: [], pairing: null } });
  usePrefs.setState({ navPinned: null, moreViews: false, foldedSections: [], favourites: [], pinnedPages: [] });
  useShell.setState({ sidebarOpen: true, namingProject: false });
  useWorkspace.setState({ client: null, ready: true, notes: [note("library/plain.md")], ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
});
afterEach(cleanup);

describe("the Captures entry in the sidebar", () => {
  it("is not there while nothing is captured and the browser and its extension are off", () => {
    render(<Sidebar />);
    expect(names()).toEqual(["Inbox", "Journal", "Tasks", "Calendar"]);
  });

  it("is listed right after the Inbox once something carries the capture tag, and opens its database", () => {
    useWorkspace.setState({ notes: [note("library/plain.md"), note("inbox/clip.md", ["capture"])] });
    render(<Sidebar />);
    expect(names()).toEqual(["Inbox", "Captures", "Journal", "Tasks", "Calendar"]);
    expect(usePrefs.getState().navPinned).toBeNull();
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Captures" }));
    expect(useWorkspace.getState().place).toEqual({ view: "tags", path: "#capture" });
    expect(within(sidebar()).getByRole("button", { name: "Captures" }).getAttribute("aria-current")).toBe("page");
    expect(within(sidebar()).getByRole("button", { name: /^Inbox/ }).getAttribute("aria-current")).toBeNull();
  });

  it("is listed while the extension is on, and while the browser is, and is gone when they are off again", () => {
    render(<Sidebar />);
    act(() => useExtension.setState({ status: { enabled: true, port: 7434, running: true, problem: null, paired: [], pairing: null } }));
    expect(names()).toContain("Captures");
    act(() => useExtension.setState({ status: { enabled: false, port: 7434, running: false, problem: null, paired: [], pairing: null } }));
    expect(names()).not.toContain("Captures");
    act(() => useBrowserPrefs.setState({ enabled: true, known: true }));
    expect(names()).toEqual(["Inbox", "Captures", "Journal", "Tasks", "Calendar"]);
    act(() => useBrowserPrefs.setState({ enabled: false }));
    expect(names()).not.toContain("Captures");
  });

  it("can be pinned, and then sits where it was pinned", () => {
    useWorkspace.setState({ notes: [note("inbox/clip.md", ["capture"])] });
    usePrefs.setState({ moreViews: true });
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Pin Captures to the sidebar" }));
    expect(usePrefs.getState().navPinned).toEqual(["inbox", "journal", "tasks", "calendar", "captures"]);
    expect(names().filter((n) => n === "Captures")).toHaveLength(2);
    // Once, in the sidebar's own list, at the end.
    expect(names().slice(0, 5)).toEqual(["Inbox", "Journal", "Tasks", "Calendar", "Captures"]);
  });
});
