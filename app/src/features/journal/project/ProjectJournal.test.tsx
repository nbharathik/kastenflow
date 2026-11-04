import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addDays, dayFrom } from "../../../lib/dates";
import type { NoteMeta } from "../../../lib/vault/types";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { ProjectJournalButton } from "./JournalButton";
import { TodayStrip } from "./TodayStrip";

// The peek is a chunk of its own: this notes when something first loads it.
const chunk = vi.hoisted(() => ({ loaded: false }));
vi.mock("./ProjectJournalPeek", async (original) => {
  chunk.loaded = true;
  return await original();
});

const PROJECT = "projects/trip/_project.md";
const TODAY = dayFrom();
const SEED: Record<string, string> = {
  [PROJECT]: "---\ntitle: Seaside trip\ntype: project\n---\nPlans.\n",
  "projects/trip/journal/2026/2026-10-01.md": "---\ntitle: 2026-10-01\ntype: journal\n---\n- 09:00 Booked the ferry\n",
  "projects/trip/journal/2026/2026-10-02.md": "---\ntitle: 2026-10-02\ntype: journal\n---\n- 10:15 Packed\n",
  "projects/other/_project.md": "---\ntitle: Other thing\ntype: project\n---\n",
  "projects/other/journal/2026/2026-10-02.md": "---\ntitle: 2026-10-02\ntype: journal\n---\n- 08:00 Elsewhere\n",
  "journal/2026/2026-10-02.md": "---\ntitle: 2026-10-02\ntype: journal\n---\nMy own day.\n",
  "library/page.md": "---\ntitle: A page\n---\nText.\n",
};

let vault: MemoryVault;
let project: NoteMeta;

