// Pasting a link onto a slide: one web address is an embed (a video's player for a video site), Paste in place keeps the words, and
// words with a link in them are words. A link let go on the slide is the same.

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDeck } from "../filmstrip/test-support.ts";
import { askInPlace, forget } from "./store.ts";
import { Workspace } from "../SlidesEditor.tsx";

afterEach(cleanup);
beforeEach(forget);

function transfer(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getData: (type: string) => data.get(type) ?? "", setData: (type: string, value: string) => void data.set(type, value), files: [] as File[], types: [...data.keys()] };
}

async function open() {
  const made = await openDeck({ slides: 1 });
  made.session.slides.add({ layout: "blank" });
  made.session.select([]);
  const view = render(<Workspace session={made.session} ui={made.ui} />);
  const stage = () => view.container.querySelector<HTMLElement>(".ks-stage")!;
  return { ...made, view, stage };
}

describe("pasting one web address", () => {
  it("makes an embed of an ordinary page, selected, in one step of undo", async () => {
    const made = await open();
    fireEvent.paste(made.stage(), { clipboardData: transfer({ "text/plain": "https://example.com/docs\n" }) });
    const [one, ...more] = made.session.slide.elements;
    expect(more).toHaveLength(0);
    expect(one).toMatchObject({ type: "embed", url: "https://example.com/docs", design: { w: 1280, h: 800 } });
    expect(made.session.state.selection).toEqual([one?.id]);
    act(() => made.session.undo());
    expect(made.session.slide.elements).toHaveLength(0);
  });

  it("makes a 16:9 player of a video site's link, and asks the host for its picture", async () => {
    const made = await open();
    const fetchPoster = vi.fn(async () => null);
    Object.assign(made.host, { fetchPoster });
    fireEvent.paste(made.stage(), { clipboardData: transfer({ "text/plain": "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s" }) });
    expect(made.session.slide.elements[0]).toMatchObject({ type: "embed", provider: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s", design: { w: 1280, h: 720 } });
    expect(fetchPoster).toHaveBeenCalledWith(expect.objectContaining({ provider: "youtube", id: "dQw4w9WgXcQ" }));
  });

  it("is words when it is Paste in place (Ctrl+Shift+V), which keeps the text", async () => {
    const made = await open();
    askInPlace();
    fireEvent.paste(made.stage(), { clipboardData: transfer({ "text/plain": "https://example.com/docs" }) });
    expect(made.session.slide.elements[0]).toMatchObject({ type: "text" });
  });

  it("is words when there are other words with it, or two links", async () => {
    const made = await open();
    fireEvent.paste(made.stage(), { clipboardData: transfer({ "text/plain": "see https://example.com/docs for more" }) });
    fireEvent.paste(made.stage(), { clipboardData: transfer({ "text/plain": "https://a.example\nhttps://b.example" }) });
    expect(made.session.slide.elements.map((e) => e.type)).toEqual(["text", "text"]);
  });
});
