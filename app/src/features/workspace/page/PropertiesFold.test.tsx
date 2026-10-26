// Folding a page's properties: the default rule, a page's own choice, the
// keyboard, and that folding never touches the file.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useShell } from "../../../lib/store";
import { actionFor, runFor } from "../shortcuts";
import { MemoryVault } from "../preview/memory-vault";
import { usePrefs } from "../prefs";
import { useWorkspace } from "../store";
import { NotePage } from "./NotePage";
import { FOLD_ABOVE, foldEveryPage, isFolded } from "./properties-fold";

const MANY = "---\ntitle: Many\ntags: [paper, idea]\nprops:\n  a: one\n  b: two\n  c: three\n  d: four\n  e: five\n  f: six\n  g: seven\n---\nBody.\n";
const SEED = {
  "library/many.md": MANY,
  "library/few.md": "---\ntitle: Few\ntags: [paper]\nprops:\n  mood: calm\n---\nBody.\n",
  "library/plain.md": "---\ntitle: Plain\n---\nNothing else.\n",
};

let vault: MemoryVault;
const text = async (path: string) => (await vault.read(path)).text;
const props = () => screen.getByRole("region", { name: "Properties" });

async function open(path: string) {
  useWorkspace.setState({ place: { view: "home" }, back: [], forward: [], toasts: [] });
  await useWorkspace.getState().connect({ client: vault });
  useWorkspace.getState().openPath(path);
  useShell.setState({ panels: [] });
  render(<NotePage client={vault} path={path} />);
  const editor = await screen.findByTestId("page-editor", {}, { timeout: 20_000 });
  await expect.poll(() => editor.querySelector(".ProseMirror") !== null, { timeout: 20_000 }).toBe(true);
}

beforeEach(() => {
  localStorage.clear();
  usePrefs.setState({ propsFold: "auto", propsFolded: {} });
  vault = new MemoryVault(SEED);
});
afterEach(cleanup);

describe("the default rule", () => {
  it("shows, folds, or folds past five properties", () => {
    expect(isFolded("shown", undefined, 20)).toBe(false);
    expect(isFolded("folded", undefined, 0)).toBe(true);
    expect(isFolded("auto", undefined, FOLD_ABOVE)).toBe(false);
    expect(isFolded("auto", undefined, FOLD_ABOVE + 1)).toBe(true);
  });

  it("gives way to a page's own choice", () => {
    expect(isFolded("auto", false, 9)).toBe(false);
    expect(isFolded("shown", true, 1)).toBe(true);
  });
});

describe("properties under the title", () => {
  it("fold into one line past five properties, with the tags as links", async () => {
    await open("library/many.md");
    const line = within(props());
    expect(line.getByRole("button", { name: "Unfold properties" }).getAttribute("aria-expanded")).toBe("false");
    expect(line.getByText("7 properties")).toBeTruthy();
    expect(line.getByRole("button", { name: "#paper" })).toBeTruthy();
    expect(line.getByRole("button", { name: "#idea" })).toBeTruthy();
    expect(line.queryByLabelText("a")).toBeNull();
    expect(line.queryByRole("button", { name: /Add property/ })).toBeNull();
  });

  it("show up to five, and a click folds them", async () => {
    await open("library/few.md");
    expect(await within(props()).findByLabelText("mood")).toBeTruthy();
    await act(async () => fireEvent.click(within(props()).getByRole("button", { name: "Fold properties" })));
    expect(within(props()).queryByLabelText("mood")).toBeNull();
    expect(within(props()).getByText("1 property")).toBeTruthy();
  });

  it("unfold on a click and keep the page's choice", async () => {
    await open("library/many.md");
    await act(async () => fireEvent.click(within(props()).getByRole("button", { name: "Unfold properties" })));
    expect(((await within(props()).findByLabelText("a")) as HTMLInputElement).value).toBe("one");
    cleanup();
    await open("library/many.md");
    expect(await within(props()).findByLabelText("a")).toBeTruthy();
    const note = useWorkspace.getState().notes.find((n) => n.path === "library/many.md")!;
    expect(usePrefs.getState().propsFolded[note.id || note.path]).toBe(false);
    // Another page keeps the default.
    cleanup();
    await open("library/few.md");
    expect(await within(props()).findByLabelText("mood")).toBeTruthy();
  });

  it("are a button the keyboard reaches, and Ctrl+Alt+P flips the page", async () => {
    await open("library/many.md");
    const toggle = within(props()).getByRole("button", { name: "Unfold properties" });
    expect(toggle.tagName).toBe("BUTTON");
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    const key = new KeyboardEvent("keydown", { key: "p", ctrlKey: true, altKey: true });
    expect(actionFor(key)).toBe(runFor("toggle-properties"));
    await act(async () => actionFor(key)!());
    expect(await within(props()).findByLabelText("a")).toBeTruthy();
    await act(async () => actionFor(key)!());
    expect(within(props()).getByRole("button", { name: "Unfold properties" })).toBeTruthy();
  });

  it("follow the setting, and Fold on every page resets each page's choice", async () => {
    usePrefs.setState({ propsFold: "shown" });
    await open("library/many.md");
    expect(await within(props()).findByLabelText("a")).toBeTruthy();
    await act(async () => foldEveryPage());
    expect(usePrefs.getState().propsFolded).toEqual({});
    expect(within(props()).getByRole("button", { name: "Unfold properties" })).toBeTruthy();
  });

  it("unfold before Add property, and an edit still saves", async () => {
    await open("library/plain.md");
    usePrefs.setState({ propsFold: "folded" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add property" })));
    const form = within(props()).getByRole("form", { name: "New property" });
    expect(within(props()).getByRole("button", { name: "Fold properties" })).toBeTruthy();
    fireEvent.change(within(form).getByRole("textbox", { name: "Property name" }), { target: { value: "source" } });
    fireEvent.change(within(form).getByRole("textbox", { name: "Property value" }), { target: { value: "Library" } });
    await act(async () => fireEvent.submit(form));
    await expect.poll(() => text("library/plain.md")).toMatch(/props:\n {2}source: Library\n/);
  });

  it("never write the file when folded or unfolded", async () => {
    await open("library/many.md");
    await act(async () => fireEvent.click(within(props()).getByRole("button", { name: "Unfold properties" })));
    await act(async () => fireEvent.click(within(props()).getByRole("button", { name: "Fold properties" })));
    expect(await text("library/many.md")).toBe(MANY);
  });
});