beforeEach(async () => {
  localStorage.clear();
  vault = new MemoryVault(SEED);
  project = (await vault.read(PROJECT)).meta;
  useWorkspace.setState({ place: { view: "home" }, back: [], forward: [], toasts: [] });
  await useWorkspace.getState().connect({ client: vault });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Types `words` into the box and presses Enter (a one-field form submits). */
const typeLine = (box: HTMLElement, words: string) => {
  fireEvent.change(box, { target: { value: words } });
  fireEvent.submit((box as HTMLInputElement).form!);
};

const openPeek = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Project journal" }));
  return screen.findByRole("dialog", { name: "Project journal" });
};

describe("the project journal button and peek", () => {
  // First: once loaded, the chunk stays loaded for the rest of the file.
  it("does not load the peek until the button is pressed", async () => {
    render(<ProjectJournalButton project={project} />);
    expect(chunk.loaded).toBe(false);
    await openPeek();
    expect(chunk.loaded).toBe(true);
  });

  it("opens a side peek with the project and today, and closes with the button, the close button and Escape", async () => {
    render(<ProjectJournalButton project={project} />);
    expect(screen.queryByRole("dialog", { name: "Project journal" })).toBeNull();
    const peek = await openPeek();
    expect(peek.textContent).toContain("Seaside trip");
    expect(await within(peek).findByText("Nothing written today yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Project journal" }));
    expect(screen.queryByRole("dialog", { name: "Project journal" })).toBeNull();

    await openPeek();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Project journal" })).toBeNull();

    await openPeek();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Project journal" })).toBeNull();
  });

  it("adds a timed entry through journalAppend once, keeps focus, and ignores an empty line", async () => {
    const append = vi.spyOn(vault, "journalAppend");
    render(<ProjectJournalButton project={project} />);
    const peek = await openPeek();
    const box = await within(peek).findByRole("textbox", { name: "Add an entry" });
    await waitFor(() => expect(document.activeElement).toBe(box));

    typeLine(box, "   ");
    await act(async () => {});
    expect(append).not.toHaveBeenCalled();

    typeLine(box, "Fixed the sort");
    await waitFor(() => expect(append).toHaveBeenCalledTimes(1));
    expect(append.mock.calls[0]![0]).toBe(TODAY);
    expect(append.mock.calls[0]![1]).toMatch(/^- \d{2}:\d{2} Fixed the sort$/);
    expect(append.mock.calls[0]![3]).toBe("trip");
    expect(await within(peek).findByText(/Fixed the sort/)).toBeTruthy();
    expect((box as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(box);
    // The day is a note of the project's journal, in the vault.
    expect((await vault.read(`projects/trip/journal/${TODAY.slice(0, 4)}/${TODAY}.md`)).text).toMatch(/- \d{2}:\d{2} Fixed the sort\n$/);
  });

  it("says so when the entry could not be added, and keeps the words", async () => {
    vi.spyOn(vault, "journalAppend").mockRejectedValue(new Error("The journal is locked"));
    render(<ProjectJournalButton project={project} />);
    const peek = await openPeek();
    const box = await within(peek).findByRole("textbox", { name: "Add an entry" });
    typeLine(box, "Try this");
    await waitFor(() => expect(useWorkspace.getState().toasts.some((t) => t.text.includes("Could not add the entry: The journal is locked"))).toBe(true));
    expect((box as HTMLInputElement).value).toBe("Try this");
  });

  it("lists earlier days, pages them with Show more, and opens one in the peek", async () => {
    const many: Record<string, string> = { ...SEED };
    for (let n = 1; n <= 35; n++) {
      const date = addDays("2026-08-01", n - 1);
      many[`projects/trip/journal/2026/${date}.md`] = `---\ntitle: ${date}\ntype: journal\n---\n- 12:00 Entry ${n}\n`;
    }
    vault = new MemoryVault(many);
    await useWorkspace.getState().connect({ client: vault });
    render(<ProjectJournalButton project={project} />);
    const peek = await openPeek();
    const days = await within(peek).findByRole("region", { name: "Earlier days" });
    await waitFor(() => expect(within(days).getAllByRole("listitem")).toHaveLength(30));
    fireEvent.click(within(days).getByRole("button", { name: "Show more" }));
    await waitFor(() => expect(within(days).queryByRole("button", { name: "Show more" })).toBeNull());
    expect(within(days).getAllByRole("listitem").length).toBeGreaterThan(30);

    fireEvent.click(within(days).getByRole("button", { name: /2026-10-01/ }));
    expect(await within(peek).findByText(/Booked the ferry/)).toBeTruthy();
    // An earlier day is looked at, not added to.
    expect(within(peek).queryByRole("textbox", { name: "Add an entry" })).toBeNull();
    fireEvent.click(within(peek).getByRole("button", { name: "Back to today" }));
    expect(await within(peek).findByRole("textbox", { name: "Add an entry" })).toBeTruthy();
  });

  it("opens the viewed day as a page, and copies a path link to it", async () => {
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    render(<ProjectJournalButton project={project} />);
    const peek = await openPeek();
    const days = await within(peek).findByRole("region", { name: "Earlier days" });
    fireEvent.click(await within(days).findByRole("button", { name: /2026-10-02/ }));
    await within(peek).findByText(/Packed/);

    fireEvent.click(within(peek).getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(write).toHaveBeenCalledWith("[[projects/trip/journal/2026/2026-10-02|2026-10-02]]"));

    await act(async () => fireEvent.click(within(peek).getByRole("button", { name: "Open as page" })));
    await waitFor(() => expect(useWorkspace.getState().place.path).toBe("projects/trip/journal/2026/2026-10-02.md"));
    expect(screen.queryByRole("dialog", { name: "Project journal" })).toBeNull();
  });
});

describe("Today in projects", () => {
  it("shows a chip for each project with a note on a vault day, and writes nothing", async () => {
    const save = vi.spyOn(vault, "saveBody");
    const append = vi.spyOn(vault, "journalAppend");
    const before = (await vault.read("journal/2026/2026-10-02.md")).text;
    render(<TodayStrip path="journal/2026/2026-10-02.md" />);
    const strip = await screen.findByRole("navigation", { name: "Today in projects" });
    expect(within(strip).getAllByRole("button").map((b) => b.textContent)).toEqual(["Other thing", "Seaside trip"]);
    fireEvent.click(within(strip).getByRole("button", { name: "Seaside trip" }));
    expect(useWorkspace.getState().place.path).toBe("projects/trip/journal/2026/2026-10-02.md");
    expect(save).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect((await vault.read("journal/2026/2026-10-02.md")).text).toBe(before);
  });

  it("shows nothing for a day no project wrote in, or for a page that is not a vault day", async () => {
    const { container, rerender } = render(<TodayStrip path="journal/2026/2026-10-05.md" />);
    await act(async () => {});
    expect(container.textContent).toBe("");
    rerender(<TodayStrip path="projects/trip/journal/2026/2026-10-02.md" />);
    await act(async () => {});
    expect(container.textContent).toBe("");
    rerender(<TodayStrip path="library/page.md" />);
    expect(container.textContent).toBe("");
  });
});
