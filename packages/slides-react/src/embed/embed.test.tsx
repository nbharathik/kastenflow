// How an embedded page is drawn: a page of the host from its words (safely), a web page at the size of a window of its own scaled into the
// box, and how it is looked at in a presentation: click to use it, Ctrl plus, minus and zero to zoom it, Esc to give the keys back.

import type { Element, Theme } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { HostPageText } from "../editor/host.ts";
import { withPages } from "../pages/fake-pages.ts";
import { newDeck } from "../test/engine.ts";
import { EmbedFrame, isPageEmbed } from "../present/Live.tsx";
import { plainDeck } from "../render/testing/decks.ts";
import { EmbedBox } from "./EmbedBox.tsx";
import { PageView } from "./PageView.tsx";
import { viewOf } from "./scale.ts";

afterEach(cleanup);
// The engine reads the pages' Markdown: it is loaded before anything is drawn, as the editor and a presentation have it.
beforeAll(async () => void (await newDeck("Embeds")));

const theme = plainDeck([]).deck.theme as Theme;
const stageOf = (container: HTMLElement) => container.querySelector<HTMLElement>(".ks-embed-stage")!;

describe("a page of the host, drawn from its words", () => {
  const MD = "# Title\n\nWords with **bold**, a [[Other page|link]] and a [site](https://example.com).\n\n- one\n- two\n\n1. first\n2. second\n\n> [!tip]\n> A callout.\n\n```py\nprint(1)\n```\n\n$$x^2$$\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---\n";

  it("has a heading, words, lists with their marks and numbers, a callout, code, a formula, a table and a rule", () => {
    const { container } = render(<PageView markdown={MD} theme={theme} />);
    expect(container.querySelector("h1")?.textContent).toBe("Title");
    expect(container.querySelector("span[style*='font-weight']")?.textContent).toBe("bold");
    expect([...container.querySelectorAll(".ks-pv-item")].map((i) => i.textContent)).toEqual(["•one", "•two", "1.first", "2.second"]);
    expect(container.querySelector("blockquote[data-callout=tip]")?.textContent).toBe("A callout.");
    expect(container.querySelector("pre code")?.textContent).toBe("print(1)");
    expect(container.querySelector(".ks-pv-math .katex")).toBeTruthy();
    expect([...container.querySelectorAll("th, td")].map((c) => c.textContent)).toEqual(["a", "b", "1", "2"]);
    expect(container.querySelector("hr")).toBeTruthy();
  });

  it("sets its words in the deck's fonts and colours", () => {
    const { container } = render(<PageView markdown="Some words." theme={theme} />);
    const root = container.querySelector<HTMLElement>(".ks-pv")!;
    expect(root.style.getPropertyValue("--pv-ink")).toMatch(/^#[0-9a-f]{6}$/i);
    expect(root.style.fontFamily).not.toBe("");
  });

  it("follows a link when it is clicked or Enter is pressed on it, and nothing navigates by itself", () => {
    const onLink = vi.fn();
    const { container } = render(<PageView markdown={MD} theme={theme} onLink={onLink} />);
    const links = container.querySelectorAll<HTMLElement>("[data-href]");
    expect([...links].map((l) => l.dataset.href)).toEqual(["page:Other%20page", "https://example.com"]);
    expect(container.querySelector("a[href]")).toBeNull();
    fireEvent.click(links[0]!);
    expect(onLink).toHaveBeenLastCalledWith("page:Other%20page");
    fireEvent.keyDown(links[1]!, { key: "Enter" });
    expect(onLink).toHaveBeenLastCalledWith("https://example.com");
  });

  it("draws what a page holds as words and never as markup: a script on a page is only text", () => {
    const { container } = render(<PageView markdown={'<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n[x](javascript:alert(3))'} theme={theme} onLink={() => {}} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    for (const link of container.querySelectorAll<HTMLElement>("[data-href]")) expect(link.dataset.href).not.toMatch(/^javascript:/i);
  });

  it("shows a picture the host can give a address for, and leaves out one it cannot", () => {
    const { container } = render(<PageView markdown={"![A cat](assets/cat.png)\n\n![Gone](assets/gone.png)"} theme={theme} imageUrl={(src) => (src.endsWith("cat.png") ? "blob:cat" : undefined)} />);
    const pictures = container.querySelectorAll("img");
    expect(pictures).toHaveLength(1);
    expect(pictures[0]?.getAttribute("src")).toBe("blob:cat");
    expect(pictures[0]?.getAttribute("alt")).toBe("A cat");
  });
});

describe("a page laid out for a window and scaled into its box", () => {
  it("is laid out at the design's width and scaled down, so it is not squeezed into its phone layout", () => {
    const { container } = render(
      <EmbedBox box={{ w: 320, h: 200 }} view={viewOf({ design: { w: 1280, h: 800 } })}>
        <p>page</p>
      </EmbedBox>,
    );
    const stage = stageOf(container);
    expect(stage.style.width).toBe("1280px");
    expect(stage.style.transform).toBe("scale(0.25)");
    expect(stage.style.height).toBe("800px");
  });

  it("follows a zoom, laying the page out as a window of the box over the zoom, and letterboxes a whole page", () => {
    const zoomed = render(
      <EmbedBox box={{ w: 600, h: 300 }} view={viewOf({ zoom: 0.5 })}>
        x
      </EmbedBox>,
    );
    expect([stageOf(zoomed.container).style.width, stageOf(zoomed.container).style.transform]).toEqual(["1200px", "scale(0.5)"]);
    cleanup();
    const whole = render(
      <EmbedBox box={{ w: 600, h: 300 }} view={viewOf({ design: { w: 1000, h: 1000 }, fit: "page" })}>
        x
      </EmbedBox>,
    );
    expect(stageOf(whole.container).style.left).toBe("150px");
    expect(whole.container.querySelector("[data-letterboxed]")).toBeTruthy();
  });
});

const embed = (extra: Record<string, unknown> = {}) => ({ type: "embed", id: "e", x: 10, y: 20, w: 320, h: 200, url: "http://127.0.0.1:9/demo", ...extra }) as unknown as Extract<Element, { type: "embed" }>;
const item = (element: Extract<Element, { type: "embed" }>) => ({ element, box: { x: 10, y: 20, w: 320, h: 200 }, opacity: 1 });
const yes = vi.fn().mockResolvedValue({}) as unknown as typeof fetch;
const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));

