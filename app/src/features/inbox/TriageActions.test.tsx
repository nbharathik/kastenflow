// Triage over captures, by its keys, against the preview vault as the fake
// client: putting a card off, archiving, reading states, a task, a
// collection, a board, the duplicate notice and the week view. Each action
// says what it did in a notice whose Undo takes it back (U presses it).

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dayFrom } from "../../lib/dates";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { derive } from "../workspace/store-layout";
import { useWorkspace } from "../workspace/store";
import { initialLayout } from "../workspace/tabs";
import { Inbox } from "./Inbox";

const CAPTURE_TAG = "name: capture\ncolor: blue\nproperties:\n  - {key: url, type: url}\n  - {key: site, type: text}\n  - {key: captured, type: date}\n  - {key: status, type: select, options: [New, Read, Filed]}\n  - {key: reading, type: select, options: [Unread, Reading, Finished]}\n";
const TASK_TAG = "name: task\ncolor: green\nproperties:\n  - {key: status, type: select, options: [Todo, Doing, Done]}\n  - {key: due, type: date}\n";

const iso = (daysAgo: number) => `${dayFrom(-daysAgo)}T09:00:00`;

function clip(title: string, url: string, daysAgo: number, extra = "") {
  const day = dayFrom(-daysAgo);
  return `---\ntitle: ${title}\ntype: card\ncreated: ${iso(daysAgo)}\ntags: [capture]\nurl: ${url}\nprops:\n  url: ${url}\n  site: example.com\n  captured: ${day}\n  status: New\n${extra}---\nWhat ${title} says.\n`;
}

const SEED: Record<string, string> = {
  "tags/capture.yaml": CAPTURE_TAG,
  "tags/task.yaml": TASK_TAG,
  "projects/pottery/_project.md": "---\ntitle: Pottery\ntype: project\n---\nThe studio.\n",
  "inbox/kiln.md": clip("Kiln guide", "https://example.com/kiln", 1),
  "inbox/plain.md": `---\ntitle: Plain thought\ntype: card\ncreated: ${iso(2)}\n---\nJust a thought.\n`,
  "library/old.md": clip("Old article", "https://example.com/old", 40),
};

let vault: MemoryVault;

async function start(seed: Record<string, string> = SEED) {
  vault = new MemoryVault(seed);
  useWorkspace.setState({ client: vault, ready: true, notes: await vault.list(), ...derive(initialLayout()), stack: [], recent: [], toasts: [] });
  const view = render(<Inbox triage />);
  await screen.findByRole("region", { name: "Triage" });
  return view;
}

const press = (key: string) => act(async () => void fireEvent.keyDown(window, { key }));
const heading = () => screen.getByRole("heading", { level: 2 }).textContent;
const notices = () => useWorkspace.getState().toasts.map((t) => t.text);
const props = async (path: string) => (await vault.read(path)).meta.props;

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("the queue triage works through", () => {
  it("is the Inbox and the unfiled captures, newest first", async () => {
    await start();
    expect(screen.getByText("1 of 3")).toBeTruthy();
    expect(heading()).toBe("Kiln guide");
    await press("j");
    expect(heading()).toBe("Plain thought");
    await press("j");
    expect(heading()).toBe("Old article");
    await press("k");
    expect(heading()).toBe("Plain thought");
  });
});

describe("the Inbox and its triage", () => {
  it("follow the place: Esc stops triage, and the Inbox without the triage path shows the list", async () => {
    const view = await start();
    await press("Escape");
    await waitFor(() => expect(screen.queryByRole("region", { name: "Triage" })).toBeNull());
    expect(screen.getByRole("button", { name: /^Triage 3$/ })).toBeTruthy();
    // Back to triage from the Inbox, then away again by the place alone.
    view.rerender(<Inbox triage={false} />);
    view.rerender(<Inbox triage />);
    await screen.findByRole("region", { name: "Triage" });
    view.rerender(<Inbox triage={false} />);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Triage" })).toBeNull());
  });
});

