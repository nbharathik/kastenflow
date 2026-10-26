// A smart page opened on its own: full width, a header that switches between
// its smart view, its notes and the history of its code, the "Allow to run"
// card, and the page's option to show pictures from the web.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SmartPage } from "./SmartPage";
import { FakeBackend } from "./test-support/fake-frame";
import { FakeObserver } from "./test-support/observer";
import type { SmartSide } from "./use-smart-side";
import { PICTURES_WARNING } from "./words";

const PAGE = "library/conference-tracker.md";

function mount(backend: FakeBackend, side: SmartSide = "smart") {
  const onSide = vi.fn();
  const view = render(<SmartPage pagePath={PAGE} pageId="01SMART" title="Conference tracker" side={side} onSide={onSide} backend={backend} />);
  return { ...view, onSide };
}

async function frameOf(container: HTMLElement) {
  await waitFor(() => {
    FakeObserver.show(true);
    expect(container.querySelector("iframe")).not.toBeNull();
  });
  return container.querySelector("iframe")!;
}

beforeEach(() => {
  localStorage.clear();
  FakeObserver.reset();
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the header", () => {
  it("names the page and switches between Smart, Notes and History", async () => {
    const { onSide } = mount(new FakeBackend());
    expect(screen.getByRole("heading", { name: "Conference tracker" })).toBeTruthy();
    const group = screen.getByRole("group", { name: "Smart page" });
    const pressed = (name: string) => screen.getByRole("button", { name }).getAttribute("aria-pressed");
    expect(["Smart", "Notes", "History"].map(pressed)).toEqual(["true", "false", "false"]);
    expect(group.querySelectorAll("button")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    expect(onSide).toHaveBeenLastCalledWith("notes");
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(onSide).toHaveBeenLastCalledWith("history");
  });

  it("can be used from the keyboard alone", async () => {
    const { onSide } = mount(new FakeBackend());
    const notes = screen.getByRole("button", { name: "Notes" });
    notes.focus();
    expect(document.activeElement).toBe(notes);
    // A real button: Enter and Space press it.
    fireEvent.click(notes, { detail: 0 });
    expect(onSide).toHaveBeenCalledWith("notes");
    expect(screen.getByRole("button", { name: "Reload this page" })).toBeTruthy();
  });
});

describe("its smart view", () => {
  it("fills the room it has, loaded from the page's own folder", async () => {
    const backend = new FakeBackend();
    const { container } = mount(backend);
    const frame = await frameOf(container);
    expect(frame.getAttribute("src")).toMatch(/\/01SMART\/index\.html$/);
    expect(frame.style.height).toBe("");
    expect(container.querySelector(".kasten-smart")!.getAttribute("data-fill")).toBe("true");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  });

  it("loads again from the Reload button, under a new secret", async () => {
    const backend = new FakeBackend();
    const { container } = mount(backend);
    await frameOf(container);
    fireEvent.click(screen.getByRole("button", { name: "Reload this page" }));
    await waitFor(() => {
      FakeObserver.show(true);
      expect(backend.made).toHaveLength(2);
    });
    expect(backend.closed).toEqual([backend.made[0]]);
  });

  it("waits for Allow to run when an agent made it, and runs nothing before", async () => {
    const backend = new FakeBackend();
    backend.trustOf = { madeBy: "claude-code", needsAllow: true, allowed: false };
    const { container } = mount(backend);
    expect(await screen.findByText("Made by Claude Code")).toBeTruthy();
    FakeObserver.show(true);
    expect(container.querySelector("iframe")).toBeNull();
    expect(backend.made).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Allow to run" }));
    await frameOf(container);
    expect(backend.allowed).toEqual([PAGE]);
    expect(screen.queryByText("Made by Claude Code")).toBeNull();
  });

  it("says what allowing covers, and, with History off, that nobody can tell who made the page", async () => {
    const backend = new FakeBackend();
    backend.trustOf = { madeBy: null, unknownMaker: true, needsAllow: true, allowed: false };
    const { container } = mount(backend);
    expect(await screen.findByText("Not known who made this")).toBeTruthy();
    const note = container.querySelector(".kasten-smart-allow-note")!.textContent!;
    // Allowing covers the code from now on, also what an agent adds later; and why the maker is unknown.
    expect(note).toContain("also what an agent adds to it later");
    expect(note).toContain("History is off");
    expect(container.querySelector("iframe")).toBeNull();
    // A page an agent made says who, and does not mention History.
    cleanup();
    const known = new FakeBackend();
    known.trustOf = { madeBy: "claude-code", needsAllow: true, allowed: false };
    const again = mount(known);
    await screen.findByText("Made by Claude Code");
    expect(again.container.querySelector(".kasten-smart-allow-note")!.textContent).not.toContain("History is off");
  });

  it("says when there is no view yet, offers the notes, and lists what is wrong", async () => {
    const backend = new FakeBackend();
    backend.pageInfo = { ready: false, problems: ["The folder has no index.html, so there is nothing to show."] };
    const { onSide, container } = mount(backend);
    expect(await screen.findByText(/has no view yet/)).toBeTruthy();
    expect(container.textContent).toContain("nothing to show");
    fireEvent.click(screen.getByRole("button", { name: "Show its notes" }));
    expect(onSide).toHaveBeenCalledWith("notes");
  });

  it("is a sentence outside the app", () => {
    const { container } = render(<SmartPage pagePath={PAGE} pageId="01SMART" title="Tracker" side="smart" onSide={() => {}} />);
    expect(container.textContent).toContain("open in the KastenFlow app");
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reload this page" })).toBeNull();
  });
});

describe("pictures from the web", () => {
  it("is a box with a plain warning, off until a person ticks it, and the page loads again when it is", async () => {
    const backend = new FakeBackend();
    const { container } = mount(backend);
    await frameOf(container);
    fireEvent.click(screen.getByRole("button", { name: /Page options/ }));
    const box = screen.getByRole("checkbox", { name: "Allow pictures from the web" }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    // The warning says what the leave means, in a person's words.
    const warning = screen.getByText(PICTURES_WARNING);
    expect(warning.textContent).toContain("what the page has read, to any site");
    expect(warning.textContent).toContain("until the page's files change");
    // The box and its warning are tied together for a screen reader.
    expect(box.getAttribute("aria-describedby")).toBe(warning.id);
    expect(warning.textContent).toContain("picture's address");
    fireEvent.click(box);
    await waitFor(() => expect(backend.webImagesSet).toEqual([true]));
    await waitFor(() => expect((screen.getByRole("checkbox", { name: "Allow pictures from the web" }) as HTMLInputElement).checked).toBe(true));
    await waitFor(() => {
      FakeObserver.show(true);
      expect(backend.made).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow pictures from the web" }));
    await waitFor(() => expect(backend.webImagesSet).toEqual([true, false]));
  });

  it("says why when the choice could not be kept", async () => {
    const backend = new FakeBackend();
    backend.setWebImages = async () => {
      throw new Error("KastenFlow has no place to keep this choice.");
    };
    const { container } = mount(backend);
    await frameOf(container);
    fireEvent.click(screen.getByRole("button", { name: /Page options/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow pictures from the web" }));
    expect((await screen.findByRole("alert")).textContent).toContain("no place to keep this choice");
    expect((screen.getByRole("checkbox", { name: "Allow pictures from the web" }) as HTMLInputElement).checked).toBe(false);
  });
});

describe("its history", () => {
  it("shows the versions of the page's code in place of the view, and no frame runs", async () => {
    const backend = new FakeBackend();
    backend.versions = [
      { id: "c2", summary: "edit: Conference tracker (app.js)", message: "edit: Conference tracker (app.js)", author: "Bharathi", time: Date.now() - 60_000, agent: false, session: null, op: null, approvedBy: null, mode: null, undoes: null, merge: false },
    ];
    const { container } = mount(backend, "history");
    expect(await screen.findByRole("list", { name: "Versions of this page’s code" })).toBeTruthy();
    expect(container.querySelector("iframe")).toBeNull();
    expect(backend.made).toEqual([]);
  });
});
