// The review screens against the preview vault: what they list and count,
// their empty states, that opening one writes nothing, the weekly reminder
// (off until switched on), marking a review done and "Save as note".

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dayFrom } from "../../lib/dates";
import type { VaultClient } from "../../lib/vault/types";
import { useTaskRows } from "../dashboard/task-rows";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { derive } from "../workspace/store-layout";
import { useWorkspace } from "../workspace/store";
import { initialLayout } from "../workspace/tabs";
import { currentReview, useReviewPrefs, type ReviewPrefs } from "./review-prefs";
import { ReviewBanner } from "./ReviewBanner";
import { ReviewScreens } from "./ReviewScreens";

const TODAY = dayFrom(0);
const TASK_TAG = "name: task\ncolor: green\nproperties:\n  - {key: status, type: select, options: [Todo, Doing, Done]}\n  - {key: due, type: date}\n";
const card = (title: string, day: number) => `---\ntitle: ${title}\ntype: card\ncreated: ${dayFrom(day)}T09:00:00\n---\nBody.\n`;

const SEED = {
  "tags/task.yaml": TASK_TAG,
  "inbox/kiln.md": card("Kiln notes", -1),
  "inbox/glaze.md": card("Glaze recipe", -2),
  "projects/kiln/_project.md": `---\ntitle: Kiln\ntype: project\nprops:\n  status: Active\n  review_after: ${dayFrom(-2)}\n---\nThe kiln project.\n`,
  "projects/garden/_project.md": `---\ntitle: Garden\ntype: project\nprops:\n  status: Active\n  review_after: ${dayFrom(20)}\n---\nThe garden.\n`,
  "library/plans.md": `---\ntitle: Plans\ntype: page\n---\n- [ ] Call the mason @${dayFrom(-3)}\n- [ ] Order glaze @${TODAY}\n- [ ] Someday\n`,
  "library/fire.md": `---\ntitle: Fire the tile\ntype: page\ntags: [task]\nprops:\n  status: Todo\n  due: ${dayFrom(-1)}\n---\nBody.\n`,
  "library/clay.md": `---\ntitle: Pick the clay\ntype: page\ntags: [decision]\ncreated: ${dayFrom(-2)}T09:00:00\n---\nGrey.\n`,
  "library/mixed.md": `---\ntitle: Mixed the glaze\ntype: page\ntags: [task]\nprops:\n  status: Done\n---\nBody.\n`,
};

/** Every call that could write to the vault, noted by name. */
const WRITERS = new Set(["create", "capture", "saveBody", "updateProps", "setTags", "setProjectState", "move", "moveToInbox", "trash", "convert", "rename", "journal", "applyTemplate", "append", "replaceSection", "setMeta", "addToBoard", "createBoard", "createCollection", "updateCollection", "duplicate", "restore", "commitEdits", "saveAsset", "applySetup", "addKit"]);