describe("a web page in a presentation", () => {
  async function show(extra: Record<string, unknown> = {}) {
    const view = render(<EmbedFrame item={item(embed(extra))} ask={yes} theme={theme} />);
    await settle();
    const frame = view.container.querySelector("iframe")!;
    await act(async () => void frame.dispatchEvent(new Event("load")));
    return view;
  }

  it("is laid out at Desktop width in a small box, whatever the box is", async () => {
    const { container } = await show();
    const stage = stageOf(container);
    expect(stage.style.width).toBe("1280px");
    expect(stage.style.transform).toBe("scale(0.25)");
    expect(container.querySelector("iframe")?.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
  });

  it("takes the window the deck names, and a zoom the deck holds", async () => {
    const { container } = await show({ design: { w: 390, h: 844 }, zoom: 1 });
    const stage = stageOf(container);
    // With a zoom the page is laid out as the box over the zoom, as a browser's zoomed window is.
    expect([stage.style.width, stage.style.transform]).toEqual(["320px", "scale(1)"]);
  });

  it("is looked at from a distance until it is clicked, which hands it the pointer, and Esc takes it back", async () => {
    const { container } = await show();
    const cover = screen.getByRole("button", { name: /Use Embedded page/ });
    expect(container.querySelector(".ks-embed-chip")).toBeNull();
    fireEvent.click(cover);
    expect(container.querySelector("[data-active]")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Use Embedded page/ })).toBeNull();
    expect(screen.getByRole("group", { name: "Page zoom" })).toBeTruthy();
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => void window.dispatchEvent(esc));
    expect(esc.defaultPrevented).toBe(true);
    expect(container.querySelector("[data-active]")).toBeNull();
    expect(screen.getByRole("button", { name: /Use Embedded page/ })).toBeTruthy();
  });

  it("zooms with Ctrl plus, minus and zero while it has the pointer, and the zoom is the presentation's own", async () => {
    const { container } = await show();
    fireEvent.click(screen.getByRole("button", { name: /Use Embedded page/ }));
    const key = (init: KeyboardEventInit) => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })));
    key({ key: "=", ctrlKey: true });
    expect(stageOf(container).style.transform).toBe("scale(0.33)");
    key({ key: "+", ctrlKey: true, shiftKey: true });
    expect(stageOf(container).style.transform).toBe("scale(0.5)");
    key({ key: "-", ctrlKey: true });
    expect(stageOf(container).style.transform).toBe("scale(0.33)");
    expect(screen.getByRole("group", { name: "Page zoom" }).textContent).toMatch(/33%/);
    key({ key: "0", ctrlKey: true });
    expect(stageOf(container).style.transform).toBe("scale(0.25)");
    // Plain plus and minus are the page's own.
    key({ key: "=" });
    expect(stageOf(container).style.transform).toBe("scale(0.25)");
  });

  it("zooms with the buttons of its chip as well", async () => {
    const { container } = await show();
    fireEvent.click(screen.getByRole("button", { name: /Use Embedded page/ }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(stageOf(container).style.transform).toBe("scale(0.33)");
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    expect(stageOf(container).style.transform).toBe("scale(0.25)");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(container.querySelector("[data-active]")).toBeNull();
  });

  it("gives the keys back to the slide when the pointer leaves", async () => {
    const { container } = await show();
    fireEvent.click(screen.getByRole("button", { name: /Use Embedded page/ }));
    fireEvent.pointerLeave(container.querySelector(".ks-show-live-item")!);
    expect(container.querySelector("[data-active]")).toBeNull();
  });
});

