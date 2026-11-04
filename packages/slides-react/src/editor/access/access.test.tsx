import type { Element, Issue } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { image, shape, table } from "../factory.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { isWebVtt } from "../dialogs/captions-file.ts";
import { AccessView } from "./AccessPanel.tsx";
import { ACCESS_RULES, checkAccess, countByRule, hasTitle } from "./check.ts";
import { moved, withStored } from "./reading-order.ts";

afterEach(cleanup);

const named = (element: Element, name: string): Element => ({ ...element, name }) as Element;
const issue = (rule: string, slide: string, element: string | undefined, message: string): Issue => ({ rule, severity: "info", slide, ...(element ? { element } : {}), message });

async function setup() {
  localStorage.clear();
  const session = new EditorSession(await newDeck("Access", "Light"), new MemoryHost(), { saveDelay: 60_000 });
  let ids: string[] = [];
  act(() => {
    session.slides.add({ layout: "blank" });
    ids = session.elements.insert([
      named(shape("rect", { x: 40, y: 40, w: 100, h: 60 }), "Alpha"),
      named(shape("rect", { x: 400, y: 40, w: 100, h: 60 }), "Beta"),
      image("assets/x.png", { x: 40, y: 200, w: 100, h: 100 }),
      { ...table(2, 2, { x: 200, y: 200, w: 300, h: 100 }), headerRow: false } as Element,
      { type: "video", id: "", src: "assets/clip.mp4", x: 600, y: 200, w: 200, h: 120 } as Element,
    ]);
  });
  return { session, ids };
}

describe("the check", () => {
  it("finds a slide with no title, and takes a hidden title for one", async () => {
    const { session } = await setup();
    const blank = session.slide.id;
    expect(hasTitle(session.slide)).toBe(false);
    expect(checkAccess(session.deck).filter((p) => p.rule === "slide-title").map((p) => p.number)).toEqual([2]);
    act(() => session.access.setTitle(blank, "  Opening  "));
    expect(session.slide.access?.title).toBe("Opening");
    expect(hasTitle(session.slide)).toBe(true);
    expect(checkAccess(session.deck).filter((p) => p.rule === "slide-title")).toEqual([]);
    act(() => session.access.setTitle(blank, ""));
    expect(session.slide.access).toBeUndefined();
  });

  it("takes a filled title slot for a title", async () => {
    const { session } = await setup();
    expect(hasTitle(session.deck.slides[0]!)).toBe(true);
  });

  it("finds a table with no header row and a video with no captions, and lets go when they are fixed", async () => {
    const { session, ids } = await setup();
    const slide = session.slide.id;
    const rules = () => checkAccess(session.deck).filter((p) => p.slide === slide).map((p) => p.rule);
    expect(rules()).toEqual(["slide-title", "table-header", "video-captions"]);
    act(() => session.access.makeHeader(slide, ids[3]!));
    act(() => session.access.setCaptions(slide, ids[4]!, "assets/clip.vtt"));
    expect(rules()).toEqual(["slide-title"]);
    act(() => session.access.setCaptions(slide, ids[4]!, null));
    expect(rules()).toEqual(["slide-title", "video-captions"]);
  });

  it("brings in lint's findings about pictures and contrast and leaves its other rules out, slide by slide in the deck's order", async () => {
    const { session, ids } = await setup();
    const [cover, second] = session.deck.slides.map((s) => s.id) as [string, string];
    const lint = new Map<string, readonly Issue[]>([
      [second, [issue("margin", second, ids[0], "Close to the edge."), issue("contrast", second, ids[0], "Weak contrast."), issue("missing-alt", second, ids[2], "No words.")]],
      [cover, [issue("missing-alt", cover, undefined, "Cover picture.")]],
    ]);
    const found = checkAccess(session.deck, lint).map((p) => `${p.number}:${p.rule}`);
    expect(found).toEqual(["1:missing-alt", "2:slide-title", "2:missing-alt", "2:contrast", "2:table-header", "2:video-captions"]);
    expect(countByRule(checkAccess(session.deck, lint))).toEqual({ "slide-title": 1, "missing-alt": 2, contrast: 1, "table-header": 1, "video-captions": 1 });
    expect(ACCESS_RULES.map((r) => r.rule)).toEqual(["slide-title", "missing-alt", "contrast", "table-header", "video-captions"]);
  });

  it("marks a picture as decoration with empty alt text, which is not the same as none, and takes it back", async () => {
    const { session, ids } = await setup();
    const slide = session.slide.id;
    act(() => session.access.markDecorative(slide, [ids[2]!]));
    expect(session.slide.elements.find((e) => e.id === ids[2])?.alt).toBe("");
    act(() => session.access.markDecorative(slide, [ids[2]!], false));
    expect(session.slide.elements.find((e) => e.id === ids[2])?.alt ?? null).toBeNull();
    act(() => session.access.describe(slide, ids[2]!, "A chart"));
    expect(session.slide.elements.find((e) => e.id === ids[2])?.alt).toBe("A chart");
  });
});

