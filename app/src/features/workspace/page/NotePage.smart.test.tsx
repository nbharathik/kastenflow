// A page with `layout: smart` opens full width in its smart view, with a
// header that switches to its notes (the Markdown page) and to the history of
// its code; with smart pages turned off it is its Markdown with a line saying
// so. Layout `smart` is a layout value like the others: setting it changes one
// line of the file.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tauriSmartBackend } from "../../smart/backend";
import { forgetRunSwitch } from "../../smart/run-switch";
import { FakeObserver } from "../../smart/test-support/observer";
import { forgetSmartSides } from "../../smart/use-smart-side";
import { toggleSmartPage } from "../../pages/present/actions";
import { MemoryVault } from "../preview/memory-vault";
import { useWorkspace } from "../store";
import { NotePage } from "./NotePage";
import { readLayout } from "./page-layout";
import { flushOpenPage } from "./use-note-session";

const PATH = "library/tracker.md";
const SMART = "---\ntitle: Tracker\nid: 01JSMARTPAGE00000000000000\nlayout: smart\n---\nThe notes of the tracker.\n";
const PLAIN = "---\ntitle: Plain\nid: 01JPLAINPAGE00000000000000\n---\nJust words.\n";

let vault: MemoryVault;

/** The app, as far as a smart page asks it: it runs, nothing to allow, a view in the folder. */
function app({ running = true }: { running?: boolean } = {}) {
  (globalThis as unknown as { isTauri: boolean }).isTauri = true;
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  return {
    runEnabled: vi.spyOn(tauriSmartBackend, "runEnabled").mockResolvedValue(running),
    setRunEnabled: vi.spyOn(tauriSmartBackend, "setRunEnabled").mockResolvedValue(),
    trust: vi.spyOn(tauriSmartBackend, "trust").mockResolvedValue({ madeBy: null, needsAllow: false, allowed: false }),
    info: vi.spyOn(tauriSmartBackend, "info").mockResolvedValue({ id: "01JSMARTPAGE00000000000000", path: PATH, title: "Tracker", ready: true, height: null, maxHeight: null, problems: [], webImages: false, views: [] }),
    openFrame: vi.spyOn(tauriSmartBackend, "openFrame").mockResolvedValue("a".repeat(64)),
    closeFrame: vi.spyOn(tauriSmartBackend, "closeFrame").mockResolvedValue(),
    errors: vi.spyOn(tauriSmartBackend, "errors").mockResolvedValue({ records: [] }),
    history: vi.spyOn(tauriSmartBackend, "history").mockResolvedValue([]),
  };
}

async function open(text: string) {
  vault = new MemoryVault({ [PATH]: text });
  await useWorkspace.getState().connect({ client: vault });
  useWorkspace.getState().openPath(PATH);
  return render(<NotePage client={vault} path={PATH} />);
}

const page = () => document.querySelector<HTMLElement>(".kasten-page")!;
const editor = () => screen.findByTestId("page-editor", {}, { timeout: 30_000 });
const pressed = (name: string) => screen.getByRole("button", { name }).getAttribute("aria-pressed");

beforeEach(() => {
  localStorage.clear();
  FakeObserver.reset();
  forgetRunSwitch();
  forgetSmartSides();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (globalThis as unknown as { isTauri?: boolean }).isTauri;
});