describe("the list around the card", () => {
  it("shows the cards in the queue with the one in front marked, and a click goes there", async () => {
    await start();
    const around = within(screen.getByRole("navigation", { name: "Around this card" }));
    expect(around.getAllByRole("button").map((b) => b.textContent)).toEqual([expect.stringContaining("Kiln guide"), expect.stringContaining("Plain thought"), expect.stringContaining("Old article")]);
    expect(around.getByRole("button", { current: true }).textContent).toContain("Kiln guide");
    fireEvent.click(around.getByRole("button", { name: /Old article/ }));
    expect(heading()).toBe("Old article");
    expect(within(screen.getByRole("navigation", { name: "Around this card" })).getByRole("button", { current: true }).textContent).toContain("Old article");
    expect(screen.getByText("3 of 3")).toBeTruthy();
  });
});

describe("putting a card off", () => {
  it("1 puts it off until tomorrow: it leaves the queue, and Undo (U) brings it back in front of you", async () => {
    await start();
    await press("1");
    const tomorrow = dayFrom(1);
    await waitFor(async () => expect((await props("inbox/kiln.md")).review_after).toBe(tomorrow));
    await waitFor(() => expect(heading()).toBe("Plain thought"));
    expect(screen.getByText("1 of 2")).toBeTruthy();
    expect(notices().at(-1)).toMatch(/^Put off “Kiln guide” until /);
    // The source address and the day it was caught are as they were.
    expect(await props("inbox/kiln.md")).toMatchObject({ url: "https://example.com/kiln", captured: dayFrom(-1) });

    await press("u");
    await waitFor(async () => expect((await props("inbox/kiln.md")).review_after).toBeUndefined());
    await waitFor(() => expect(heading()).toBe("Kiln guide"));
    expect(screen.getByText("1 of 3")).toBeTruthy();
  });

  it("2 and 3 put it off a week and a month", async () => {
    await start();
    await press("2");
    await waitFor(async () => expect((await props("inbox/kiln.md")).review_after).toBe(dayFrom(7)));
    await press("3");
    await waitFor(async () => expect((await props("inbox/plain.md")).review_after).toMatch(/^\d{4}-\d{2}-\d{2}$/));
    expect(String((await props("inbox/plain.md")).review_after) > dayFrom(27)).toBe(true);
  });

  it("leaves out a card put off to a later day, and has one back whose day has come", async () => {
    await start({ ...SEED, "inbox/kiln.md": clip("Kiln guide", "https://example.com/kiln", 1, `  review_after: ${dayFrom(-1)}\n`), "inbox/plain.md": SEED["inbox/plain.md"]!.replace("---\nJust", `props:\n  review_after: ${dayFrom(3)}\n---\nJust`) });
    expect(screen.getByText("1 of 2")).toBeTruthy();
    expect(heading()).toBe("Kiln guide");
  });

  it("L opens a picker with tomorrow, a week and a month, and takes a day typed in", async () => {
    await start();
    await press("l");
    const picker = await screen.findByRole("dialog", { name: "Put off until" });
    expect(within(picker).getAllByRole("option").map((o) => o.textContent?.replace(/\s+/g, " "))).toEqual([expect.stringContaining("Tomorrow"), expect.stringContaining("In a week"), expect.stringContaining("In a month")]);
    const day = dayFrom(10);
    fireEvent.change(within(picker).getByRole("textbox"), { target: { value: day } });
    await act(async () => fireEvent.keyDown(within(picker).getByRole("textbox"), { key: "Enter" }));
    await waitFor(async () => expect((await props("inbox/kiln.md")).review_after).toBe(day));
  });
});

