import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { longDay } from "../../lib/dates";
import { useShell } from "../../lib/store";
import type { MemoryVault } from "../workspace/preview/memory-vault";
import { usePeek } from "../peek/store";
import { CALENDAR_SHOW, usePrefs } from "../workspace/prefs";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout } from "../workspace/tabs";
import { addDays, monthTitle } from "./dates";
import { dayLabel, periodTitle } from "./layout";
import { cell, openCalendar as open, TASK_YAML, today, transfer } from "./test-kit";

const tomorrow = addDays(today, 1);

const task = (title: string, due: string, extra = "") => `---\ntitle: ${title}\ntags: [task]\nprops:\n  due: ${due}\n  status: Todo${extra}\n---\n${title}.\n`;

const SEED = {
  "tags/task.yaml": TASK_YAML,
  "library/ship.md": task("Ship", today),
  "library/plan.md": `---\ntitle: Plan\n---\n- [ ] Call the printer @${tomorrow}\n- [x] Old errand @${today}\n- [ ] Someday\n`,
  [`journal/${today.slice(0, 4)}/${today}.md`]: `---\ntitle: ${today}\ntype: journal\n---\nA good day.\n`,
};

let vault: MemoryVault;

async function openCalendar(seed: Record<string, string> = SEED) {
  vault = await open(seed);
}

const text = async (path: string) => (await vault.read(path)).text;

