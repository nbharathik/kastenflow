// Sending a page or a selection to LaTeX, and starting a document from a
// template: what the window asks the app for, and what it says back.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NoteMeta } from "../../lib/vault/types";
import { useWorkspace } from "../../features/workspace/store";
import { newDocument } from "./actions";
import { setLatexBackend } from "./backend";
import { LATEX_VIEW } from "./manifest";
import { addPageToDocument, openPage, sendPage, sentMessage } from "./send";
import { DOC, MAIN, fakeBackend } from "./test-support";
import type { Sent } from "./types";

const note = (path: string, title: string): NoteMeta => ({
  path,
  id: null,
  title,
  kind: "page",
  icon: null,
  cover: null,
  parent: null,
  project: null,
  tags: [],
  modified: 0,
  created: null,
  updated: null,
  excerpt: "",
  words: 0,
  props: {},
  locked: false,
});

const original = useWorkspace.getState();
const go = vi.fn();
const toast = vi.fn();

beforeEach(() => {
  go.mockReset();
  toast.mockReset();
  useWorkspace.setState({ go, toast, notes: [note("projects/trip/plan.md", "Trip plan")], place: { view: "page", path: "projects/trip/plan.md" } });
});

afterEach(() => {
  setLatexBackend(null);
  useWorkspace.setState({ go: original.go, toast: original.toast, notes: original.notes as NoteMeta[], place: original.place });
});

describe("sending the open page", () => {
  it("asks for a new article named after the page, in its project, and opens it", async () => {
    const fake = fakeBackend();
    setLatexBackend(fake.backend);
    expect(openPage()).toEqual({ path: "projects/trip/plan.md", title: "Trip plan" });
    await sendPage();
    expect(fake.backend.send).toHaveBeenCalledWith({ page: "projects/trip/plan.md", title: "Trip plan", template: "article", project: "trip" });
    expect(go).toHaveBeenCalledWith({ view: LATEX_VIEW, path: MAIN });
    expect(toast).toHaveBeenCalledWith("Made “paper” from it.");
  });

  it("falls back to the library when the folder is not a project", async () => {
    const fake = fakeBackend();
    fake.backend.send.mockRejectedValueOnce("No project called “trip”");
    setLatexBackend(fake.backend);
    await sendPage("report");
    expect(fake.backend.send).toHaveBeenCalledTimes(2);
    expect(fake.backend.send.mock.calls[1]![0]).toEqual({ page: "projects/trip/plan.md", title: "Trip plan", template: "report", project: undefined });
    expect(go).toHaveBeenCalled();
  });

  it("says what went wrong in a sentence and opens nothing", async () => {
    const fake = fakeBackend();
    fake.backend.send.mockRejectedValue("There is no text to send to LaTeX");
    setLatexBackend(fake.backend);
    useWorkspace.setState({ place: { view: "page", path: "projects/trip/plan.md" } });
    await sendPage();
    expect(toast).toHaveBeenLastCalledWith("Could not send it to LaTeX: There is no text to send to LaTeX");
    expect(go).not.toHaveBeenCalled();
  });

  it("asks to open a page first when none is open, and to use the desktop app in the browser", async () => {
    setLatexBackend(fakeBackend().backend);
    useWorkspace.setState({ place: { view: "home" } });
    await sendPage();
    expect(toast).toHaveBeenLastCalledWith("Open a page first, then send it to LaTeX.");
    useWorkspace.setState({ place: { view: "page", path: "projects/trip/plan.md" } });
    setLatexBackend(null);
    await sendPage();
    expect(toast).toHaveBeenLastCalledWith("Sending to LaTeX needs the desktop app.");
  });
});

describe("what is said afterwards", () => {
  const sent = (over: Partial<Sent>): Sent => ({ doc: DOC, path: MAIN, appended: false, cites: [], todos: 0, ...over });

  it("names the document, and counts what was left as plain text", () => {
    expect(sentMessage(sent({}))).toBe("Made “paper” from it.");
    expect(sentMessage(sent({ appended: true }))).toBe("Added to “paper”.");
    expect(sentMessage(sent({ todos: 1 }))).toBe("Made “paper” from it. One part was left as plain text: search the source for TODO.");
    expect(sentMessage(sent({ todos: 3 }))).toContain("3 parts were left as plain text");
  });
});

describe("adding a page to a document", () => {
  it("lists the documents and adds the page to the one chosen", async () => {
    const fake = fakeBackend();
    setLatexBackend(fake.backend);
    addPageToDocument();
    const row = await vi.waitFor(() => {
      const found = document.querySelector<HTMLElement>('[role="option"]');
      if (!found) throw new Error("not yet");
      return found;
    });
    expect(row.textContent).toContain("paper");
    row.click();
    await vi.waitFor(() => expect(fake.backend.send).toHaveBeenCalledWith({ page: "projects/trip/plan.md", appendTo: MAIN }));
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith("Added to “paper”."));
  });

  it("says there are no documents and offers to make one from the page", async () => {
    const fake = fakeBackend();
    fake.backend.docs.mockResolvedValue([]);
    setLatexBackend(fake.backend);
    addPageToDocument();
    const make = await vi.waitFor(() => {
      const found = [...document.querySelectorAll("button")].find((b) => b.textContent === "Make one from this page");
      if (!found) throw new Error("not yet");
      return found;
    });
    expect(document.body.textContent).toContain("There are no LaTeX documents yet.");
    make.click();
    await vi.waitFor(() => expect(fake.backend.send).toHaveBeenCalledWith({ page: "projects/trip/plan.md", title: "Trip plan", template: "article", project: "trip" }));
  });
});

describe("a new document from a template", () => {
  it("asks for the template and the project the person is in, and opens the document", async () => {
    const fake = fakeBackend();
    setLatexBackend(fake.backend);
    await newDocument("beamer");
    expect(fake.backend.create).toHaveBeenCalledWith("Untitled slides", "trip", "beamer");
    expect(go).toHaveBeenCalledWith({ view: LATEX_VIEW, path: MAIN });
  });

  it("starts an article in the library from anywhere else", async () => {
    const fake = fakeBackend();
    setLatexBackend(fake.backend);
    useWorkspace.setState({ place: { view: "home" } });
    await newDocument();
    expect(fake.backend.create).toHaveBeenCalledWith("Untitled document", undefined, "article");
  });

  it("tries the library once when the folder was not a project", async () => {
    const fake = fakeBackend();
    fake.backend.create.mockRejectedValueOnce("No project called “trip”");
    setLatexBackend(fake.backend);
    await newDocument("report");
    expect(fake.backend.create.mock.calls.map((c) => c[1])).toEqual(["trip", undefined]);
    expect(go).toHaveBeenCalled();
  });
});
