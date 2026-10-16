import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useShell } from "../../../lib/store";
import { useChat } from "../../chat/store";
import { resetChat, scriptedChat } from "../../chat/test-kit";
import { useWorkspace } from "../../workspace/store";
import { showSpot } from "../highlight-request";
import { useSources } from "../store";
import { FIRST, PRIMER, SECOND, sampleVault, THIRD } from "../test-kit";
import PdfReader from "./PdfReader";

// pdf.js stands in: two A4 pages whose text layer is one line each.
const pdf = vi.hoisted(() => {
  const SIZE = { width: 595, height: 842 };
  const WORDS: Record<number, string> = { 1: "A note should hold one idea.", 2: "Read old notes often." };
  class TextLayer {
    constructor(private readonly options: { textContentSource: number; container: HTMLElement }) {}
    render() {
      const span = document.createElement("span");
      span.textContent = WORDS[this.options.textContentSource]!;
      this.options.container.append(span);
      return Promise.resolve();
    }
    cancel() {}
  }
  const cleanups: number[] = [];
  const page = (n: number) => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: SIZE.width * scale, height: SIZE.height * scale, transform: [scale, 0, 0, -scale, 0, SIZE.height * scale] }),
    render: () => ({ promise: Promise.resolve(), cancel() {} }),
    streamTextContent: () => n,
    getTextContent: async () => ({ items: [{ str: WORDS[n]! }] }),
    cleanup: () => void cleanups.push(n),
  });
  const destroy = vi.fn(async () => {});
  const outline = [{ title: "Reading", dest: [{ num: 7 }], items: [{ title: "Often", dest: "often", items: [] }] }];
  const openPdf = vi.fn(async (_bytes: Uint8Array) => ({
    numPages: 2,
    getPage: async (n: number) => page(n),
    getOutline: async () => outline,
    getDestination: async (_name: string) => [1],
    getPageIndex: async () => 1,
    loadingTask: { destroy },
  }));
  return { SIZE, destroy, openPdf, cleanups, lib: { TextLayer } };
});
vi.mock("../pdf/load", () => ({ openPdf: pdf.openPdf, pdfjs: async () => pdf.lib }));

/** Page n's top in the window: pages sit one under another, 18 px apart. */
const pageTop = (n: number) => (n - 1) * (pdf.SIZE.height + 18);

beforeEach(() => {
  localStorage.clear();
  pdf.destroy.mockClear();
  pdf.cleanups.length = 0;
  // jsdom lays nothing out: pages get their places, the rest is at 0.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const n = Number((this as HTMLElement).dataset?.page);
    const [top, width, height] = this.classList.contains("kasten-pdf-page") ? [pageTop(n), pdf.SIZE.width, pdf.SIZE.height] : [0, 0, 0];
    return { x: 0, y: top, left: 0, top, right: width, bottom: top + height, width, height, toJSON: () => ({}) } as DOMRect;
  });
  Element.prototype.scrollTo = vi.fn();
});
afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

async function open() {
  const vault = await sampleVault();
  const view = render(<PdfReader path={PRIMER} />);
  const page = (n: number) => screen.getByRole("region", { name: `Page ${n}` });
  await screen.findByRole("region", { name: "Page 2" });
  // Drawn: the text layers are there.
  await within(page(2)).findByText("Read old notes often.");
  const marks = (id?: string) => [...document.querySelectorAll<HTMLElement>(`.kasten-pdf-mark${id ? `[data-highlight="${id}"]` : ""}`)];
  await vi.waitFor(() => expect(marks()).toHaveLength(6));
  return { vault, view, page, marks };
}

