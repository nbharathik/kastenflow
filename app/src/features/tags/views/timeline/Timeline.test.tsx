import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toasts } from "../../../workspace/overlays/Toasts";
import { MemoryVault } from "../../../workspace/preview/memory-vault";
import { useWorkspace } from "../../../workspace/store";
import { useTags } from "../../store";
import { TagDatabase } from "../../TagDatabase";
import { KEY_PAUSE } from "../../../calendar/use-moves";
import { LABEL_W } from "./Timeline";
import { DAY_WIDTH, viewSpan, xOf } from "./layout";

const TASK = [
  "name: task",
  "color: green",
  "properties:",
  "  - {key: status, type: select, options: [Todo, Doing, Done]}",
  "  - {key: begin, type: date}",
  "  - {key: finish, type: date}",
  "views:",
  "  - {name: Plan, type: timeline, start: begin, end: finish, group_by: status, scale: month}",
  "  - {name: All, type: table}",
  "",
].join("\n");

const note = (title: string, props: string) => `---\ntitle: ${title}\ntags: [task]\n${props ? `props:\n${props}` : ""}---\n${title}.\n`;

const SEED = {
  "tags/task.yaml": TASK,
  "library/design.md": note("Design", "  status: Doing\n  begin: 2026-09-28\n  finish: 2026-10-02\n"),
  "library/review.md": note("Review", "  status: Doing\n  begin: 2026-10-05\n  finish: 2026-10-07\n"),
  "library/launch.md": note("Launch", "  status: Todo\n  begin: 2026-10-10\n"),
  "library/backwards.md": note("Backwards", "  status: Todo\n  begin: 2026-10-12\n  finish: 2026-10-09\n"),
  "library/loose.md": note("Loose end", "  status: Todo\n"),
};

let vault: MemoryVault;
const text = async (path: string) => (await vault.read(path)).text;
/** The tag's saved views, as the vault keeps them. */
const saved = async () => (await vault.tagSchemas()).find((s) => s.name === "task")!.views;
const plan = async () => (await saved()).find((v) => v.name === "Plan")!;
const bar = (path: string) => document.querySelector<HTMLElement>(`[data-bar="library/${path}.md"]`)!;
const scroller = () => screen.getByRole("group", { name: "Timeline of notes tagged #task" });
const today = "2026-09-30";

async function open(seed: Record<string, string> = SEED, tag = "task") {
  vault = new MemoryVault(seed);
  useWorkspace.setState({ place: { view: "tags" }, toasts: [] });
  await useWorkspace.getState().connect({ client: vault });
  await useTags.getState().load();
  render(
    <>
      <TagDatabase tag={tag} />
      <Toasts />
    </>,
  );
  await screen.findByRole("group", { name: `Timeline of notes tagged #${tag}` });
}

