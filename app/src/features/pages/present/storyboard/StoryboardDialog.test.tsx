// The storyboard dialog: the slides a page would make, changed here before any exists, then made in one go.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { DeckEngine, draftStoryboard, loadSlides } from "@kasten-slides/wasm";
import type { StoryEntry } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { useDecks } from "../../../slides/store";
import { MemoryVault } from "../../../workspace/preview/memory-vault";
import { useWorkspace } from "../../../workspace/store";
import { derive } from "../../../workspace/store-layout";
import { initialLayout } from "../../../workspace/tabs";
import { StoryboardDialog, StoryboardHost } from "./StoryboardDialog";
import { useStoryboard } from "./state";

beforeAll(async () => {
  await loadSlides(await readFile(join(import.meta.dirname, "../../../../../../packages/slides-wasm/pkg/slides_wasm_bg.wasm")));
});

const PATH = "projects/trip/pages/plan.md";
const PAGE = "## Plan\n\nBook early. Then pack.\n\n- flights\n- guesthouse\n\n## Budget\n\n- bed: 40\n\n## Photos\n\n![far](https://example.com/a.png)\n";

let vault: MemoryVault;
let entries: StoryEntry[];
/** The workspace's `openPath`, a spy. */
const openPath = () => useWorkspace.getState().openPath;

beforeEach(async () => {
  vault = new MemoryVault({ "projects/trip/_project.md": "---\ntitle: Trip\n---\n", [PATH]: `---\ntitle: Seaside trip\n---\n${PAGE}` });
  useWorkspace.setState({ client: vault, ready: true, notes: await vault.list(), ...derive(initialLayout()), recent: [], toasts: [], openPath: vi.fn() });
  useDecks.setState({ list: [], loaded: false });
  entries = draftStoryboard({ page: PATH, title: "Seaside trip", markdown: PAGE });
});
afterEach(() => {
  cleanup();
  useStoryboard.setState({ request: null });
});

const note = () => useWorkspace.getState().notes.find((n) => n.path === PATH)!;
const open = () => {
  useStoryboard.setState({ request: { note: note(), entries } });
  return render(<StoryboardDialog request={{ note: note(), entries }} />);
};
const slides = () => within(screen.getByRole("list", { name: "Slides" })).getAllByRole("listitem");
const titles = () => slides().map((row) => (within(row).getByRole("textbox", { name: /^Title of slide/ }) as HTMLInputElement).value);
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const read = async (path: string) => DeckEngine.open((await vault.deck(path)).text).deck;

