// A board of 1,000 cards: it draws in reasonable time, carrying a card over
// the columns redraws nothing, and a drop redraws only the two columns it
// touches (memoised cards), measured with React's Profiler.

import { Profiler, type ProfilerOnRenderCallback } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { MemoryVault } from "../../../workspace/preview/memory-vault";
import { useWorkspace } from "../../../workspace/store";
import { useTags } from "../../store";
import { TagDatabase } from "../../TagDatabase";

const COUNT = 1000;
const TASK = "name: task\nproperties:\n  - {key: status, type: select, options: [Todo, Doing, Done]}\n  - {key: due, type: date}\n  - {key: priority, type: select, options: [Low, Medium, High]}\nviews:\n  - {name: Board, type: kanban, group_by: status}\n";

function seed(): Record<string, string> {
  const files: Record<string, string> = { "tags/task.yaml": TASK };
  const statuses = ["Todo", "Doing", "Done", null];
  const priorities = ["Low", "Medium", "High"];
  for (let i = 0; i < COUNT; i++) {
    const props = [statuses[i % 4] && `  status: ${statuses[i % 4]}`, `  priority: ${priorities[i % 3]}`, i % 2 ? `  due: 2026-10-${String(1 + (i % 28)).padStart(2, "0")}` : null].filter(Boolean);
    files[`library/t${String(i).padStart(4, "0")}.md`] = `---\ntitle: Task ${i}\ntags: [task]\nprops:\n${props.join("\n")}\n---\nSome words about task ${i}, enough for a line or two on its card.\n`;
  }
  return files;
}

interface Commit {
  phase: string;
  actual: number;
  base: number;
}

afterEach(cleanup);

it("draws 1,000 cards, redraws nothing while one is carried, and little when it lands", async () => {
  const vault = new MemoryVault(seed());
  useWorkspace.setState({ place: { view: "tags" }, toasts: [] });
  await useWorkspace.getState().connect({ client: vault });
  useTags.setState({ schemas: null });
  await useTags.getState().load();

  const commits: Commit[] = [];
  const onRender: ProfilerOnRenderCallback = (_id, phase, actual, base) => void commits.push({ phase, actual, base });
  const start = performance.now();
  render(
    <Profiler id="board" onRender={onRender}>
      <TagDatabase tag="task" />
    </Profiler>,
  );
  const drawn = performance.now() - start;
  expect(document.querySelectorAll("[data-card]")).toHaveLength(COUNT);
  // The database reads the schemas again once it is up; let that settle.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
  const full = commits[0]!;
  expect(full.phase).toBe("mount");

  const board = document.querySelector<HTMLElement>(".kasten-kanban")!;
  const column = (label: string) => within(board).getByRole("region", { name: label });
  const card = screen.getByRole("button", { name: "Task 0" });
  expect(card.closest("[data-column]")?.getAttribute("aria-label")).toBe("Todo");

  commits.length = 0;
  fireEvent.pointerDown(card, { button: 0, buttons: 1, pointerId: 1, clientX: 10, clientY: 10 });
  for (const [i, label] of ["Doing", "Done", "No status", "Todo", "Done", "Doing"].entries()) {
    fireEvent.pointerMove(column(label), { buttons: 1, pointerId: 1, clientX: 40 + i * 20, clientY: 60 });
    expect(column(label).hasAttribute("data-over")).toBe(true);
  }
  // Carrying a card over the columns commits nothing at all.
  expect(commits).toEqual([]);

  await act(async () => fireEvent.pointerUp(column("Doing"), { button: 0, pointerId: 1, clientX: 140, clientY: 60 }));
  expect(card.isConnected).toBe(false);
  expect(screen.getByRole("button", { name: "Task 0" }).closest("[data-column]")?.getAttribute("aria-label")).toBe("Doing");
  const drop = commits[0]!;
  await expect.poll(async () => (await vault.read("library/t0000.md")).text).toContain("status: Doing");
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
  const after = commits.slice(1);

  // Only the two columns the card left and joined redraw: a small share of a full draw. CI's shared machines add
  // pauses that only ever lengthen a commit, so there the share may be half; a full redraw is still caught.
  const share = process.env.CI ? 2 : 4;
  expect(drop.actual).toBeLessThan(drop.base / share);
  for (const commit of after) expect(commit.actual).toBeLessThan(commit.base / share);
  // jsdom and React's development build are slow; a real window is many times quicker.
  expect(drawn).toBeLessThan(15_000);
});