describe("the reading order", () => {
  it("puts the named elements first and the others after, in the usual order, and skips what is gone", () => {
    const usual = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    expect(withStored(usual, undefined).map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
    expect(withStored(usual, []).map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
    expect(withStored(usual, ["c", "gone", "a"]).map((e) => e.id)).toEqual(["c", "a", "b", "d"]);
  });

  it("moves one place to another", () => {
    expect(moved(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moved(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moved(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
    expect(moved(["a", "b", "c"], 0, 5)).toEqual(["a", "b", "c"]);
  });

  it("is kept on the slide when the panel changes it, in one step each, and goes back to the usual order", async () => {
    const { session, ids } = await setup();
    render(<AccessView session={session} issues={new Map()} checking={false} />);
    const order = () => within(screen.getByRole("region", { name: "Reading order" })).getAllByRole("listitem").map((li) => li.querySelector(".ks-ac-order-name")?.textContent);
    expect(order().slice(0, 2)).toEqual(["Alpha", "Beta"]);
    fireEvent.click(screen.getByRole("button", { name: "Read Alpha later" }));
    expect(order().slice(0, 2)).toEqual(["Beta", "Alpha"]);
    expect(session.slide.access?.readingOrder?.slice(0, 2)).toEqual([ids[1], ids[0]]);
    act(() => session.undo());
    expect(session.slide.access).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Read Beta earlier" }));
    expect(order().slice(0, 2)).toEqual(["Beta", "Alpha"]);
    fireEvent.click(screen.getByRole("button", { name: "Usual order" }));
    expect(session.slide.access).toBeUndefined();
  });

  it("can be changed by dragging an element to another place", async () => {
    const { session, ids } = await setup();
    render(<AccessView session={session} issues={new Map()} checking={false} />);
    const items = within(screen.getByRole("region", { name: "Reading order" })).getAllByRole("listitem");
    fireEvent.dragStart(items[0]!, { dataTransfer: { setData: () => {}, effectAllowed: "" } });
    fireEvent.dragOver(items[1]!);
    fireEvent.drop(items[1]!);
    expect(session.slide.access?.readingOrder?.slice(0, 2)).toEqual([ids[1], ids[0]]);
  });
});

describe("the panel", () => {
  it("lists the problems by kind with a fix beside each, and the fixes work", async () => {
    const { session, ids } = await setup();
    const slide = session.slide.id;
    const lint = new Map<string, readonly Issue[]>([[slide, [issue("missing-alt", slide, ids[2], "The picture has no alternative text.")]]]);
    render(<AccessView session={session} issues={lint} checking={false} />);
    expect(screen.getByRole("status").textContent).toBe("4 problems to look at.");
    expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-label")).slice(0, 4)).toEqual(["Slide titles", "Alt text", "Table headers", "Video captions"]);

    fireEvent.change(screen.getByLabelText("Hidden title for slide 2"), { target: { value: "Cover" } });
    fireEvent.click(screen.getByRole("button", { name: "Add hidden title" }));
    expect(session.slide.access?.title).toBe("Cover");

    fireEvent.click(screen.getByRole("button", { name: "Make first row a header" }));
    expect((session.slide.elements.find((e) => e.id === ids[3]) as { headerRow?: boolean }).headerRow).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Decorative" }));
    expect(session.slide.elements.find((e) => e.id === ids[2])?.alt).toBe("");
  });

  it("goes to the slide and the element a problem is about", async () => {
    const { session, ids } = await setup();
    const slide = session.slide.id;
    act(() => session.goTo(session.deck.slides[0]!.id));
    const lint = new Map<string, readonly Issue[]>([[slide, [issue("contrast", slide, ids[0], "Weak contrast on Alpha.")]]]);
    render(<AccessView session={session} issues={lint} checking={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Show on slide 2: Weak contrast on Alpha/ }));
    expect(session.state.slideId).toBe(slide);
    expect(session.state.selection).toEqual([ids[0]]);
  });

  it("says so when nothing is wrong, and when it is still looking", async () => {
    const { session } = await setup();
    const slide = session.slide.id;
    act(() => {
      session.access.setTitle(slide, "Titled");
      session.access.makeHeader(slide, session.slide.elements.find((e) => e.type === "table")!.id);
      session.access.markDecorative(slide, [session.slide.elements.find((e) => e.type === "image")!.id]);
      session.access.setCaptions(slide, session.slide.elements.find((e) => e.type === "video")!.id, "assets/c.vtt");
    });
    const view = render(<AccessView session={session} issues={new Map()} checking={false} />);
    expect(screen.getByRole("status").textContent).toBe("No accessibility problems found.");
    expect(screen.getByText("Nothing to fix")).toBeTruthy();
    view.unmount();
    act(() => session.access.setTitle(slide, ""));
    render(<AccessView session={session} issues={new Map()} checking />);
    expect(screen.getByRole("status").textContent).toBe("1 problem to look at.");
  });
});

describe("a captions file", () => {
  it("is WebVTT when it starts with WEBVTT", () => {
    expect(isWebVtt("WEBVTT\n\n00:00.000 --> 00:01.000\nHi")).toBe(true);
    expect(isWebVtt("﻿WEBVTT - a title")).toBe(true);
    expect(isWebVtt("1\n00:00:01,000 --> 00:00:02,000\nHi")).toBe(false);
    expect(isWebVtt("WEBVTTX")).toBe(false);
  });
});
