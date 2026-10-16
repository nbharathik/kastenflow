// The optional editor download: the state of an install, what the notice
// offers, and where the editor's page is served from.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../../lib/api";
import { useSettingsJump } from "../workspace/views/settings/jump";
import { useWorkspace } from "../workspace/store";
import { InstallNotice } from "./InstallNotice";
import { EDITOR_CREDIT, editorPage, megabytes, originOf, setEditorBackend, useDiagramEditor, type EditorBackend, type EditorInfo, type InstallProgress } from "./editor";

const MISSING: EditorInfo = { version: "32.2.0", bytes: 48_235_802, url: "https://github.com/jgraph/drawio/releases/download/v32.2.0/draw.war", installed: false, busy: false };
const INSTALLED: EditorInfo = { ...MISSING, installed: true };

/** A backend whose install is finished by the test. */
function backend(first: EditorInfo = MISSING) {
  let info = first;
  let progress: (p: InstallProgress) => void = () => {};
  let finish: (how: "installed" | "cancelled") => void = () => {};
  let fail: (err: Error) => void = () => {};
  const calls: string[] = [];
  const b: EditorBackend = {
    status: async () => info,
    install(onProgress) {
      calls.push("install");
      progress = onProgress;
      return new Promise((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
    },
    cancel: async () => void calls.push("cancel"),
    remove: async () => {
      calls.push("remove");
      info = MISSING;
    },
  };
  return { b, calls, progress: (p: InstallProgress) => progress(p), finish: (how: "installed" | "cancelled" = "installed") => ((info = how === "installed" ? INSTALLED : info), finish(how)), fail: (m: string) => fail(new Error(m)) };
}

beforeEach(() => {
  useDiagramEditor.setState({ info: null, progress: null, error: null, installing: false });
});
afterEach(() => {
  cleanup();
  setEditorBackend(null);
  vi.restoreAllMocks();
});

describe("the editor's address", () => {
  it("reads an origin out of a page's address, in a form a message event says it", () => {
    expect(originOf("http://diagrams.localhost/index.html?x=1")).toBe("http://diagrams.localhost");
    expect(originOf("diagrams://localhost/index.html")).toBe("diagrams://localhost");
    expect(originOf("https://example.test:8443/a")).toBe("https://example.test:8443");
    expect(originOf("not a url")).toBe("null");
  });

  it("is none until the editor is installed, then the page the dev server's stand-in serves", () => {
    expect(editorPage()).toBeNull();
    useDiagramEditor.setState({ info: MISSING });
    expect(editorPage()).toBeNull();
    useDiagramEditor.setState({ info: INSTALLED });
    expect(editorPage()).toBe(`${window.location.origin}/diagrams-stub/index.html`);
  });

  it("names the size in whole megabytes and the credit as the licence asks", () => {
    expect(megabytes(48_235_802)).toBe("48 MB");
    expect(megabytes(10)).toBe("1 MB");
    expect(EDITOR_CREDIT).toBe("Diagram editor: draw.io (diagrams.net), Apache-2.0");
  });
});

describe("installing the editor", () => {
  it("reads whether it is installed", async () => {
    const { b } = backend();
    setEditorBackend(b);
    await useDiagramEditor.getState().refresh();
    expect(useDiagramEditor.getState().info).toEqual(MISSING);
  });

  it("follows an install from its first byte to the end, and asks again what is there", async () => {
    const t = backend();
    setEditorBackend(t.b);
    await useDiagramEditor.getState().refresh();
    const done = useDiagramEditor.getState().install();
    expect(useDiagramEditor.getState().installing).toBe(true);
    expect(useDiagramEditor.getState().progress).toEqual({ phase: "downloading", done: 0, total: MISSING.bytes });
    act(() => t.progress({ phase: "downloading", done: 1_000_000, total: MISSING.bytes }));
    expect(useDiagramEditor.getState().progress?.done).toBe(1_000_000);
    // A second click while one is going does nothing.
    await useDiagramEditor.getState().install();
    expect(t.calls).toEqual(["install"]);
    t.finish();
    await done;
    expect(useDiagramEditor.getState()).toMatchObject({ installing: false, progress: null, error: null, info: INSTALLED });
  });

  it("says why an install did not finish, and can be tried again", async () => {
    const t = backend();
    setEditorBackend(t.b);
    await useDiagramEditor.getState().refresh();
    const done = useDiagramEditor.getState().install();
    t.fail("The download did not match the pinned checksum, so it was not installed.");
    await done;
    expect(useDiagramEditor.getState()).toMatchObject({ installing: false, error: "The download did not match the pinned checksum, so it was not installed.", info: MISSING });
    const again = useDiagramEditor.getState().install();
    expect(useDiagramEditor.getState().error).toBeNull();
    t.finish("cancelled");
    await again;
    expect(useDiagramEditor.getState().info?.installed).toBe(false);
  });

  it("can be cancelled and removed", async () => {
    const t = backend(INSTALLED);
    setEditorBackend(t.b);
    await useDiagramEditor.getState().refresh();
    await useDiagramEditor.getState().cancel();
    await useDiagramEditor.getState().remove();
    expect(t.calls).toEqual(["cancel", "remove"]);
    expect(useDiagramEditor.getState().info?.installed).toBe(false);
  });
});

describe("the offer to install", () => {
  it("says what it is, how big, where from and the licence, and is not there once it is installed", async () => {
    setEditorBackend(backend().b);
    render(<InstallNotice />);
    const notice = await screen.findByRole("region", { name: "Diagram editor" });
    expect(notice.textContent).toContain("The diagram editor is not installed");
    expect(notice.textContent).toContain("48 MB download from github.com");
    expect(notice.textContent).toContain(EDITOR_CREDIT);
    act(() => useDiagramEditor.setState({ info: INSTALLED }));
    expect(screen.queryByRole("region", { name: "Diagram editor" })).toBeNull();
  });

  it("shows an install's progress and offers to cancel it", async () => {
    vi.spyOn(api, "inTauri").mockReturnValue(true);
    const t = backend();
    setEditorBackend(t.b);
    render(<InstallNotice />);
    const button = await screen.findByRole("button", { name: "Install diagram editor (48 MB)" });
    await act(async () => fireEvent.click(button));
    expect(screen.getByText("Installing the diagram editor")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Downloading 0 MB of 48 MB");
    act(() => t.progress({ phase: "downloading", done: 24_000_000, total: MISSING.bytes }));
    expect(screen.getByRole("status").textContent).toBe("Downloading 24 MB of 48 MB");
    act(() => t.progress({ phase: "verifying", done: MISSING.bytes, total: MISSING.bytes }));
    expect(screen.getByRole("status").textContent).toBe("Checking the download…");
    act(() => t.progress({ phase: "extracting", done: 5, total: 10 }));
    expect(screen.getByRole("status").textContent).toBe("Unpacking the editor…");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel" })));
    expect(t.calls).toContain("cancel");
    await act(async () => t.finish("cancelled"));
  });

  it("shows what went wrong, and offers to try again", async () => {
    vi.spyOn(api, "inTauri").mockReturnValue(true);
    const t = backend();
    setEditorBackend(t.b);
    render(<InstallNotice />);
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Install diagram editor (48 MB)" })));
    await act(async () => t.fail("The download did not match the pinned checksum, so it was not installed."));
    expect((await screen.findByRole("alert")).textContent).toContain("did not match the pinned checksum");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("says the preview cannot install, with no install button that does nothing", async () => {
    setEditorBackend(backend().b);
    render(<InstallNotice />);
    expect((await screen.findByRole("region", { name: "Diagram editor" })).textContent).toContain("Installing needs the desktop app");
    expect(screen.queryByRole("button", { name: /Install/ })).toBeNull();
    // Only the way to Settings is there.
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Diagram settings"]);
  });

  it("links to Settings, Diagrams, in a tab, at the editor's row", async () => {
    setEditorBackend(backend().b);
    useSettingsJump.setState({ target: null });
    render(<InstallNotice />);
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Diagram settings" })));
    expect(useSettingsJump.getState().target).toEqual({ group: "diagrams", row: "diagrams.editor" });
    const { layout } = useWorkspace.getState();
    expect(layout.panes.flatMap((p) => p.tabs.map((t) => t.place.view))).toContain("settings");
  });
});