beforeEach(() => {
  localStorage.clear();
  usePeek.setState({ peek: null });
  usePrefs.setState({ calendarShow: CALENDAR_SHOW, peekMode: "center" });
  useWorkspace.setState({ client: null, ready: false, notes: [], ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  useShell.setState({ sidebarOpen: true, focusMode: false, paletteOpen: false, shortcutsOpen: false, panels: [], sourceOpen: false });
});
afterEach(cleanup);

describe("Calendar", () => {
  it("shows dated notes and dated to-dos on their days", async () => {
    await openCalendar();
    expect(within(cell(today)).getByRole("button", { name: "Ship" })).toBeTruthy();
    expect(screen.getByText("1 dated note")).toBeTruthy();
    // To-dos load after the notes; allow for a busy machine.
    const todo = await within(cell(tomorrow)).findByRole("button", { name: /Call the printer/ }, { timeout: 5000 });
    // Done to-dos and those without a day stay off the calendar.
    expect(screen.queryByText(/Old errand/)).toBeNull();
    expect(screen.queryByText(/Someday/)).toBeNull();
    // To-dos are not dragged: no op changes a to-do line's day.
    expect(todo.getAttribute("draggable")).toBe("false");
    expect(todo.getAttribute("title")).toMatch(/can’t be dragged/);
    // A click peeks at the page over the calendar.
    fireEvent.click(todo);
    expect(usePeek.getState().peek).toEqual({ path: "library/plan.md", mode: "center" });
    expect(useWorkspace.getState().place.view).toBe("calendar");
  });

  it("drags a note to another day, commits its new date, and undoes it", async () => {
    await openCalendar();
    const chip = within(cell(today)).getByRole("button", { name: "Ship" });
    const target = cell(tomorrow);
    const data = transfer();
    fireEvent.dragStart(chip, { dataTransfer: data });
    fireEvent.dragEnter(target, { dataTransfer: data });
    fireEvent.dragOver(target, { dataTransfer: data });
    expect(target.className).toContain("is-over");
    await act(async () => fireEvent.drop(target, { dataTransfer: data }));
    expect(within(cell(tomorrow)).getByRole("button", { name: "Ship" })).toBeTruthy();
    expect(target.className).not.toContain("is-over");
    await expect.poll(() => text("library/ship.md")).toContain(`  due: ${tomorrow}\n`);
    // Only the date changed: the status and the body are as they were.
    expect(await text("library/ship.md")).toContain("  status: Todo\n---\nShip.\n");
    expect(await screen.findByText(`Moved “Ship” to ${dayLabel(tomorrow, today)}`)).toBeTruthy();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Undo" })));
    await expect.poll(() => text("library/ship.md")).toContain(`  due: ${today}\n`);
    expect(within(cell(today)).getByRole("button", { name: "Ship" })).toBeTruthy();
    expect(await screen.findByText(`Moved “Ship” back to ${dayLabel(today, today)}`)).toBeTruthy();
  });

  it("puts a note back, with the core's reason, when the vault refuses the move", async () => {
    await openCalendar();
    vi.spyOn(vault, "updateProps").mockRejectedValue(new Error("Property “due” (date) must be a date, YYYY-MM-DD"));
    const data = transfer();
    fireEvent.dragStart(within(cell(today)).getByRole("button", { name: "Ship" }), { dataTransfer: data });
    fireEvent.dragOver(cell(tomorrow), { dataTransfer: data });
    await act(async () => fireEvent.drop(cell(tomorrow), { dataTransfer: data }));
    expect(await screen.findByText("Property “due” (date) must be a date, YYYY-MM-DD")).toBeTruthy();
    expect(within(cell(today)).getByRole("button", { name: "Ship" })).toBeTruthy();
    expect(within(cell(tomorrow)).queryByRole("button", { name: "Ship" })).toBeNull();
    expect(await text("library/ship.md")).toContain(`  due: ${today}\n`);
  });

  it("turns the page while a dragged note rests on ›, and drops it next week", async () => {
    await openCalendar();
    fireEvent.keyDown(window, { key: "w" });
    const chip = within(cell(today)).getByRole("button", { name: "Ship" });
    const data = transfer();
    fireEvent.dragStart(chip, { dataTransfer: data });
    const next = screen.getByRole("button", { name: "Next week" });
    fireEvent.dragEnter(next, { dataTransfer: data });
    fireEvent.dragOver(next, { dataTransfer: data });
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(periodTitle(addDays(today, 7), "week")), { timeout: 3000 });
    fireEvent.dragLeave(next, { dataTransfer: data });
    // The same weekday next week: always inside the week the page turned to (a day more is Monday after the week on a Sunday).
    const target = addDays(today, 7);
    await act(async () => fireEvent.drop(cell(target), { dataTransfer: data }));
    await expect.poll(() => text("library/ship.md")).toContain(`  due: ${target}\n`);
    expect(within(cell(target)).getByRole("button", { name: "Ship" })).toBeTruthy();
  });

  it("moves a focused note a day with Alt+→, writing once the keys pause", async () => {
    await openCalendar();
    const chip = within(cell(today)).getByRole("button", { name: "Ship" });
    chip.focus();
    await act(async () => {
      fireEvent.keyDown(chip, { key: "ArrowRight", altKey: true });
    });
    // Shown there at once, still focused, and the window's Alt+→ did not go Forward.
    const moved = within(cell(tomorrow)).getByRole("button", { name: "Ship" });
    expect(document.activeElement).toBe(moved);
    expect(useWorkspace.getState().place.view).toBe("calendar");
    await act(async () => {
      fireEvent.keyDown(moved, { key: "ArrowRight", altKey: true });
    });
    const twoDays = addDays(today, 2);
    expect(document.activeElement?.closest("[data-day]")?.getAttribute("data-day")).toBe(twoDays);
    await expect.poll(() => text("library/ship.md"), { timeout: 3000 }).toContain(`  due: ${twoDays}\n`);
    // One write for the run: the Undo goes back to where it started.
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Undo" })));
    await expect.poll(() => text("library/ship.md")).toContain(`  due: ${today}\n`);
  });

  it("writes a keyboard move still waiting for a pause when the view closes", async () => {
    await openCalendar();
    const chip = within(cell(today)).getByRole("button", { name: "Ship" });
    chip.focus();
    await act(async () => {
      fireEvent.keyDown(chip, { key: "ArrowRight", altKey: true });
    });
    act(() => useWorkspace.getState().go({ view: "home" }));
    // Sooner than the pause (KEY_PAUSE) would have written it.
    await expect.poll(() => text("library/ship.md"), { timeout: 400 }).toContain(`  due: ${tomorrow}\n`);
  });

  it("adds a task on a day without leaving the calendar", async () => {
    await openCalendar();
    const day = addDays(today, 2);
    fireEvent.click(within(cell(day)).getByRole("button", { name: `Add on ${longDay(day)}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Task/ }));
    const input = within(cell(day)).getByRole("textbox", { name: `New task on ${longDay(day)}` });
    fireEvent.change(input, { target: { value: "Buy stamps" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    await expect.poll(async () => (await vault.list()).find((n) => n.title === "Buy stamps")?.props).toEqual({ due: day, status: "Todo" });
    const note = (await vault.list()).find((n) => n.title === "Buy stamps")!;
    expect(note.tags).toEqual(["task"]);
    expect(await within(cell(day)).findByRole("button", { name: "Buy stamps" })).toBeTruthy();
    expect(useWorkspace.getState().place.view).toBe("calendar");
    expect(await screen.findByText(`Added “Buy stamps” on ${dayLabel(day, today)}`)).toBeTruthy();
    // The field stays for the next one, empty; Esc closes it.
    expect((input as HTMLInputElement).value).toBe("");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(within(cell(day)).queryByRole("textbox")).toBeNull();
    // A field left with words in it closes when the page turns.
    fireEvent.click(within(cell(day)).getByRole("button", { name: `Add on ${longDay(day)}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Task/ }));
    fireEvent.change(within(cell(day)).getByRole("textbox"), { target: { value: "Half a thought" } });
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(within(cell(day)).queryByRole("textbox")).toBeNull();
  });

  it("lists a busy day's first entries and shows the rest on request", async () => {
    const busy = addDays(today, 3);
    await openCalendar({ ...SEED, ...Object.fromEntries(["Alpha", "Bravo", "Charlie", "Delta"].map((t) => [`library/${t.toLowerCase()}.md`, task(t, busy)])) });
    const day = cell(busy);
    expect(within(day).getAllByRole("button", { name: /^(Alpha|Bravo|Charlie|Delta)$/ }).map((b) => b.querySelector(".kasten-cal-chip-title")?.textContent)).toEqual(["Alpha", "Bravo"]);
    const more = within(day).getByRole("button", { name: `2 more on ${longDay(busy)}` });
    expect(more.textContent).toBe("+2 more");
    fireEvent.click(more);
    const popover = screen.getByRole("dialog", { name: `Everything on ${longDay(busy)}` });
    expect(within(popover).getAllByRole("button", { name: /^(Alpha|Bravo|Charlie|Delta)$/ })).toHaveLength(4);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: `Everything on ${longDay(busy)}` })).toBeNull();
  });

  it("switches between month and week, and steps with the keys", async () => {
    await openCalendar();
    fireEvent.keyDown(window, { key: "w" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(periodTitle(today, "week"));
    expect(screen.getAllByRole("group", { name: /\d{4}$/ })).toHaveLength(7);
    expect(screen.getByRole("button", { name: "Week" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(periodTitle(addDays(today, 7), "week"));
    fireEvent.keyDown(window, { key: "t" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(periodTitle(today, "week"));
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    expect(screen.getAllByRole("group", { name: /\d{4}$/ })).toHaveLength(42);
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    // monthTitle counts months from 0, so this month's number is next month's index.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(monthTitle(Number(today.slice(0, 4)), Number(today.slice(5, 7))));
  });

  it("shows a day's journal over the calendar from its icon, its number or its free space", async () => {
    await openCalendar();
    expect(within(cell(tomorrow)).queryByRole("button", { name: /^Journal page for/ })).toBeNull();
    fireEvent.click(within(cell(today)).getByRole("button", { name: `Journal page for ${longDay(today)}` }));
    expect(usePeek.getState().peek?.path).toBe(`journal/${today.slice(0, 4)}/${today}.md`);
    await act(async () => usePeek.getState().close());
    // A day nobody wrote in peeks blank: looking makes nothing.
    fireEvent.click(within(cell(tomorrow)).getByRole("button", { name: `Journal for ${longDay(tomorrow)}` }));
    const day = `journal/${tomorrow.slice(0, 4)}/${tomorrow}.md`;
    expect(usePeek.getState().peek?.path).toBe(day);
    expect(useWorkspace.getState().place.view).toBe("calendar");
    const peek = await screen.findByRole("dialog", { name: "Page peek" });
    expect(within(peek).getByText("Nothing was written on this day.")).toBeTruthy();
    expect((await vault.list()).some((n) => n.path === day)).toBe(false);
    // Writing starts the page, there in the peek.
    await act(async () => fireEvent.click(within(peek).getByRole("button", { name: "Write in this day" })));
    await expect.poll(async () => (await vault.list()).some((n) => n.path === day)).toBe(true);
    await act(async () => usePeek.getState().close());
    // A click on a day's free space does the same; one on a chip opens the chip.
    const later = addDays(today, 2);
    fireEvent.click(cell(later));
    expect(usePeek.getState().peek?.path).toBe(`journal/${later.slice(0, 4)}/${later}.md`);
    await act(async () => usePeek.getState().close());
    fireEvent.click(within(cell(today)).getByRole("button", { name: "Ship" }));
    expect(usePeek.getState().peek?.path).toBe("library/ship.md");
  });

  it("adds a to-do to the day's journal, and a note or a page dated that day", async () => {
    await openCalendar();
    const day = addDays(today, 3);
    const add = (kind: RegExp) => {
      fireEvent.click(within(cell(day)).getByRole("button", { name: `Add on ${longDay(day)}` }));
      fireEvent.click(screen.getByRole("menuitem", { name: kind }));
    };
    add(/^To-do/);
    const todo = within(cell(day)).getByRole("textbox", { name: `New to-do on ${longDay(day)}` });
    fireEvent.change(todo, { target: { value: "Post the letter" } });
    await act(async () => fireEvent.keyDown(todo, { key: "Enter" }));
    const journal = `journal/${day.slice(0, 4)}/${day}.md`;
    await expect.poll(() => vault.list().then((all) => all.some((n) => n.path === journal))).toBe(true);
    await expect.poll(() => text(journal)).toContain(`- [ ] Post the letter @${day}\n`);
    // The next one goes on the same list.
    fireEvent.change(todo, { target: { value: "Water the plants" } });
    await act(async () => fireEvent.keyDown(todo, { key: "Enter" }));
    await expect.poll(() => text(journal)).toContain(`- [ ] Post the letter @${day}\n- [ ] Water the plants @${day}\n`);
    expect(await within(cell(day)).findByRole("button", { name: /Post the letter/ }, { timeout: 5000 })).toBeTruthy();
    fireEvent.keyDown(todo, { key: "Escape" });

    add(/^Note/);
    const card = within(cell(day)).getByRole("textbox", { name: `New note on ${longDay(day)}` });
    fireEvent.change(card, { target: { value: "Dentist at three" } });
    await act(async () => fireEvent.keyDown(card, { key: "Enter" }));
    await expect.poll(async () => (await vault.list()).find((n) => n.title === "Dentist at three")).toMatchObject({ kind: "card", props: { date: day } });
    expect(await within(cell(day)).findByRole("button", { name: "Dentist at three" })).toBeTruthy();
    fireEvent.keyDown(card, { key: "Escape" });

    // A page is for writing: it opens at once, over the calendar.
    add(/^Page/);
    const page = within(cell(day)).getByRole("textbox", { name: `New page on ${longDay(day)}` });
    fireEvent.change(page, { target: { value: "Trip plan" } });
    await act(async () => fireEvent.keyDown(page, { key: "Enter" }));
    await expect.poll(async () => (await vault.list()).find((n) => n.title === "Trip plan")).toMatchObject({ kind: "page", props: { date: day } });
    const made = (await vault.list()).find((n) => n.title === "Trip plan")!;
    await expect.poll(() => usePeek.getState().peek?.path).toBe(made.path);
    expect(within(cell(day)).queryByRole("textbox")).toBeNull();
  });

  it("puts what mentions a day on it, and Show chooses what the days show", async () => {
    await openCalendar({
      ...SEED,
      "library/notes.md": `---\ntitle: Meeting notes\ncreated: ${today}T09:00:00\n---\nFollow up on [[${tomorrow}]].\n`,
    });
    const mention = await within(cell(tomorrow)).findByRole("button", { name: "Meeting notes, mentions this day" });
    expect(mention.getAttribute("title")).toContain(`Follow up on [[${tomorrow}]].`);
    // Notes made on a day wait until they are asked for.
    expect(within(cell(today)).queryByRole("button", { name: /made this day/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Show/ }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /^Mentions/ }));
    expect(within(cell(tomorrow)).queryByRole("button", { name: /Meeting notes/ })).toBeNull();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /^Dated notes/ }));
    expect(within(cell(today)).queryByRole("button", { name: "Ship" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /^Journal/ }));
    expect(within(cell(today)).queryByRole("button", { name: /^Journal page for/ })).toBeNull();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /^Made that day/ }));
    expect(await within(cell(today)).findByRole("button", { name: "Meeting notes, made this day" })).toBeTruthy();
    // A preference of this window, kept for next time.
    expect(usePrefs.getState().calendarShow).toEqual({ journal: false, dated: false, tasks: true, mentions: false, made: true });
    expect(JSON.parse(localStorage.getItem("kasten.prefs") ?? "{}").calendarShow).toMatchObject({ dated: false, made: true });
    // Hidden things are still there: nothing says the calendar is empty.
    expect(screen.queryByText("Nothing on the calendar yet")).toBeNull();
  });

  it("lists the month's days in the agenda, with what is on each", async () => {
    await openCalendar();
    fireEvent.keyDown(window, { key: "a" });
    expect(screen.getByRole("button", { name: "Agenda" }).getAttribute("aria-pressed")).toBe("true");
    const agenda = screen.getByRole("region", { name: "Agenda" });
    const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
    const monthDays = new Date(y, m, 0).getDate();
    // This month starts at today; the days before it are a click away.
    const before = Number(today.slice(8)) - 1;
    expect(within(agenda).getAllByRole("group")).toHaveLength(monthDays - before);
    if (before > 0) fireEvent.click(within(agenda).getByRole("button", { name: /before today/ }));
    expect(within(agenda).getAllByRole("group")).toHaveLength(monthDays);
    expect(within(cell(today)).getByRole("button", { name: "Ship" })).toBeTruthy();
    expect(within(cell(today)).getByRole("button", { name: `Journal page for ${longDay(today)}` })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(monthTitle(y, m - 1));
    // The mode is remembered.
    expect(localStorage.getItem("kasten.calendar")).toBe("agenda");
  });

  it("explains itself when nothing has a date, and starts a task today", async () => {
    await openCalendar({ "tags/task.yaml": TASK_YAML, "library/plain.md": "---\ntitle: Plain\n---\nNo dates.\n" });
    expect(await screen.findByText("Nothing on the calendar yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New task today" }));
    expect(within(cell(today)).getByRole("textbox", { name: `New task on ${longDay(today)}` })).toBeTruthy();
  });
});
