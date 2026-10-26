// The pick-from-a-list dialog and the citation list built on it.

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWorkspace } from "../../features/workspace/store";
import { insertCitation, referenceRows, writeCitation } from "./insert-citation";
import { narrow, openPicker, type PickerItem, type PickerOptions } from "./picker";

const ITEMS: PickerItem[] = [
  { id: "knuth84", label: "Literate programming", detail: "Knuth, 1984 · knuth84" },
  { id: "lamport94", label: "LaTeX: a document preparation system", detail: "Lamport, 1994 · lamport94" },
  { id: "turing36", label: "On computable numbers", detail: "Turing, 1936 · turing36" },
];

const options = (over: Partial<PickerOptions> = {}): PickerOptions => ({
  title: "Insert a citation",
  placeholder: "Search your references",
  load: () => Promise.resolve(ITEMS),
  empty: { text: "Nothing yet." },
  onPick: vi.fn(),
  ...over,
});

// Every picker opened is closed again, so the next test starts with a bare window.
const opened: (() => void)[] = [];
const open = (o: PickerOptions) => {
  const close = openPicker(o);
  opened.push(close);
  return close;
};
const gone = () => waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

afterEach(async () => {
  cleanup();
  opened.splice(0).forEach((close) => close());
  await gone();
});

const box = () => screen.findByRole("combobox", { name: "Search your references" });

describe("narrow", () => {
  it("keeps the items that hold every word, in any order, in the label, detail or id", () => {
    expect(narrow(ITEMS, "").length).toBe(3);
    expect(narrow(ITEMS, "knuth").map((i) => i.id)).toEqual(["knuth84"]);
    expect(narrow(ITEMS, "1994 LAMPORT").map((i) => i.id)).toEqual(["lamport94"]);
    expect(narrow(ITEMS, "turing computable").map((i) => i.id)).toEqual(["turing36"]);
    expect(narrow(ITEMS, "zzz")).toEqual([]);
    expect(narrow(Array.from({ length: 500 }, (_, n) => ({ id: `k${n}`, label: `L${n}` })), "").length).toBe(100);
  });
});

describe("the picker", () => {
  it("shows a loading line, then the rows; typing narrows them and Enter picks the first", async () => {
    const onPick = vi.fn();
    let arrive: (items: PickerItem[]) => void = () => {};
    open(options({ onPick, load: () => new Promise((resolve) => (arrive = resolve)) }));
    expect((await screen.findByRole("status")).textContent).toBe("Looking…");
    arrive(ITEMS);
    const input = await box();
    expect(screen.getAllByRole("option").length).toBe(3);
    fireEvent.change(input, { target: { value: "lamport" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["LaTeX: a document preparation systemLamport, 1994 · lamport94"]);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(ITEMS[1]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("moves with the arrow keys and picks with a click", async () => {
    const onPick = vi.fn();
    open(options({ onPick }));
    const input = await box();
    expect(screen.getAllByRole("option")[0]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[2]!.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe("latex-picker-2");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(ITEMS[1]);
    await gone();
    open(options({ onPick }));
    await box();
    fireEvent.click(screen.getAllByRole("option")[2]!);
    expect(onPick).toHaveBeenLastCalledWith(ITEMS[2]);
  });

  it("says when nothing matches, and Escape leaves without picking", async () => {
    const onPick = vi.fn();
    open(options({ onPick }));
    const input = await box();
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.getByRole("status").textContent).toBe("Nothing matches “zzz”.");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onPick).not.toHaveBeenCalled();
  });

  it("with nothing to choose from says so in a sentence and offers the way on", async () => {
    const run = vi.fn();
    open(options({ load: () => Promise.resolve([]), empty: { text: "No references yet.", action: { label: "Open References", run } } }));
    await screen.findByText("No references yet.");
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open References" }));
    expect(run).toHaveBeenCalledOnce();
  });

  it("says why it failed and tries again", async () => {
    const load = vi.fn().mockRejectedValueOnce("The vault could not be read").mockResolvedValue(ITEMS);
    open(options({ load }));
    expect((await screen.findByRole("alert")).textContent).toContain("The vault could not be read");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await box();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("is named for a screen reader and keeps the list named too", async () => {
    open(options());
    await box();
    expect(screen.getByRole("dialog", { name: "Insert a citation" })).toBeTruthy();
    expect(screen.getByRole("listbox", { name: "Insert a citation" })).toBeTruthy();
  });
});

describe("inserting a citation", () => {
  const cites = (items: { key: string; title: string; detail: string }[]) => ({ cites: () => Promise.resolve(items.map((i) => ({ ...i, from: "refs.bib" }))) });

  it("lists the title with who and when and the key", async () => {
    const rows = await referenceRows(cites([{ key: "knuth84", title: "Literate programming", detail: "Knuth, 1984" }, { key: "x", title: "", detail: "misc" }]));
    expect(rows).toEqual([
      { id: "knuth84", label: "Literate programming", detail: "Knuth, 1984 · knuth84" },
      { id: "x", label: "x", detail: "misc" },
    ]);
  });

  it("writes the citation at the caret of the open file", async () => {
    const { Editor } = await import("./editor/Editor");
    const { createRef } = await import("react");
    const { render } = await import("@testing-library/react");
    const ref = createRef<import("./editor/Editor").EditorHandle>();
    render(<Editor ref={ref} fileKey="a.tex" initial={"As shown by \n"} label="Source" hooks={{ change: () => {}, build: () => {}, save: () => {} }} />);
    const view = ref.current!.view()!;
    view.dispatch({ selection: { anchor: 12 } });
    expect(writeCitation(ref.current, "knuth84")).toBe(true);
    expect(view.state.doc.toString()).toBe("As shown by \\cite{knuth84}\n");
    // A second pick inside the braces extends the same citation.
    view.dispatch({ selection: { anchor: 12 + "\\cite{knuth84".length } });
    expect(writeCitation(ref.current, "lamport94")).toBe(true);
    expect(view.state.doc.toString()).toBe("As shown by \\cite{knuth84,lamport94}\n");
    expect(writeCitation(null, "k")).toBe(false);
  });

  it("opens the list of references, and points to References when there are none", async () => {
    const go = vi.fn();
    const original = useWorkspace.getState().go;
    useWorkspace.setState({ go });
    insertCitation(cites([]), { current: null });
    await screen.findByText(/no references yet/i);
    fireEvent.click(screen.getByRole("button", { name: "Open References" }));
    expect(go).toHaveBeenCalledWith({ view: "references" });
    useWorkspace.setState({ go: original });
  });

  it("tells the person to open a file when there is nowhere to write", async () => {
    const toast = vi.fn();
    const original = useWorkspace.getState().toast;
    useWorkspace.setState({ toast });
    insertCitation(cites([{ key: "k", title: "T", detail: "A, 2000" }]), { current: null });
    fireEvent.click((await screen.findAllByRole("option"))[0]!);
    expect(toast).toHaveBeenCalledWith("Open a file of the document first, then insert the citation.");
    useWorkspace.setState({ toast: original });
  });
});
