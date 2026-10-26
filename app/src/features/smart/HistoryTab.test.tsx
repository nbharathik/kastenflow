// The History of a smart page's code: the versions that changed its folder,
// each file's change drawn with the review feed's diff, and "Restore this
// version", which is a new version on top and never a rewrite.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChangedFile, CommitInfo } from "../../lib/vault/types";
import { useWorkspace } from "../workspace/store";
import { HistoryTab, versionWords } from "./HistoryTab";
import { FakeBackend } from "./test-support/fake-frame";

const PAGE = "library/conference-tracker.md";
const DIR = "library/conference-tracker.smart";

const commit = (id: string, summary: string, extra: Partial<CommitInfo> = {}): CommitInfo => ({
  id,
  summary,
  message: summary,
  author: "Bharathi",
  time: Date.now() - 3_600_000,
  agent: false,
  session: null,
  op: null,
  approvedBy: null,
  mode: null,
  undoes: null,
  merge: false,
  ...extra,
});

const NEWEST = commit("c3", "edit: Conference tracker (app.js)", { agent: true, author: "agent:claude-code", time: Date.now() - 60_000 });
const MIDDLE = commit("c2", "edit: Conference tracker (index.html)");
const FIRST = commit("c1", "edit: Conference tracker (smart.yaml)");

const CHANGES: Record<string, ChangedFile[]> = {
  c3: [
    { path: `${DIR}/app.js`, before: "let a = 1;\nlet b = 2;\n", after: "let a = 1;\nlet b = 3;\n" },
    // A change to the page's notes, or to another page's folder, is not part of this page's code.
    { path: PAGE, before: "old", after: "new" },
    { path: "library/other.smart/app.js", before: "x", after: "y" },
  ],
  c2: [
    { path: `${DIR}/index.html`, before: null, after: "<p>New</p>\n" },
    { path: `${DIR}/assets/p.png`, before: null, after: null },
  ],
  c1: [],
};

function mount(backend: FakeBackend, onRestored = vi.fn()) {
  const changes = vi.fn(async (rev: string) => CHANGES[rev] ?? []);
  const view = render(<HistoryTab pagePath={PAGE} backend={backend} changes={changes} onRestored={onRestored} />);
  return { ...view, changes, onRestored };
}

beforeEach(() => useWorkspace.setState({ toasts: [] }));
afterEach(cleanup);

describe("versionWords", () => {
  it("names the file a version changed, in plain words", () => {
    expect(versionWords("edit: Conference tracker (app.js)")).toBe("Edited app.js");
    expect(versionWords("trash: app.js of Conference tracker")).toContain("app.js");
    expect(versionWords("something odd")).toBe("something odd");
  });
});

describe("the list of versions", () => {
  it("lists them newest first, says who an agent was, and starts on the newest", async () => {
    const backend = new FakeBackend();
    backend.versions = [NEWEST, MIDDLE, FIRST];
    mount(backend);
    const list = await screen.findByRole("list", { name: "Versions of this page’s code" });
    const rows = within(list).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("Edited app.js · claude-code"), expect.stringContaining("Edited index.html"), expect.stringContaining("Edited smart.yaml")]);
    expect(rows[0]!.getAttribute("aria-current")).toBe("true");
  });

  it("shows the newest fifty and Show older versions reaches the rest", async () => {
    const backend = new FakeBackend();
    backend.versions = Array.from({ length: 120 }, (_, n) => commit(`c${n}`, `edit: Conference tracker (file${n}.js)`));
    mount(backend);
    const list = await screen.findByRole("list", { name: "Versions of this page’s code" });
    expect(within(list).getAllByRole("button").filter((b) => b.textContent !== "Show older versions")).toHaveLength(50);
    fireEvent.click(within(list).getByRole("button", { name: "Show older versions" }));
    await waitFor(() => expect(within(list).getAllByRole("button").filter((b) => b.textContent !== "Show older versions")).toHaveLength(100));
    fireEvent.click(within(list).getByRole("button", { name: "Show older versions" }));
    await waitFor(() => expect(within(list).getAllByRole("button").filter((b) => b.textContent !== "Show older versions")).toHaveLength(120));
    expect(backend.askedFor).toBe(150);
    // Nothing more to ask for: every version is shown.
    expect(within(list).queryByRole("button", { name: "Show older versions" })).toBeNull();
  });

  it("says what to do when there are none", async () => {
    mount(new FakeBackend());
    expect(await screen.findByText(/No versions of this page’s code are kept yet/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check History in Settings" })).toBeTruthy();
  });

  it("says one sentence when the history cannot be read", async () => {
    const backend = new FakeBackend();
    backend.history = async () => {
      throw new Error("History is busy");
    };
    mount(backend);
    expect(await screen.findByText(/could not be read: History is busy/)).toBeTruthy();
  });
});