describe("reading", () => {
  it("R steps Unread, Reading, Finished and back to nothing, apart from where the card is filed", async () => {
    await start();
    const state = async () => (await props("inbox/kiln.md")).reading;
    await press("r");
    await waitFor(async () => expect(await state()).toBe("Unread"));
    await press("r");
    await waitFor(async () => expect(await state()).toBe("Reading"));
    await press("r");
    await waitFor(async () => expect(await state()).toBe("Finished"));
    await press("r");
    await waitFor(async () => expect(await state()).toBeUndefined());
    // It never moved, never changed its status, and kept its address and day.
    expect((await vault.read("inbox/kiln.md")).meta.path).toBe("inbox/kiln.md");
    expect(await props("inbox/kiln.md")).toMatchObject({ status: "New", url: "https://example.com/kiln", captured: dayFrom(-1) });
  });

  it("has a button for each state, and pressing the one that is on clears it", async () => {
    await start();
    fireEvent.click(screen.getByRole("button", { name: "Reading" }));
    await waitFor(async () => expect((await props("inbox/kiln.md")).reading).toBe("Reading"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reading" }).getAttribute("aria-pressed")).toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: "Reading" }));
    await waitFor(async () => expect((await props("inbox/kiln.md")).reading).toBeUndefined());
  });
});

describe("archiving", () => {
  it("A files a capture in the Inbox away: status Filed, out of the Inbox, and Undo puts it back", async () => {
    await start();
    await press("a");
    await waitFor(async () => expect((await vault.list()).find((n) => n.title === "Kiln guide")?.path).toBe("library/kiln.md"));
    expect(await props("library/kiln.md")).toMatchObject({ status: "Filed", url: "https://example.com/kiln" });
    await waitFor(() => expect(heading()).toBe("Plain thought"));
    expect(notices().at(-1)).toBe("Archived “Kiln guide”");

    await press("u");
    await waitFor(async () => expect((await vault.list()).find((n) => n.title === "Kiln guide")?.path).toBe("inbox/kiln.md"));
    expect((await props("inbox/kiln.md")).status).toBe("New");
  });

  it("A leaves a capture that is not in the Inbox where it is, marked Filed", async () => {
    await start();
    await press("j");
    await press("j");
    expect(heading()).toBe("Old article");
    await press("a");
    await waitFor(async () => expect((await props("library/old.md")).status).toBe("Filed"));
    expect((await vault.list()).some((n) => n.path === "library/old.md")).toBe(true);
    await waitFor(() => expect(screen.getByText(/of 2$/)).toBeTruthy());
  });

  it("A moves a plain Inbox card to Pages and changes no property", async () => {
    await start();
    await press("j");
    expect(heading()).toBe("Plain thought");
    await press("a");
    await waitFor(async () => expect((await vault.list()).find((n) => n.title === "Plain thought")?.path).toBe("library/plain.md"));
    expect(await props("library/plain.md")).toEqual({});
  });
});

describe("making a task", () => {
  it("N makes a task note that links the card, and leaves the card in front of you; Undo trashes the task", async () => {
    await start();
    await press("n");
    await waitFor(async () => expect((await vault.list()).some((n) => n.title === "Follow up: Kiln guide")).toBe(true));
    const task = (await vault.list()).find((n) => n.title === "Follow up: Kiln guide")!;
    expect(task.tags).toContain("task");
    expect(task.props.status).toBe("Todo");
    expect((await vault.read(task.path)).text).toContain("[[Kiln guide]]");
    expect(heading()).toBe("Kiln guide");
    expect(notices().at(-1)).toBe("Made the task “Follow up: Kiln guide” from “Kiln guide”");

    await press("u");
    await waitFor(async () => expect((await vault.list()).some((n) => n.title === "Follow up: Kiln guide")).toBe(false));
  });
});

describe("adding to a collection", () => {
  async function startWithCollections() {
    await start();
    await vault.createCollection("Reading list", { query: "#reading #papers" });
    await vault.createCollection("Hot topics", { query: "kiln glaze" });
  }

  it("C lists them: a collection of tags can be joined, one with words says why not", async () => {
    await startWithCollections();
    await press("c");
    const picker = await screen.findByRole("dialog", { name: "Add to collection" });
    expect((await within(picker).findByRole("option", { name: /Hot topics/ })).getAttribute("aria-disabled")).toBe("true");
    expect(within(picker).getByRole("option", { name: /Reading list/ }).getAttribute("aria-disabled")).toBeNull();
    expect(picker.textContent).toContain("A search: cards match it");
    expect(picker.textContent).toContain("#reading #papers");
  });

  it("picking one gives the card its tags, and Undo takes only those away", async () => {
    await startWithCollections();
    await press("c");
    const picker = await screen.findByRole("dialog", { name: "Add to collection" });
    await act(async () => fireEvent.click(await within(picker).findByRole("option", { name: /Reading list/ })));
    await waitFor(async () => expect((await vault.read("inbox/kiln.md")).meta.tags).toEqual(["capture", "reading", "papers"]));
    expect(notices().at(-1)).toBe("Added “Kiln guide” to “Reading list” (tagged #reading #papers)");
    await press("u");
    await waitFor(async () => expect((await vault.read("inbox/kiln.md")).meta.tags).toEqual(["capture"]));
  });
});

describe("adding to a board", () => {
  it("B puts the card on a board, and Undo takes the new card off it, not the note", async () => {
    await start();
    const board = await vault.createBoard("Studio", null);
    await press("b");
    await act(async () => fireEvent.click(await screen.findByRole("option", { name: /Studio/ })));
    await waitFor(async () => expect((await vault.board(board)).nodes.length).toBe(1));
    expect(notices().at(-1)).toBe("Added to “Studio”");
    await press("u");
    await waitFor(async () => expect((await vault.board(board)).nodes.length).toBe(0));
    expect((await vault.list()).some((n) => n.path === "inbox/kiln.md")).toBe(true);
  });
});

describe("a page saved before", () => {
  const twice = { ...SEED, "library/kiln-before.md": clip("Kiln guide, an earlier copy", "https://www.example.com/kiln?utm_source=feed", 30) };

  it("says so over the card, with the day and a way to open it", async () => {
    await start(twice);
    const notice = await screen.findByRole("note", { name: "Already saved" });
    expect(notice.textContent).toContain(`Already saved on ${dayFrom(-30)}`);
    fireEvent.click(within(notice).getByRole("button", { name: /^Open/ }));
    expect(useWorkspace.getState().place).toMatchObject({ view: "page", path: "library/kiln-before.md" });
    // Snapshots need the desktop app: the preview offers none.
    expect(within(notice).queryByRole("button", { name: "Save another snapshot" })).toBeNull();
  });

  it("says nothing for a card no other card shares an address with", async () => {
    await start();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("note", { name: "Already saved" })).toBeNull();
  });
});

describe("the card's source", () => {
  it("says where and when it was caught, and links the page", async () => {
    await start();
    expect(screen.getByText(/^Captured .* from example\.com$/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open the page" }).getAttribute("title")).toBe("https://example.com/kiln");
  });

  it("links only a web address: a note edited by hand may say anything", async () => {
    await start({ ...SEED, "inbox/kiln.md": clip("Kiln guide", "javascript:alert(1)", 1) });
    expect(screen.queryByRole("button", { name: "Open the page" })).toBeNull();
  });
});

describe("the week", () => {
  it("W shows only what was caught in the last seven days", async () => {
    await start();
    await press("w");
    expect(screen.getByRole("button", { name: /^This week 2$/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("1 of 2")).toBeTruthy();
    await press("j");
    await press("j");
    expect(heading()).toBe("Plain thought");
    await press("w");
    expect(screen.getByRole("button", { name: /^All 3$/ }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("Enter", () => {
  it("opens the card, but on a button it presses that button", async () => {
    await start();
    const button = screen.getByRole("button", { name: /Plain thought/ });
    button.focus();
    await act(async () => void fireEvent.keyDown(button, { key: "Enter" }));
    expect(useWorkspace.getState().place.view).not.toBe("page");
    await act(async () => void fireEvent.keyDown(window, { key: "Enter" }));
    expect(useWorkspace.getState().place).toMatchObject({ view: "page", path: "inbox/kiln.md" });
  });
});

describe("the help line", () => {
  it("lists the keys, and keys typed into a field are not triage's", async () => {
    await start();
    const section = screen.getByRole("region", { name: "Triage" });
    for (const word of ["archive", "later", "task", "collection", "reading", "undo"]) expect(section.textContent).toContain(word);
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    await act(async () => void fireEvent.keyDown(field, { key: "a", bubbles: true }));
    expect((await vault.list()).some((n) => n.path === "inbox/kiln.md")).toBe(true);
    field.remove();
  });
});
