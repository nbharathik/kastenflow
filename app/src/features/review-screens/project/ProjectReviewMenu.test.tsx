// The Review menu on a project's overview and page: the last review on its
// face, the next action and review day in its header, and its items.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dayFrom } from "../../../lib/dates";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { derive } from "../../workspace/store-layout";
import { useWorkspace } from "../../workspace/store";
import { initialLayout } from "../../workspace/tabs";
import { ProjectReviewMenu } from "./ProjectReviewMenu";

const TASK_TAG = "name: task\ncolor: green\nproperties:\n  - {key: status, type: select, options: [Todo, Doing, Done]}\n  - {key: due, type: date}\n";

const SEED = {
  "tags/task.yaml": TASK_TAG,
  "projects/kiln/_project.md": "---\ntitle: Kiln\ntype: project\nprops:\n  status: Active\n  last_review: 2026-09-01\n  review_after: 2026-10-01\n---\nThe kiln project.\n",
  "projects/kiln/pages/fire.md": "---\ntitle: Fire the test tile\ntype: page\nid: 01TASKFIRE\ntags: [task]\nprops:\n  status: Todo\n---\nBody.\n",
};

let vault: MemoryVault;

async function menu(files: Record<string, string> = SEED) {
  vault = new MemoryVault(files);
  const notes = await vault.list();
  useWorkspace.setState({ client: vault, ready: true, notes, ...derive(initialLayout()), stack: [], recent: [], toasts: [] });
  render(<ProjectReviewMenu project={notes.find((n) => n.kind === "project")!} />);
  return screen.getByRole("button", { name: "Review of Kiln" });
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("the Review menu", () => {
  it("names the last review on its button and the review day in its header", async () => {
    const button = await menu();
    expect(button.textContent).toMatch(/^Reviewed .*2026|^Reviewed .*Sep/);
    fireEvent.click(button);
    const list = await screen.findByRole("menu", { name: "Review of Kiln" });
    expect(list.textContent).toContain("No next action");
    expect(list.textContent).toMatch(/review /);
  });

  it("says Review when the project was never reviewed", async () => {
    const button = await menu({ ...SEED, "projects/kiln/_project.md": "---\ntitle: Kiln\ntype: project\n---\nThe kiln project.\n" });
    expect(button.textContent).toContain("Review");
    expect(button.textContent).not.toContain("Reviewed");
  });

  it("marks the project reviewed, and the menu then has a day to clear only while there is one", async () => {
    const button = await menu();
    fireEvent.click(button);
    expect(await screen.findByRole("menuitem", { name: "Clear the review day" })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "Mark reviewed today" })));
    await waitFor(async () => expect((await vault.read("projects/kiln/_project.md")).meta.props.last_review).toBe(dayFrom(0)));
  });

  it("opens the project's tasks from Next action… and pins the one picked, shown in the header afterwards", async () => {
    const button = await menu();
    fireEvent.click(button);
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Next action…/ }));
    const dialog = await screen.findByRole("dialog", { name: "Next action for Kiln" });
    await act(async () => fireEvent.click(within(dialog).getByRole("option", { name: /Fire the test tile/ })));
    await waitFor(async () => expect(typeof (await vault.read("projects/kiln/_project.md")).meta.props.next_action).toBe("string"));
    expect(useWorkspace.getState().toasts.at(-1)?.text).toBe("“Fire the test tile” is the next action of “Kiln”");
  });
});