describe("a page with layout smart", () => {
  it("opens in its smart view, full width, with no editor", async () => {
    const spies = app();
    await open(SMART);
    await waitFor(() => expect(page()?.classList.contains("is-smart-view")).toBe(true));
    // The view's code loads when the first smart page is opened.
    expect(await screen.findByRole("heading", { name: "Tracker" })).toBeTruthy();
    expect(["Smart", "Notes", "History"].map(pressed)).toEqual(["true", "false", "false"]);
    expect(screen.queryByTestId("page-editor")).toBeNull();
    // Its frame starts when it is in view, from a secret the app made.
    await waitFor(() => {
      FakeObserver.show(true);
      expect(document.querySelector("iframe")).not.toBeNull();
    });
    expect(spies.openFrame).toHaveBeenCalledWith(PATH);
    expect(document.querySelector("iframe")!.getAttribute("sandbox")).toBe("allow-scripts");
  }, 60_000);

  it("switches to its notes, which are the ordinary page, and back", async () => {
    const spies = app();
    await open(SMART);
    await waitFor(() => expect(page()?.classList.contains("is-smart-view")).toBe(true));
    await waitFor(() => {
      FakeObserver.show(true);
      expect(document.querySelector("iframe")).not.toBeNull();
    });
    fireEvent.click(await screen.findByRole("button", { name: "Notes" }));
    const notes = await editor();
    await expect.poll(() => notes.textContent, { timeout: 30_000 }).toContain("The notes of the tracker.");
    expect(page().classList.contains("is-smart-view")).toBe(false);
    expect(pressed("Notes")).toBe("true");
    // The frame went with the smart view.
    await waitFor(() => expect(spies.closeFrame).toHaveBeenCalled());
    expect(document.querySelector("iframe")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Smart" }));
    await waitFor(() => expect(page().classList.contains("is-smart-view")).toBe(true));
    // Looking at either side wrote nothing.
    await act(flushOpenPage);
    expect((await vault.read(PATH)).text).toBe(SMART);
  }, 90_000);

  it("shows the history of its code from the header", async () => {
    const spies = app();
    await open(SMART);
    await waitFor(() => expect(page()?.classList.contains("is-smart-view")).toBe(true));
    fireEvent.click(await screen.findByRole("button", { name: "History" }));
    expect(await screen.findByText(/No versions of this page’s code are kept yet/)).toBeTruthy();
    expect(spies.history).toHaveBeenCalledWith(PATH, 50);
    expect(document.querySelector("iframe")).toBeNull();
  }, 60_000);

  it("shows its Markdown and one line while smart pages are off, and the smart view again once they are on", async () => {
    const spies = app({ running: false });
    await open(SMART);
    const notes = await editor();
    await expect.poll(() => notes.textContent, { timeout: 30_000 }).toContain("The notes of the tracker.");
    expect(page().classList.contains("is-smart-view")).toBe(false);
    expect(screen.getByRole("status").textContent).toBe("Smart pages are off — Turn on");
    expect(screen.queryByRole("button", { name: "Smart" })).toBeNull();
    expect(spies.openFrame).not.toHaveBeenCalled();
    // The app answers "on" once the plugin is on; every page asks again after the switch.
    spies.runEnabled.mockResolvedValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(spies.setRunEnabled).toHaveBeenCalledWith(true));
    await waitFor(() => expect(page().classList.contains("is-smart-view")).toBe(true));
  }, 90_000);

  it("is a sentence in the preview, where smart pages cannot run, with its notes one click away", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    await open(SMART);
    expect(await screen.findByText(/open in the KastenFlow app/)).toBeTruthy();
    expect(document.querySelector("iframe")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    const notes = await editor();
    await expect.poll(() => notes.textContent, { timeout: 30_000 }).toContain("The notes of the tracker.");
  }, 90_000);

  it("leaves an ordinary page alone: no tabs, and the app is not asked about smart pages", async () => {
    const spies = app();
    await open(PLAIN);
    const plain = await editor();
    await expect.poll(() => plain.textContent, { timeout: 30_000 }).toContain("Just words.");
    expect(screen.queryByRole("group", { name: "Smart page" })).toBeNull();
    expect(spies.runEnabled).not.toHaveBeenCalled();
    expect(spies.trust).not.toHaveBeenCalled();
  }, 60_000);

  it("is made and unmade from the menu's toggle, with the page the same but for its layout line", async () => {
    app();
    await open(PLAIN);
    await editor();
    act(() => toggleSmartPage(useWorkspace.getState().notes.find((n) => n.path === PATH)!));
    await act(flushOpenPage);
    expect((await vault.read(PATH)).text).toContain("\nlayout: smart\n");
    await waitFor(() => expect(page()?.classList.contains("is-smart-view")).toBe(true));
    act(() => toggleSmartPage(useWorkspace.getState().notes.find((n) => n.path === PATH)!));
    await act(flushOpenPage);
    expect((await vault.read(PATH)).text).not.toContain("layout:");
  }, 90_000);
});

describe("the smart layout value", () => {
  it("is read from a page's frontmatter like the others", () => {
    expect(readLayout("---\nlayout: smart\n---\n")).toEqual({ layout: "smart" });
    expect(readLayout("---\nlayout: sections\n---\n")).toEqual({ layout: "sections" });
    expect(readLayout("---\nlayout: Smart\n---\n")).toEqual({});
  });
});