describe("the rows", () => {
  it("are the slides the page would make, each with its title, point, evidence and notes", () => {
    open();
    expect(titles()).toEqual(["Plan", "Budget", "Photos"]);
    const first = slides()[0]!;
    expect((within(first).getByRole("textbox", { name: "Point of slide 1" }) as HTMLInputElement).value).toBe("Book early.");
    expect((within(first).getByRole("textbox", { name: "Evidence of slide 1" }) as HTMLTextAreaElement).value).toBe("- flights\n- guesthouse");
    expect(within(first).getByText("From Seaside trip › Plan")).toBeTruthy();
    expect(screen.getByText("3 slides after the title slide.")).toBeTruthy();
  });

  it("can be reordered with the buttons, which say which slide they move", () => {
    open();
    click("Move down: Plan");
    expect(titles()).toEqual(["Budget", "Plan", "Photos"]);
    click("Move up: Photos");
    expect(titles()).toEqual(["Budget", "Photos", "Plan"]);
    expect((screen.getByRole("button", { name: "Move up: Budget" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Move down: Plan" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("can be left out and put back, and are counted", () => {
    open();
    click("Leave out: Budget");
    expect(screen.getByText("2 slides after the title slide, 1 left out.")).toBeTruthy();
    expect(screen.getByText(/Left out: no slide is made/)).toBeTruthy();
    click("Put back: Budget");
    expect(screen.getByText("3 slides after the title slide.")).toBeTruthy();
  });

  it("can be rewritten: the title, the point, the evidence as text", () => {
    open();
    fireEvent.change(screen.getByRole("textbox", { name: "Title of slide 1" }), { target: { value: "The plan" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Point of slide 1" }), { target: { value: "Go early." } });
    fireEvent.change(screen.getByRole("textbox", { name: "Evidence of slide 1" }), { target: { value: "- one\n- two\n\n![x](assets/x.png)" } });
    expect(titles()[0]).toBe("The plan");
    expect((screen.getByRole("textbox", { name: "Point of slide 1" }) as HTMLInputElement).value).toBe("Go early.");
    // What is typed stays as typed, whatever it is read as.
    expect((screen.getByRole("textbox", { name: "Evidence of slide 1" }) as HTMLTextAreaElement).value).toBe("- one\n- two\n\n![x](assets/x.png)");
  });

  it("can be merged with the next, and the last cannot", () => {
    open();
    click("Merge Plan with the next slide");
    expect(titles()).toEqual(["Plan", "Photos"]);
    expect((within(slides()[0]!).getByRole("textbox", { name: "Evidence of slide 1" }) as HTMLTextAreaElement).value).toBe("- flights\n- guesthouse\n- bed: 40");
    expect(within(slides()[0]!).getByText("From Seaside trip › Plan + Seaside trip › Budget")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Merge Photos with the next slide" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("can be split where the cursor is in the evidence, and says what to do when it is not between items", () => {
    open();
    const box = screen.getByRole("textbox", { name: "Evidence of slide 1" }) as HTMLTextAreaElement;
    box.focus();
    box.setSelectionRange(0, 0);
    click("Split Plan at the cursor");
    expect(screen.getByRole("status").textContent).toContain("Put the cursor between two items");
    box.setSelectionRange("- flights\n".length, "- flights\n".length);
    click("Split Plan at the cursor");
    expect(titles()).toEqual(["Plan", "Plan (2)", "Budget", "Photos"]);
    expect((within(slides()[0]!).getByRole("textbox", { name: "Evidence of slide 1" }) as HTMLTextAreaElement).value).toBe("- flights");
    expect((within(slides()[1]!).getByRole("textbox", { name: "Evidence of slide 2" }) as HTMLTextAreaElement).value).toBe("- guesthouse");
    expect(within(slides()[1]!).getByText("Not from the page")).toBeTruthy();
  });
});

describe("making the deck", () => {
  it("makes it in the page's project from the rows that are not left out, and does not open it until the person has read what was left out", async () => {
    open();
    click("Leave out: Photos");
    fireEvent.change(screen.getByRole("textbox", { name: "Name of the deck" }), { target: { value: "Trip talk" } });
    await act(async () => void click("Make the deck"));
    const report = await screen.findByRole("region", { name: "What was made" });
    const [made] = await vault.decks();
    expect(made?.path).toBe("projects/trip/decks/trip-talk.deck");
    expect(made?.slides).toBe(3);
    expect(within(report).getByText(/Left out in the storyboard: Photos/)).toBeTruthy();
    expect(openPath()).not.toHaveBeenCalled();
  });

  it("opens the deck at once when there is nothing to report, and tells what it made", async () => {
    useStoryboard.setState({ request: { note: note(), entries: entries.slice(0, 2) } });
    render(<StoryboardDialog request={{ note: note(), entries: entries.slice(0, 2) }} />);
    await act(async () => void click("Make the deck"));
    await waitFor(() => expect(openPath()).toHaveBeenCalledWith("projects/trip/decks/seaside-trip.deck"));
    expect(useWorkspace.getState().toasts.map((t) => t.text).join(" ")).toContain("Made “Seaside trip” from 2 slides.");
    expect(useStoryboard.getState().request).toBeNull();
    const deck = await read("projects/trip/decks/seaside-trip.deck");
    expect(deck.slides).toHaveLength(3);
  });

  it("reports what the slides could not have before opening: a picture from the web, and what was left out here", async () => {
    open();
    click("Leave out: Budget");
    await act(async () => void click("Make the deck"));
    const report = await screen.findByRole("region", { name: "What was made" });
    expect(within(report).getByRole("list", { name: /Left out or not kept in step/ }).textContent).toContain("https://example.com/a.png");
    expect(within(report).getByText(/Left out in the storyboard: Budget/)).toBeTruthy();
    expect(openPath()).not.toHaveBeenCalled();
    fireEvent.click(within(report).getByRole("button", { name: "Open the deck" }));
    expect(openPath()).toHaveBeenCalledWith("projects/trip/decks/seaside-trip.deck");
    expect(useStoryboard.getState().request).toBeNull();
  });

  it("makes nothing when every slide is left out, and the page is never changed", async () => {
    open();
    for (const name of ["Plan", "Budget", "Photos"]) click(`Leave out: ${name}`);
    expect((screen.getByRole("button", { name: "Make the deck" }) as HTMLButtonElement).disabled).toBe(true);
    expect(await vault.decks()).toEqual([]);
    expect((await vault.read(PATH)).text).toBe(`---\ntitle: Seaside trip\n---\n${PAGE}`);
  });

  it("uses the template and the shape that were chosen", async () => {
    open();
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Template" }) as HTMLSelectElement).options.length).toBeGreaterThan(1));
    fireEvent.change(screen.getByRole("combobox", { name: "Template" }), { target: { value: "Dark" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Slide shape" }), { target: { value: "4:3" } });
    await act(async () => void click("Make the deck"));
    await screen.findByRole("region", { name: "What was made" });
    const [made] = await vault.decks();
    const deck = await read(made!.path);
    expect(deck.theme.name).toBe("Dark");
    expect(deck.size).toEqual({ w: 960, h: 720 });
  });
});

describe("the host", () => {
  it("shows the dialog only while it is asked for", () => {
    const { container } = render(<StoryboardHost />);
    expect(container.textContent).toBe("");
    act(() => useStoryboard.getState().show({ note: note(), entries }));
    expect(screen.getByRole("dialog", { name: "Make slides from this page" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useStoryboard.getState().request).toBeNull();
  });
});