describe("a page of the host in a presentation", () => {
  const PAGE: HostPageText = { path: "plan.md", title: "Plan", markdown: "# Plan\n\nLive words.\n" };
  const snapshot = { markdown: "# Plan\n\nWords the deck kept.\n", page: "plan.md", kind: "embed" };

  it("is isPageEmbed when it has no address and a source, and not otherwise", () => {
    expect(isPageEmbed(embed({ url: "", source: snapshot }))).toBe(true);
    expect(isPageEmbed(embed({ url: "https://x.y", source: snapshot }))).toBe(false);
    expect(isPageEmbed(embed({ url: "" }))).toBe(false);
  });

  it("is drawn from the snapshot at once, then from the page as the host reads it, and again when the page changes", async () => {
    const host = { save: async () => ({ status: "saved" as const }), imageUrl: () => undefined, addImage: async (n: string) => n, deliver: async () => {} };
    const fake = withPages(host, [PAGE]);
    const view = render(<EmbedFrame item={item(embed({ url: "", source: snapshot, design: { w: 640, h: 360 } }))} pages={host} theme={theme} />);
    expect(view.container.textContent).toContain("Words the deck kept.");
    await settle();
    expect(view.container.textContent).toContain("Live words.");
    expect(stageOf(view.container).style.width).toBe("640px");
    await act(async () => fake.edit("plan.md", "# Plan\n\nEdited words.\n"));
    await settle();
    expect(view.container.textContent).toContain("Edited words.");
  });

  it("falls back on the snapshot, and says so, when the page is gone", async () => {
    const host = { save: async () => ({ status: "saved" as const }), imageUrl: () => undefined, addImage: async (n: string) => n, deliver: async () => {} };
    const fake = withPages(host, [PAGE]);
    const view = render(<EmbedFrame item={item(embed({ url: "", source: snapshot }))} pages={host} theme={theme} />);
    await settle();
    await act(async () => fake.remove("plan.md"));
    await settle();
    expect(view.container.textContent).toContain("Words the deck kept.");
    expect(view.container.textContent).toMatch(/not in the vault any more/);
  });

  it("takes the pointer only once it is clicked, and then its links go on to the host", async () => {
    const onLink = vi.fn();
    const view = render(<EmbedFrame item={item(embed({ url: "", source: { ...snapshot, markdown: "A [[Other]] link.\n" } }))} theme={theme} onLink={onLink} />);
    // Looked at: its links do not answer.
    expect(view.container.querySelector("[data-href]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Use Plan|Use Embedded page/ }));
    fireEvent.click(view.container.querySelector("[data-href]")!);
    expect(onLink).toHaveBeenCalledWith("page:Other");
  });
});
