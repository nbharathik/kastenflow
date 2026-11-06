import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { HistoryPanel } from "./HistoryPanel.tsx";
import { StepLog, jumpTo } from "./step-log.ts";

afterEach(cleanup);

describe("the list of steps", () => {
  it("adds a step for each change, names it for a person, and ignores a change that changed nothing", () => {
    const log = new StepLog();
    log.note(null, "transform_elements");
    log.note(null, "set_notes");
    log.note(null, "set_notes", true);
    log.note(null, undefined);
    expect(log.length).toBe(2);
    expect(log.position).toBe(2);
    expect(log.rows().map((row) => row.label)).toEqual(["Edit notes", "Move elements", "Opened"]);
    expect(log.rows()[0]?.current).toBe(true);
  });

  it("moves along the list on undo and redo, and a new change drops what could have been redone", () => {
    const log = new StepLog();
    for (const operation of ["add_slide", "add_elements", "set_notes"]) log.note(null, operation);
    log.note("undo", "add_elements");
    log.note("undo", "add_slide");
    expect(log.position).toBe(1);
    expect(log.rows().map((row) => [row.label, row.current, row.undone])).toEqual([
      ["Edit notes", false, true],
      ["Add elements", false, true],
      ["Add slide", true, false],
      ["Opened", false, false],
    ]);
    log.note("redo", "add_elements");
    expect(log.position).toBe(2);
    log.note(null, "delete_elements");
    expect(log.length).toBe(3);
    expect(log.rows().map((row) => row.label)).toEqual(["Delete elements", "Add elements", "Add slide", "Opened"]);
  });

  it("works out how many undos or redos reach a step, never past the ends", () => {
    const log = new StepLog();
    for (const operation of ["add_slide", "add_elements", "set_notes"]) log.note(null, operation);
    expect(log.distanceTo(0)).toBe(-3);
    expect(log.distanceTo(3)).toBe(0);
    expect(log.distanceTo(99)).toBe(0);
    expect(log.distanceTo(-5)).toBe(-3);
    log.reset();
    expect(log.rows()).toHaveLength(1);
  });
});

async function open() {
  const session = new EditorSession(await newDeck("History"), new MemoryHost(), { saveDelay: 60_000, onError: () => {} });
  return session;
}

describe("the undo history panel", () => {
  it("follows the editor's steps and says so when there are none", async () => {
    const session = await open();
    const ui = new EditorUi();
    render(<HistoryPanel session={session} ui={ui} />);
    expect(screen.getByText(/Nothing to undo yet/)).toBeTruthy();
    act(() => void session.slides.add({ layout: "blank" }));
    act(() => void session.slides.add({ layout: "blank" }));
    const rows = screen.getAllByRole("button");
    expect(rows.map((row) => row.textContent)).toEqual(["Add slide", "Add slide", "Opened"]);
    expect(rows[0]?.getAttribute("aria-current")).toBe("step");
  });

  it("goes back to the step that was clicked, and forward again to one that was undone, a step at a time", async () => {
    const session = await open();
    const ui = new EditorUi();
    const first = session.deck.slides.length;
    act(() => {
      session.slides.add({ layout: "blank" });
      session.slides.add({ layout: "blank" });
      session.slides.add({ layout: "blank" });
    });
    render(<HistoryPanel session={session} ui={ui} />);
    expect(session.deck.slides).toHaveLength(first + 3);
    fireEvent.click(screen.getByRole("button", { name: "Opened" }));
    expect(session.deck.slides).toHaveLength(first);
    expect(session.state.canRedo).toBe(true);
    const rows = screen.getAllByRole("button");
    expect(rows.map((row) => row.getAttribute("aria-current") === "step")).toEqual([false, false, false, true]);
    expect(rows[0]?.textContent).toContain("undone");
    // The step in the middle of the list: two redos.
    fireEvent.click(screen.getAllByRole("button")[1] as HTMLElement);
    expect(session.deck.slides).toHaveLength(first + 2);
    expect(session.stepLog.position).toBe(2);
    // Redo and undo from the editor go on from there.
    act(() => session.redo());
    expect(session.deck.slides).toHaveLength(first + 3);
    expect(jumpTo(session.stepLog, session, 1)).toBe(2);
    expect(session.deck.slides).toHaveLength(first + 1);
  });

  it("walks the rows with the arrow keys", async () => {
    const session = await open();
    act(() => {
      session.slides.add({ layout: "blank" });
      session.slides.add({ layout: "blank" });
    });
    render(<HistoryPanel session={session} ui={new EditorUi()} />);
    const rows = screen.getAllByRole("button");
    rows[0]?.focus();
    fireEvent.keyDown(rows[0] as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1] as HTMLElement, { key: "End" });
    expect(document.activeElement).toBe(rows[2]);
  });
});