describe("a version's files", () => {
  it("draws each file of the folder with the diff, and leaves out other files", async () => {
    const backend = new FakeBackend();
    backend.versions = [NEWEST, MIDDLE, FIRST];
    const { changes } = mount(backend);
    const table = await screen.findByRole("table", { name: "Changes to app.js" });
    expect(table.textContent).toContain("let b = 3;");
    expect(table.textContent).toContain("let b = 2;");
    expect(changes).toHaveBeenCalledWith("c3");
    // The page itself, and another page's folder, are no part of this page's code.
    expect(screen.queryByRole("table", { name: /conference-tracker\.md|other/ })).toBeNull();
    expect(document.body.textContent).not.toContain("library/other.smart");
  });

  it("marks a file that was added, and says when a file has no text to show", async () => {
    const backend = new FakeBackend();
    backend.versions = [NEWEST, MIDDLE, FIRST];
    mount(backend);
    fireEvent.click(await screen.findByRole("button", { name: /Edited index\.html/ }));
    expect(await screen.findByRole("table", { name: "Changes to index.html" })).toBeTruthy();
    expect(screen.getByText("added")).toBeTruthy();
    expect(screen.getByText("assets/p.png")).toBeTruthy();
    expect(screen.getByText("No text to show for this file.")).toBeTruthy();
  });

  it("says so when none of the folder's files changed", async () => {
    const backend = new FakeBackend();
    backend.versions = [NEWEST, FIRST];
    mount(backend);
    fireEvent.click(await screen.findByRole("button", { name: /Edited smart\.yaml/ }));
    expect(await screen.findByText(/No files of the page’s code changed/)).toBeTruthy();
  });

  it("says one sentence when a change cannot be read", async () => {
    const backend = new FakeBackend();
    backend.versions = [NEWEST];
    render(<HistoryTab pagePath={PAGE} backend={backend} changes={async () => Promise.reject(new Error("No such commit"))} onRestored={() => {}} />);
    expect(await screen.findByText(/Could not read this change: No such commit/)).toBeTruthy();
  });
});

describe("Restore this version", () => {
  it("puts an earlier version back as a new one, tells the page to load again, and says so", async () => {
    const backend = new FakeBackend();
    backend.versions = [NEWEST, MIDDLE, FIRST];
    const { onRestored } = mount(backend);
    fireEvent.click(await screen.findByRole("button", { name: /Edited index\.html/ }));
    const restore = await screen.findByRole("button", { name: "Restore this version" });
    expect((restore as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(restore);
    await waitFor(() => expect(backend.restored).toEqual(["c2"]));
    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1));
    expect(useWorkspace.getState().toasts.map((t) => t.text).join(" ")).toContain("Put the code back to");
  });

  it("is not offered for the newest version, which is what the page has", async () => {
    const backend = new FakeBackend();
    backend.versions = [NEWEST, MIDDLE];
    mount(backend);
    const restore = (await screen.findByRole("button", { name: "Restore this version" })) as HTMLButtonElement;
    expect(restore.disabled).toBe(true);
  });

  it("says why when it did not work, and loads nothing again", async () => {
    const backend = new FakeBackend();
    backend.versions = [NEWEST, MIDDLE];
    backend.restoreFails = "That version has none of the page's code files, so there is nothing to put back";
    const { onRestored } = mount(backend);
    fireEvent.click(await screen.findByRole("button", { name: /Edited index\.html/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Restore this version" }));
    await waitFor(() => expect(useWorkspace.getState().toasts.map((t) => t.text).join(" ")).toContain("nothing to put back"));
    expect(onRestored).not.toHaveBeenCalled();
  });
});
