import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useWorkspace } from "../features/workspace/store";
import type { NoteMeta } from "../lib/vault/types";
import { sameDrawn, useDrawnNotes } from "./drawn-notes";

const meta = (over: Partial<NoteMeta> = {}): NoteMeta => ({
  path: "a.md",
  id: "id-a",
  title: "A",
  kind: "page",
  icon: null,
  cover: null,
  parent: null,
  project: null,
  tags: [],
  modified: 1,
  created: null,
  updated: null,
  excerpt: "",
  words: 0,
  props: {},
  locked: false,
  ...over,
});

const original = useWorkspace.getState().notes;
afterEach(() => useWorkspace.setState({ notes: original }));

describe("sameDrawn", () => {
  it("ignores what typing changes", () => {
    expect(sameDrawn(meta(), meta({ modified: 9, excerpt: "more", words: 40, updated: "now", props: { x: 1 } }))).toBe(true);
  });

  it("sees what the sidebar draws", () => {
    for (const over of [{ title: "B" }, { icon: "x" }, { parent: "p" }, { tags: ["t"] }, { childrenOrder: ["c"] }, { path: "b.md" }]) {
      expect(sameDrawn(meta(), meta(over))).toBe(false);
    }
  });
});

describe("useDrawnNotes", () => {
  it("draws again for a new title, not for typing", () => {
    let renders = 0;
    function Probe() {
      renders++;
      return <p>{useDrawnNotes().map((n) => n.title).join(",")}</p>;
    }
    useWorkspace.setState({ notes: [meta()] });
    const view = render(<Probe />);
    const first = renders;
    act(() => useWorkspace.setState({ notes: [meta({ modified: 2, excerpt: "typed", words: 3 })] }));
    expect(renders).toBe(first);
    act(() => useWorkspace.setState({ notes: [meta({ title: "Renamed" })] }));
    expect(renders).toBe(first + 1);
    expect(view.container.textContent).toBe("Renamed");
  });
});