describe("the PDF reader", () => {
  it("draws each page with its highlights where they are", async () => {
    const { page, marks } = await open();
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "A Zettelkasten primer" })).toBeTruthy();
    expect(page(1).querySelectorAll(".kasten-pdf-mark")).toHaveLength(4);
    expect(page(2).querySelectorAll(".kasten-pdf-mark")).toHaveLength(2);
    // Fitted to no width at all (jsdom's), the scale is 1: points are pixels,
    // measured from the top.
    const first = marks(FIRST)[0]!;
    expect(first.className).toContain("is-yellow");
    expect(parseFloat(first.style.left)).toBe(72);
    expect(parseFloat(first.style.top)).toBeCloseTo(842 - 608.2);
    expect(parseFloat(first.style.width)).toBeCloseTo(499.01 - 72);
    const list = screen.getByRole("complementary", { name: "Highlights in this PDF" });
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual([
      expect.stringContaining("A note should hold one idea"),
      expect.stringContaining("Structure is the result"),
      expect.stringContaining("Keep the reference"),
    ]);
  });

  it("highlights a selection in the colour picked", async () => {
    const { vault, page } = await open();
    const words = within(page(2)).getByText("Read old notes often.");
    const range = document.createRange();
    range.selectNodeContents(words);
    window.getSelection()!.addRange(range);
    // The line, 100 px down page 2, as the window has it.
    const line = { left: 72, top: pageTop(2) + 100, right: 300, bottom: pageTop(2) + 112, width: 228, height: 12 };
    vi.spyOn(Range.prototype, "getClientRects").mockReturnValue([line] as unknown as DOMRectList);
    fireEvent.pointerUp(words, { button: 0, clientX: 200, clientY: line.top + 5 });
    const bar = await screen.findByRole("toolbar", { name: "Highlight the selection" });
    await act(async () => fireEvent.click(within(bar).getByRole("button", { name: "Highlight blue" })));
    const made = { page: 2, rects: [[72, 730, 300, 742]], text: "Read old notes often.", color: "blue" };
    expect((await vault.highlights(PRIMER)).at(-1)).toMatchObject(made);
    expect(useSources.getState().highlights[PRIMER]!.at(-1)).toMatchObject(made);
    expect(screen.queryByRole("toolbar", { name: "Highlight the selection" })).toBeNull();
    expect(window.getSelection()!.isCollapsed).toBe(true);
    // The colour is kept for next time.
    expect(localStorage.getItem("kasten.highlight.color")).toBe("blue");
  });

  it("opens a highlight clicked, whose card then opens beside the reader", async () => {
    const { page } = await open();
    // Inside the first line of the first highlight: x 72 to 499, y 234 to 246.
    fireEvent.pointerUp(page(1), { button: 0, clientX: 100, clientY: 240 });
    const pop = await screen.findByRole("dialog", { name: "Highlight" });
    expect(within(pop).getByRole("radio", { name: "Yellow" }).getAttribute("aria-checked")).toBe("true");
    expect((within(pop).getByRole("textbox", { name: "Comment" }) as HTMLTextAreaElement).value).toBe("The rule the rest follows from.");
    await act(async () => fireEvent.click(within(pop).getByRole("button", { name: "Make card" })));
    const card = useSources.getState().highlights[PRIMER]!.find((h) => h.id === FIRST)!.card!;
    expect(useWorkspace.getState().stack).toEqual([card]);
    expect(screen.queryByRole("dialog", { name: "Highlight" })).toBeNull();
    // A click where no highlight is opens nothing.
    fireEvent.pointerUp(page(1), { button: 0, clientX: 30, clientY: 30 });
    await new Promise((r) => setTimeout(r, 5));
    expect(screen.queryByRole("dialog", { name: "Highlight" })).toBeNull();
  });

  it("recolours and removes a highlight from its popover", async () => {
    const { vault, page, marks } = await open();
    fireEvent.pointerUp(page(1), { button: 0, clientX: 100, clientY: 240 });
    const pop = await screen.findByRole("dialog", { name: "Highlight" });
    await act(async () => fireEvent.click(within(pop).getByRole("radio", { name: "Green" })));
    expect(marks(FIRST)[0]!.className).toContain("is-green");
    await act(async () => fireEvent.click(within(pop).getByRole("button", { name: "Remove" })));
    expect(marks(FIRST)).toHaveLength(0);
    expect((await vault.highlights(PRIMER)).map((h) => h.id)).not.toContain(FIRST);
  });

  it("asks AI about the pages in view from the bar, in a chat that holds just those pages", async () => {
    resetChat(scriptedChat());
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Ask AI about these pages…" }));
    const form = screen.getByRole("dialog", { name: "Ask AI about these pages" });
    expect((within(form).getByRole("textbox", { name: "Pages" }) as HTMLInputElement).value).toBe("1");
    fireEvent.change(within(form).getByRole("textbox", { name: "Pages" }), { target: { value: "1-2" } });
    act(() => fireEvent.click(within(form).getByRole("button", { name: "Ask in chat" })));
    const thread = useChat.getState().threads[useChat.getState().active!]!;
    expect(thread.context).toEqual([
      { kind: "pdf", label: "A Zettelkasten primer · pp. 1-2 + 3 highlights", ref: [PRIMER, "pages:1-2", `highlights:${FIRST},${SECOND},${THIRD}`], origin: "added" },
    ]);
    expect(useShell.getState().chatOpen).toBe(true);
  });

  it("explains a highlight in the chat from its popover", async () => {
    const chat = scriptedChat();
    resetChat(chat);
    const { page } = await open();
    fireEvent.pointerUp(page(1), { button: 0, clientX: 100, clientY: 240 });
    const pop = await screen.findByRole("dialog", { name: "Highlight" });
    await act(async () => fireEvent.click(within(pop).getByRole("button", { name: "Explain" })));
    expect(screen.queryByRole("dialog", { name: "Highlight" })).toBeNull();
    await vi.waitFor(() => expect(chat.requests).toHaveLength(1));
    // The Explain action, about that highlight on its page.
    expect(chat.requests[0]).toMatchObject({
      text: expect.stringContaining("Explain the selected text in plain language"),
      context: [{ kind: "pdf", label: "A Zettelkasten primer · p. 1 + 1 highlight", ref: [PRIMER, "pages:1", `highlights:${FIRST}`] }],
    });
  });

  it("scrolls to a spot asked for and flashes its highlight", async () => {
    const { marks } = await open();
    act(() => showSpot({ source: PRIMER, page: 2, highlight: THIRD }));
    const flashing = () => marks().filter((m) => m.classList.contains("is-flashing"));
    expect(flashing()).toEqual(marks(THIRD));
    expect(flashing()).toHaveLength(2);
    const scroller = document.querySelector(".kasten-reader-pages")!;
    // Page 2's top, then the highlight's top on it.
    expect(vi.mocked(scroller.scrollTo)).toHaveBeenLastCalledWith({ top: expect.closeTo(pageTop(2) + (842 - 736.2), 3) });
    // The side list does the same.
    const list = screen.getByRole("complementary", { name: "Highlights in this PDF" });
    fireEvent.click(within(list).getByRole("button", { name: /A note should hold one idea/ }));
    expect(flashing()).toEqual(marks(FIRST));
    expect(vi.mocked(scroller.scrollTo)).toHaveBeenLastCalledWith({ top: expect.closeTo(842 - 608.2, 3) });
  });

  it("takes a spot asked for before it opened", async () => {
    await sampleVault();
    showSpot({ source: PRIMER, highlight: THIRD });
    render(<PdfReader path={PRIMER} />);
    await vi.waitFor(() => expect(document.querySelectorAll(`.kasten-pdf-mark.is-flashing[data-highlight="${THIRD}"]`)).toHaveLength(2));
  });

  it("lets go of a page gone far from the view", async () => {
    let report: IntersectionObserverCallback = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          report = callback;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      },
    );
    try {
      const { page } = await open();
      expect(pdf.cleanups).toEqual([]);
      // As a real observer's first report: every page, page 1 near, page 2 not.
      const entries = [
        { target: page(1), isIntersecting: true },
        { target: page(2), isIntersecting: false },
      ];
      act(() => report(entries as unknown as IntersectionObserverEntry[], {} as IntersectionObserver));
      await vi.waitFor(() => expect(pdf.cleanups).toEqual([2]));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("takes a colour's key only when it is not typed into a field", async () => {
    const { vault, page } = await open();
    const before = (await vault.highlights(PRIMER)).length;
    const words = within(page(2)).getByText("Read old notes often.");
    const range = document.createRange();
    range.selectNodeContents(words);
    window.getSelection()!.addRange(range);
    const line = { left: 72, top: pageTop(2) + 100, right: 300, bottom: pageTop(2) + 112, width: 228, height: 12 };
    vi.spyOn(Range.prototype, "getClientRects").mockReturnValue([line] as unknown as DOMRectList);
    fireEvent.pointerUp(words, { button: 0, clientX: 200, clientY: line.top + 5 });
    await screen.findByRole("toolbar", { name: "Highlight the selection" });
    // A field elsewhere, such as another pane's title, gets its digit.
    const field = document.createElement("input");
    document.body.append(field);
    await act(async () => fireEvent.keyDown(field, { key: "2" }));
    expect((await vault.highlights(PRIMER)).length).toBe(before);
    field.remove();
    await act(async () => fireEvent.keyDown(window, { key: "2" }));
    await vi.waitFor(async () => expect((await vault.highlights(PRIMER)).length).toBe(before + 1));
  });

  it("names the page read while a selection's bar is open", async () => {
    const { page } = await open();
    const words = within(page(2)).getByText("Read old notes often.");
    const range = document.createRange();
    range.selectNodeContents(words);
    window.getSelection()!.addRange(range);
    const line = { left: 72, top: pageTop(2) + 100, right: 300, bottom: pageTop(2) + 112, width: 228, height: 12 };
    vi.spyOn(Range.prototype, "getClientRects").mockReturnValue([line] as unknown as DOMRectList);
    fireEvent.pointerUp(words, { button: 0, clientX: 200, clientY: line.top + 5 });
    await screen.findByRole("toolbar", { name: "Highlight the selection" });
    fireEvent.scroll(document.querySelector(".kasten-reader-pages")!);
    expect(screen.getByText(/^Page \d of 2$/)).toBeTruthy();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it("says when a PDF can't be opened, and lets go of one it opened", async () => {
    await sampleVault();
    pdf.openPdf.mockRejectedValueOnce(new Error("Invalid PDF structure."));
    const broken = render(<PdfReader path={PRIMER} />);
    expect((await screen.findByRole("alert")).textContent).toBe("This PDF could not be opened: Invalid PDF structure.");
    broken.unmount();
    const { view } = await open();
    expect(pdf.destroy).not.toHaveBeenCalled();
    view.unmount();
    expect(pdf.destroy).toHaveBeenCalledOnce();
  });
});

describe("finding the way in a PDF", () => {
  const scrolled = () => vi.mocked(document.querySelector<HTMLElement>(".kasten-reader-pages")!.scrollTo);

  it("goes to a page number typed into the bar", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Page 1 of 2" }));
    const field = screen.getByRole("textbox", { name: "Go to page" });
    fireEvent.change(field, { target: { value: "2" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(scrolled()).toHaveBeenLastCalledWith({ top: pageTop(2) - 12 });
  });

  it("goes to a chapter of the PDF's outline", async () => {
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "Outline" }));
    const menu = screen.getByRole("menu", { name: "Outline" });
    expect(within(menu).getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["Reading2", "Often2"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Reading/ }));
    expect(scrolled()).toHaveBeenLastCalledWith({ top: pageTop(2) - 12 });
  });

  it("opens again on the page it was left on", async () => {
    localStorage.setItem("kasten.readerPages", JSON.stringify({ [PRIMER]: 2 }));
    await open();
    expect(scrolled()).toHaveBeenCalledWith({ top: pageTop(2) - 12 });
  });

  it("finds text across the pages with Mod+F", async () => {
    await open();
    fireEvent.keyDown(screen.getByRole("region", { name: "Page 1" }), { key: "f", ctrlKey: true });
    const find = screen.getByRole("textbox", { name: "Find in this PDF" });
    fireEvent.change(find, { target: { value: "old notes" } });
    await vi.waitFor(() => expect(screen.getByRole("search", { name: "Find in this PDF" }).textContent).toContain("1 on 1 page · page 2"));
    expect(scrolled()).toHaveBeenLastCalledWith({ top: pageTop(2) - 12 });
    fireEvent.change(find, { target: { value: "zebra" } });
    await vi.waitFor(() => expect(screen.getByRole("search", { name: "Find in this PDF" }).textContent).toContain("No results"));
    fireEvent.keyDown(find, { key: "Escape" });
    expect(screen.queryByRole("search", { name: "Find in this PDF" })).toBeNull();
  });
});