function watched(vault: MemoryVault): { client: VaultClient; calls: string[] } {
  const calls: string[] = [];
  const client = new Proxy(vault, {
    get(target, prop) {
      const value = Reflect.get(target, prop) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (WRITERS.has(String(prop))) calls.push(String(prop));
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { client: client as unknown as VaultClient, calls };
}

let vault: MemoryVault;

async function open(path: string | undefined, seed: Record<string, string> = SEED) {
  vault = new MemoryVault(seed);
  const { client, calls } = watched(vault);
  useWorkspace.setState({ client, ready: true, notes: await vault.list(), ...derive(initialLayout()), stack: [], recent: [], toasts: [] });
  render(<ReviewScreens path={path} />);
  return calls;
}

beforeEach(() => {
  localStorage.clear();
  useReviewPrefs.setState({ saved: {} });
  useTaskRows.setState({ rows: null });
});
afterEach(cleanup);

const card_ = (name: string) => screen.getByRole("region", { name });

describe("the daily review", () => {
  it("counts what waits: captures, what is overdue and due, projects to review, decisions", async () => {
    await open(undefined);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Daily review");
    const captures = card_("Captures to triage");
    expect(within(captures).getByText("2")).toBeTruthy();
    expect(within(captures).getByText("Kiln notes")).toBeTruthy();
    // To-dos and projects are read a moment later.
    await waitFor(() => expect(within(card_("Overdue")).getByText("Call the mason")).toBeTruthy());
    expect(within(card_("Overdue")).getByText("Fire the tile")).toBeTruthy();
    expect(within(card_("Due today")).getByText("Order glaze")).toBeTruthy();
    expect(within(card_("Due today")).queryByText("Someday")).toBeNull();
    await waitFor(() => expect(within(card_("Projects due for review")).getByText("Kiln")).toBeTruthy());
    expect(within(card_("Projects due for review")).queryByText("Garden")).toBeNull();
    // A decision from two days ago is not today's.
    expect(within(card_("Decisions")).getByText("No decision was noted today.")).toBeTruthy();
  });

  it("writes nothing to the vault by being opened", async () => {
    const calls = await open(undefined);
    await waitFor(() => expect(within(card_("Overdue")).getByText("Call the mason")).toBeTruthy());
    await waitFor(() => expect(within(card_("Projects due for review")).getByText("Kiln")).toBeTruthy());
    const before = JSON.stringify((await vault.list()).map((n) => [n.path, n.modified]));
    expect(calls).toEqual([]);
    expect(JSON.stringify((await vault.list()).map((n) => [n.path, n.modified]))).toBe(before);
    // Not even a journal day for today; and no choice is stored.
    expect((await vault.list()).some((n) => n.kind === "journal")).toBe(false);
    expect(localStorage.getItem("kasten.reviews")).toBeNull();
  });

  it("says so when everything is quiet", async () => {
    await open(undefined, { "tags/task.yaml": TASK_TAG });
    await waitFor(() => expect(screen.getByText("Nothing needs a look.")).toBeTruthy());
    expect(screen.queryByRole("region", { name: "Overdue" })).toBeNull();
  });

  it("gives a section its own words when it has nothing", async () => {
    await open(undefined, Object.fromEntries(Object.entries(SEED).filter(([path]) => !path.startsWith("inbox/"))));
    expect(within(card_("Captures to triage")).getByText("Nothing is waiting in the Inbox or among the captures.")).toBeTruthy();
  });

  it("marks a project reviewed from its row, and Undo puts the day back", async () => {
    await open(undefined);
    const row = await within(card_("Projects due for review")).findByRole("button", { name: "Mark Kiln reviewed" });
    await act(async () => fireEvent.click(row));
    await waitFor(async () => expect((await vault.read("projects/kiln/_project.md")).meta.props.last_review).toBe(TODAY));
    expect((await vault.read("projects/kiln/_project.md")).meta.props.review_after).toBeUndefined();
    await waitFor(() => expect(within(card_("Projects due for review")).getByText("No project is waiting for a review.")).toBeTruthy());
    useWorkspace.getState().toasts.at(-1)!.action!.run();
    await waitFor(async () => expect((await vault.read("projects/kiln/_project.md")).meta.props.review_after).toBe(dayFrom(-2)));
  });
});

describe("the weekly review", () => {
  it("looks a week back and a week ahead", async () => {
    await open("weekly");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Weekly review");
    await waitFor(() => expect(within(card_("Decisions")).getByText("Pick the clay")).toBeTruthy());
    expect(within(card_("Completed")).getByText("Mixed the glaze")).toBeTruthy();
    expect(card_("Due in the next 7 days")).toBeTruthy();
  });

  it("offers a reminder that is off until switched on, and keeps the choice", async () => {
    await open("weekly");
    const box = screen.getByRole("checkbox", { name: "Remind me to do the weekly review" }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect((screen.getByRole("combobox", { name: "Reminder day" }) as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(box);
    expect(currentReview().remind).toBe(true);
    fireEvent.change(screen.getByRole("combobox", { name: "Reminder day" }), { target: { value: "1" } });
    expect(currentReview()).toMatchObject({ remind: true, weekday: 1 });
    fireEvent.click(box);
    expect(currentReview().remind).toBe(false);
  });

  it("has no reminder for the daily review", async () => {
    await open("daily");
    expect(screen.queryByRole("group", { name: "Weekly reminder" })).toBeNull();
  });
});

describe("marking a review done, and saving it", () => {
  it("notes the day in this window, says no review has been done before, and Undo takes it back", async () => {
    await open("weekly");
    expect(screen.getByText(/No weekly review yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mark the weekly review done" }));
    expect(currentReview().last.weekly).toBe(TODAY);
    expect((screen.getByRole("button", { name: "Marked done today" }) as HTMLButtonElement).disabled).toBe(true);
    useWorkspace.getState().toasts.at(-1)!.action!.run();
    expect(currentReview().last.weekly).toBeNull();
  });

  it("words a review long ago as a date, not a failure", async () => {
    useReviewPrefs.getState().set("Browser preview", { last: { daily: null, weekly: dayFrom(-12) } });
    await open("weekly");
    expect(screen.getByText(/No weekly review since/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("saves a normal page only when asked, and not before", async () => {
    const calls = await open("weekly");
    await waitFor(() => expect(within(card_("Overdue")).getByText("Call the mason")).toBeTruthy());
    expect(calls).toEqual([]);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save as note" })));
    await waitFor(async () => expect((await vault.list()).some((n) => n.title === `Weekly review ${TODAY}`)).toBe(true));
    expect(calls.filter((c) => c === "create")).toHaveLength(1);
    const made = (await vault.list()).find((n) => n.title === `Weekly review ${TODAY}`)!;
    expect(made.kind).toBe("page");
    expect((await vault.read(made.path)).text).toContain("## Captures to triage (2)");
    expect(currentReview().last.weekly).toBe(TODAY);
  });
});

describe("the reminder on Home", () => {
  const banner = () => screen.queryByRole("status", { name: "Weekly review reminder" });

  async function home(prefs: Partial<ReviewPrefs>) {
    vault = new MemoryVault(SEED);
    useWorkspace.setState({ client: vault, ready: true, notes: await vault.list(), ...derive(initialLayout()), stack: [], recent: [], toasts: [] });
    useReviewPrefs.getState().set("Browser preview", prefs);
    render(<ReviewBanner />);
  }

  it("is not there while the reminder is off", async () => {
    await home({});
    expect(banner()).toBeNull();
  });

  it("shows once on, with the day of the last review in words, and Not today puts it off", async () => {
    // Every weekday has come by now if the reminder is set to today.
    await home({ remind: true, weekday: new Date().getDay() });
    const shown = await screen.findByRole("status", { name: "Weekly review reminder" });
    expect(shown.textContent).toContain("Time for the weekly review. No weekly review yet.");
    fireEvent.click(within(shown).getByRole("button", { name: "Not today" }));
    expect(banner()).toBeNull();
    expect(currentReview().snoozed).toBe(TODAY);
  });

  it("is quiet once the week's review is marked", async () => {
    await home({ remind: true, weekday: new Date().getDay(), last: { daily: null, weekly: TODAY } });
    expect(banner()).toBeNull();
  });

  it("starts the weekly review", async () => {
    await home({ remind: true, weekday: new Date().getDay() });
    fireEvent.click(within(await screen.findByRole("status", { name: "Weekly review reminder" })).getByRole("button", { name: "Start" }));
    expect(useWorkspace.getState().place).toEqual({ view: "reviews", path: "weekly" });
  });
});