/** Presses a bar (or one of its edges), carries it `pixels` sideways and lets go. */
async function drag(from: HTMLElement, pixels: number) {
  fireEvent.pointerDown(from, { button: 0, buttons: 1, pointerId: 3, clientX: 300, clientY: 80 });
  fireEvent.pointerMove(from, { buttons: 1, pointerId: 3, clientX: 300 + pixels, clientY: 80 });
  await act(async () => fireEvent.pointerUp(from, { button: 0, pointerId: 3, clientX: 300 + pixels, clientY: 80 }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
  localStorage.clear();
  useTags.setState({ schemas: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Timeline view", () => {
  it("shows bars, markers, lanes, today's line and the notes without dates", async () => {
    await open();
    expect(bar("design").dataset).toMatchObject({ kind: "bar", start: "2026-09-28", end: "2026-10-02" });
    expect(bar("review").dataset.kind).toBe("bar");
    expect(bar("launch").dataset).toMatchObject({ kind: "point", start: "2026-10-10" });
    expect(bar("launch").dataset.end).toBeUndefined();
    // One lane per option, notes with no status first (none here), each labelled.
    const lanes = within(scroller()).getAllByRole("group").map((g) => g.getAttribute("aria-label"));
    expect(lanes).toEqual(["Todo", "Doing", "Done"]);
    expect(document.querySelector("[data-today]")?.getAttribute("data-today")).toBe(today);
    const aside = screen.getByRole("complementary", { name: "No dates" });
    expect(within(aside).getByRole("button", { name: "Loose end" })).toBeTruthy();
    expect(within(aside).getByRole("button", { name: "Set dates for Loose end" })).toBeTruthy();
    expect(document.querySelector("[data-bar='library/loose.md']")).toBeNull();
  });

  it("says the dates in words for a screen reader and flags an end before the start", async () => {
    await open();
    expect(bar("design").getAttribute("aria-label")).toMatch(/^Design, .*28.*2/);
    const odd = bar("backwards");
    expect(odd.dataset.kind).toBe("point");
    expect(odd.hasAttribute("data-reversed")).toBe(true);
    expect(odd.getAttribute("aria-label")).toContain("its end is before its start");
    // It has no edges to resize while the dates disagree.
    expect(odd.querySelector("[data-grip]")).toBeNull();
    expect(bar("design").querySelectorAll("[data-grip]")).toHaveLength(2);
  });

  it("centres today when it opens", async () => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1000 });
    try {
      await open();
      const span = viewSpan(["2026-09-28", "2026-10-12"], today, "month");
      const want = Math.max(0, xOf(today, span.from, "month") + DAY_WIDTH.month / 2 - (1000 - LABEL_W) / 2);
      await waitFor(() => expect(scroller().scrollLeft).toBe(want));
    } finally {
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    }
  });

  it("changes the scale and keeps it with the view", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Scale: Month" }));
    await act(async () => fireEvent.click(await screen.findByRole("option", { name: "Quarter" })));
    await waitFor(async () => expect((await plan()).scale).toBe("quarter"));
    expect(screen.getByRole("button", { name: "Scale: Quarter" })).toBeTruthy();
    expect(document.querySelector(".kasten-tl")?.getAttribute("data-scale")).toBe("quarter");
    // The rest of the view is as it was.
    expect(await plan()).toEqual({ name: "Plan", type: "timeline", start: "begin", end: "finish", group_by: "status", scale: "quarter" });
  });

  it("moves a bar by dragging it: one change for both dates, and Undo puts them back", async () => {
    await open();
    const update = vi.spyOn(vault, "updateProps");
    await drag(bar("design"), DAY_WIDTH.month * 3);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith("library/design.md", { begin: "2026-10-01", finish: "2026-10-05" });
    expect(await text("library/design.md")).toContain("begin: 2026-10-01");
    await waitFor(() => expect(bar("design").dataset.start).toBe("2026-10-01"));

    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Undo" })));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update).toHaveBeenLastCalledWith("library/design.md", { begin: "2026-09-28", finish: "2026-10-02" });
    await waitFor(() => expect(bar("design").dataset.start).toBe("2026-09-28"));
  });

  it("resizes from either edge, writing only the date that changed", async () => {
    await open();
    const update = vi.spyOn(vault, "updateProps");
    await drag(bar("design").querySelector<HTMLElement>("[data-grip='end']")!, DAY_WIDTH.month * 2);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenLastCalledWith("library/design.md", { finish: "2026-10-04" });
    await waitFor(() => expect(bar("design").dataset.end).toBe("2026-10-04"));

    await drag(bar("design").querySelector<HTMLElement>("[data-grip='start']")!, -DAY_WIDTH.month);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update).toHaveBeenLastCalledWith("library/design.md", { begin: "2026-09-27" });
  });

  it("will not drag an end past its start, and a press that goes nowhere writes nothing", async () => {
    await open();
    const update = vi.spyOn(vault, "updateProps");
    await drag(bar("review").querySelector<HTMLElement>("[data-grip='end']")!, -DAY_WIDTH.month * 20);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenLastCalledWith("library/review.md", { finish: "2026-10-05" });
    await drag(bar("launch"), 2);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("moves a marker by dragging it", async () => {
    await open();
    const update = vi.spyOn(vault, "updateProps");
    await drag(bar("launch"), DAY_WIDTH.month * -2);
    await waitFor(() => expect(update).toHaveBeenCalledWith("library/launch.md", { begin: "2026-10-08" }));
  });

  it("puts a bar back when Escape is pressed mid-drag", async () => {
    await open();
    const update = vi.spyOn(vault, "updateProps");
    const from = bar("design");
    fireEvent.pointerDown(from, { button: 0, buttons: 1, pointerId: 3, clientX: 300 });
    fireEvent.pointerMove(from, { buttons: 1, pointerId: 3, clientX: 400 });
    expect(from.hasAttribute("data-carried")).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    await act(async () => fireEvent.pointerUp(from, { button: 0, pointerId: 3, clientX: 400 }));
    expect(update).not.toHaveBeenCalled();
    expect(bar("design").dataset.start).toBe("2026-09-28");
  });

  it("shifts a focused bar with Alt+arrows: a run of keys is one change", async () => {
    await open();
    const update = vi.spyOn(vault, "updateProps");
    const design = bar("design");
    design.focus();
    fireEvent.keyDown(design, { key: "ArrowRight", altKey: true });
    fireEvent.keyDown(design, { key: "ArrowRight", altKey: true });
    fireEvent.keyDown(design, { key: "ArrowLeft", altKey: true });
    // It shows at once where it is going; nothing is written until the keys pause.
    expect(bar("design").dataset.start).toBe("2026-09-29");
    expect(update).not.toHaveBeenCalled();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1), { timeout: KEY_PAUSE + 2000 });
    expect(update).toHaveBeenCalledWith("library/design.md", { begin: "2026-09-29", finish: "2026-10-03" });
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Undo" })));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith("library/design.md", { begin: "2026-09-28", finish: "2026-10-02" }));
  });

  it("moves only the end with Alt+Shift+arrow", async () => {
    await open();
    const update = vi.spyOn(vault, "updateProps");
    const review = bar("review");
    review.focus();
    fireEvent.keyDown(review, { key: "ArrowRight", altKey: true, shiftKey: true });
    await waitFor(() => expect(update).toHaveBeenCalledWith("library/review.md", { finish: "2026-10-08" }), { timeout: KEY_PAUSE + 2000 });
  });

  it("moves focus between bars with the arrow keys and opens a note with Enter", async () => {
    await open();
    const first = bar("design");
    first.focus();
    // Rows are read left to right, then down: Doing holds Design then Review.
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(bar("review"));
    // Up from Review is the nearest bar in the row above: Todo holds Launch, and under it Backwards.
    fireEvent.keyDown(bar("review"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(bar("backwards"));
    fireEvent.keyDown(bar("backwards"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(bar("launch"));
    fireEvent.keyDown(bar("launch"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(bar("backwards"));
    fireEvent.keyDown(bar("backwards"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(bar("review"));
    // Only one bar is in the tab order.
    expect(document.querySelectorAll("[data-bar][tabindex='0']")).toHaveLength(1);

    const openPath = vi.spyOn(useWorkspace.getState(), "openPath");
    fireEvent.keyDown(bar("review"), { key: "Enter" });
    expect(openPath).toHaveBeenCalledWith("library/review.md", "peek");
  });

  it("gives a note without dates today as its dates, with an Undo", async () => {
    await open();
    const update = vi.spyOn(vault, "updateProps");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Set dates for Loose end" })));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith("library/loose.md", { begin: today, finish: today });
    await waitFor(() => expect(bar("loose").dataset).toMatchObject({ start: today, end: today }));
    expect(screen.queryByRole("complementary", { name: "No dates" })).toBeNull();

    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Undo" })));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update).toHaveBeenLastCalledWith("library/loose.md", { begin: null, finish: null });
    await waitFor(() => expect(screen.getByRole("complementary", { name: "No dates" })).toBeTruthy());
  });

  it("says what to do when nothing has a date, and when there are no notes", async () => {
    await open({ "tags/task.yaml": TASK, "library/loose.md": note("Loose end", "") });
    expect(screen.getByRole("note").textContent).toContain("Use Set dates");
    cleanup();
    await open({ "tags/task.yaml": TASK });
    expect(screen.getByRole("note").textContent).toContain("No notes yet");
  });

  it("says how to get a date property when the tag has none", async () => {
    await open({ "tags/plain.yaml": "name: plain\nproperties:\n  - {key: size, type: number}\nviews:\n  - {name: Plan, type: timeline, start: size}\n" }, "plain").catch(() => {});
    expect(await screen.findByText("Nothing to place on a timeline yet")).toBeTruthy();
  });

  it("offers Timeline among the views to add, starting it from the tag's dates", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add a view" }));
    await act(async () => fireEvent.click(await screen.findByRole("menuitem", { name: /Timeline/ })));
    await waitFor(async () => expect((await saved()).map((v) => v.name)).toEqual(["Plan", "All", "Timeline"]));
    expect((await saved())[2]).toEqual({ name: "Timeline", type: "timeline", start: "begin", end: "finish", scale: "month" });
  });

  it("changes what the view starts at, ends at and makes lanes by, from its bar", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Lanes by: status" }));
    await act(async () => fireEvent.click(await screen.findByRole("option", { name: "No lanes" })));
    await waitFor(async () => expect(await plan()).toEqual({ name: "Plan", type: "timeline", start: "begin", end: "finish", scale: "month" }));
    expect(screen.queryByText("Todo")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Ends at: finish" }));
    await act(async () => fireEvent.click(await screen.findByRole("option", { name: "No end (markers)" })));
    await waitFor(() => expect(bar("design").dataset.kind).toBe("point"));
    expect(await plan()).toEqual({ name: "Plan", type: "timeline", start: "begin", scale: "month" });
  });
});
