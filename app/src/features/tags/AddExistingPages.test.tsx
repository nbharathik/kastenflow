import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NoteMeta } from "../../lib/vault/types";
import { useWorkspace } from "../workspace/store";
import { AddExistingPages, candidates } from "./AddExistingPages";

const note = (path: string, title: string, extra: Partial<NoteMeta> = {}): NoteMeta => ({
  path,
  id: path,
  title,
  kind: "page",
  icon: null,
  cover: null,
  parent: null,
  project: null,
  tags: [],
  modified: 0,
  created: null,
  updated: null,
  excerpt: "",
  words: 0,
  props: {},
  locked: false,
  ...extra,
});

const NOTES = [
  note("library/alpha.md", "Alpha", { modified: 3 }),
  note("library/beta.md", "Beta", { modified: 2 }),
  note("library/gamma.md", "Gamma", { modified: 1, tags: ["Reading"] }),
  note("templates/blank.md", "Blank", { kind: "template", modified: 9 }),
  note("projects/trip/pages/delta.md", "Delta Trip", { project: "trip", modified: 4 }),
];

beforeEach(() => useWorkspace.setState({ notes: NOTES }));
afterEach(cleanup);

describe("the pages the picker offers", () => {
  it("leave out what is in the tag already (in any case) and templates, newest first", () => {
    expect(candidates(NOTES, "reading", "").map((n) => n.title)).toEqual(["Delta Trip", "Alpha", "Beta"]);
  });

  it("are found by what is typed", () => {
    expect(candidates(NOTES, "reading", "delt").map((n) => n.title)).toEqual(["Delta Trip"]);
    expect(candidates(NOTES, "reading", "gamma")).toEqual([]);
    expect(candidates(NOTES, "reading", "zzzz")).toEqual([]);
  });
});

describe("Add existing pages", () => {
  const box = () => screen.getByRole("textbox", { name: "Find pages to add to #reading" });

  it("adds the page the cursor is on with Enter, and the way is by keyboard alone", () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(<AddExistingPages tag="reading" onAdd={onAdd} onClose={onClose} />);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Delta Triptrip", "AlphaPages", "BetaPages"]);
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith(["library/alpha.md"]);
    expect(onClose).toHaveBeenCalled();
  });

  it("adds the ticked pages together, ticked with Space while the box is empty or Ctrl+Space", () => {
    const onAdd = vi.fn();
    render(<AddExistingPages tag="reading" onAdd={onAdd} onClose={vi.fn()} />);
    fireEvent.keyDown(box(), { key: " " });
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    fireEvent.keyDown(box(), { key: " " });
    expect(screen.getAllByRole("option").filter((o) => o.getAttribute("aria-selected") === "true")).toHaveLength(2);
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith(["projects/trip/pages/delta.md", "library/beta.md"]);
  });

  it("types a search, and a click on a row adds that page; Escape closes", () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(<AddExistingPages tag="reading" onAdd={onAdd} onClose={onClose} />);
    fireEvent.change(box(), { target: { value: "bet" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.click(screen.getByRole("option", { name: /Beta/ }));
    expect(onAdd).toHaveBeenCalledWith(["library/beta.md"]);
    fireEvent.keyDown(box(), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("says so when nothing matches, and adds nothing on Enter", () => {
    const onAdd = vi.fn();
    render(<AddExistingPages tag="reading" onAdd={onAdd} onClose={vi.fn()} />);
    fireEvent.change(box(), { target: { value: "nothing like this" } });
    expect(screen.getByText("No page matches")).toBeTruthy();
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onAdd).not.toHaveBeenCalled();
  });
});
