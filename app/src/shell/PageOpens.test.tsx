import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerPage } from "../features/workspace/page/open-page";
import { usePageLayouts } from "../features/workspace/page/page-layout";
import type { PageSession } from "../features/workspace/page/page-session";
import { usePrefs } from "../features/workspace/prefs";
import { askPageOpens, PageOpensMenu, useAskedPageOpens } from "./PageOpens";

const PATH = "library/a.md";
const editHeader = vi.fn();
const session = { path: PATH, editHeader, flush: vi.fn(async () => {}) } as unknown as PageSession;
let forget = () => {};
const anchor = { current: document.body };

const labels = () => [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].map((el) => [el.querySelector("span.flex-1")?.textContent, el.getAttribute("aria-checked")]);
const item = (label: string) => [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((el) => el.querySelector("span.flex-1")?.textContent === label)!;

beforeEach(() => {
  editHeader.mockClear();
  usePrefs.setState({ pageLinksOpen: "here" });
  forget = registerPage(session, () => {}, () => {});
  usePageLayouts.setState({ of: new Map([[session, {}]]) });
});
afterEach(() => {
  cleanup();
  forget();
  usePageLayouts.setState({ of: new Map() });
});

describe("Open links from this page in…", () => {
  it("offers Settings' choice and the six places, ticking the one in force", () => {
    render(<PageOpensMenu path={PATH} anchor={anchor} onClose={() => {}} />);
    expect(screen.getByRole("menu", { name: "Open links from this page in" })).toBeTruthy();
    expect(labels()).toEqual([
      ["As Settings say: the same tab", "true"],
      ["The same tab", "false"],
      ["A new tab", "false"],
      ["To the right", "false"],
      ["A side peek", "false"],
      ["A center peek", "false"],
      ["The side stack", "false"],
    ]);
  });

  it("says which place Settings choose, and ticks the page's own when it has one", () => {
    usePrefs.setState({ pageLinksOpen: "peek-side" });
    usePageLayouts.setState({ of: new Map([[session, { opens: "right" }]]) });
    render(<PageOpensMenu path={PATH} anchor={anchor} onClose={() => {}} />);
    expect(labels()[0]).toEqual(["As Settings say: a side peek", "false"]);
    expect(labels().filter(([, checked]) => checked === "true")).toEqual([["To the right", "true"]]);
  });

  it("writes the page's own choice to its `opens` key, and clears it again", async () => {
    const closed = vi.fn();
    render(<PageOpensMenu path={PATH} anchor={anchor} onClose={closed} />);
    await act(async () => fireEvent.click(item("To the right")));
    expect(editHeader).toHaveBeenLastCalledWith("opens", "right");
    expect(usePageLayouts.getState().of.get(session)).toEqual({ opens: "right" });
    expect(closed).toHaveBeenCalled();
    cleanup();

    render(<PageOpensMenu path={PATH} anchor={anchor} onClose={() => {}} />);
    expect(labels().filter(([, checked]) => checked === "true")).toEqual([["To the right", "true"]]);
    await act(async () => fireEvent.click(item("As Settings say: the same tab")));
    expect(editHeader).toHaveBeenLastCalledWith("opens", null);
    expect(usePageLayouts.getState().of.get(session)).toEqual({});
  });

  it("opens when the palette asks for this page's menu, and not for another page's", () => {
    const open = vi.fn();
    function Bar({ path }: { path: string }) {
      const ref = useRef<HTMLDivElement>(null);
      useAskedPageOpens(path, ref, open);
      return <div ref={ref} />;
    }
    render(<Bar path={PATH} />);
    act(() => askPageOpens("library/other.md"));
    expect(open).not.toHaveBeenCalled();
    act(() => askPageOpens(PATH));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("draws nothing for a page that is not open", () => {
    render(<PageOpensMenu path="library/other.md" anchor={anchor} onClose={() => {}} />);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
