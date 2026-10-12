// The Captures entry: listed when something carries the `capture` tag, or the
// browser or its extension is on, and open on the tag's database.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NoteMeta } from "../../lib/vault/types";
import { resetBrowserPrefs, useBrowserPrefs } from "../browser/prefs";
import { useWorkspace } from "../workspace/store";
import { capturesPlace, capturesShown, hasCaptures, isCapturesPlace } from "./captures";
import { resetExtension, useExtension } from "./store";

const note = (path: string, tags: string[], kind = "card"): NoteMeta => ({
  path,
  id: null,
  title: path,
  kind,
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

let before: readonly NoteMeta[];

beforeEach(() => {
  before = useWorkspace.getState().notes;
  localStorage.clear();
  resetBrowserPrefs();
  resetExtension();
  useWorkspace.setState({ notes: [] });
});

afterEach(() => {
  useWorkspace.setState({ notes: before as NoteMeta[] });
});

describe("the Captures entry", () => {
  it("is not listed in a vault with no captures while the browser and its extension are off", () => {
    useWorkspace.setState({ notes: [note("inbox/a.md", ["idea"]), note("library/b.md", [], "page")] });
    expect(capturesShown()).toBe(false);
  });

  it("is listed once a note carries the capture tag, in any case, and a template does not count", () => {
    useWorkspace.setState({ notes: [note("templates/t.md", ["capture"], "template")] });
    expect(capturesShown()).toBe(false);
    useWorkspace.setState({ notes: [note("inbox/a.md", ["Idea", "Capture"])] });
    expect(capturesShown()).toBe(true);
  });

  it("is listed while the browser is on, and while the extension is", () => {
    useBrowserPrefs.setState({ enabled: true, known: true });
    expect(capturesShown()).toBe(true);
    useBrowserPrefs.setState({ enabled: false });
    expect(capturesShown()).toBe(false);
    useExtension.setState({ status: { enabled: true, port: 7434, running: true, problem: null, paired: [], pairing: null } });
    expect(capturesShown()).toBe(true);
    useExtension.setState({ status: { enabled: false, port: 7434, running: false, problem: null, paired: [], pairing: null } });
    expect(capturesShown()).toBe(false);
  });

  it("asks of one list of notes once, however often the sidebar is drawn", () => {
    const list = [note("inbox/a.md", ["capture"])];
    expect(hasCaptures(list)).toBe(true);
    // The same list answers from what was kept, even if it were changed behind its back.
    list[0]!.tags = [];
    expect(hasCaptures(list)).toBe(true);
    expect(hasCaptures([...list])).toBe(false);
  });

  it("opens the capture tag's database", () => {
    expect(capturesPlace).toEqual({ view: "tags", path: "#capture" });
    expect(isCapturesPlace(capturesPlace)).toBe(true);
    expect(isCapturesPlace({ view: "tags", path: "#paper" })).toBe(false);
    expect(isCapturesPlace({ view: "tags" })).toBe(false);
    expect(isCapturesPlace({ view: "page", path: "#capture" })).toBe(false);
  });
});
