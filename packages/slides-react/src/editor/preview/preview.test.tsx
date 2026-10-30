// A web page in the editor: Preview live opens it in the peek beside the slide when the host has one; without one the selected embed is
// shown live in a frame in the page, where the page allows it, and a page that is refused or slow says so.

import type { Element } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EmbedLayer } from "../../embed/EmbedLayer.tsx";
import { plainDeck } from "../../render/testing/decks.ts";
import { COMMANDS, isEnabled, runCommand } from "../commands/index.ts";
import { expectFocusOn } from "../focus/testing.ts";
import { openDeck } from "../filmstrip/test-support.ts";
import type { SlidesHost } from "../host.ts";
import { MemoryHost } from "../memory-host.ts";
import { Workspace } from "../SlidesEditor.tsx";
import type { WebPreviewEvent, WebPreviewHandle, WebPreviewHost } from "../web-preview-host.ts";
import { previewOf } from "./preview-store.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WEB = "https://example.com/docs";
const web = (extra: Record<string, unknown> = {}) => ({ type: "embed", id: "", url: WEB, x: 100, y: 100, w: 400, h: 250, ...extra }) as unknown as Element;

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fakePreview(options: { handle?: boolean } = {}) {
  const listeners = new Set<(event: WebPreviewEvent) => void>();
  const handle = {
    place: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    reload: vi.fn(),
    openExternal: vi.fn(),
    hide: vi.fn(),
    show: vi.fn(),
    close: vi.fn(),
    subscribe: vi.fn((listener: (event: WebPreviewEvent) => void) => {
      listeners.add(listener);
      // As the app's host does: what is known now is told to a listener that comes. The page is up (its view is shown only then).
      listener({ type: "state", state: { url: WEB, title: null, status: "ready" } });
      return () => listeners.delete(listener);
    }),
  } satisfies WebPreviewHandle;
  const open = vi.fn(async (): Promise<WebPreviewHandle | null> => (options.handle === false ? null : handle));
  const preview: WebPreviewHost = { open };
  return { preview, handle, open };
}

async function editor(extra: Partial<SlidesHost> = {}, elements: Element[] = [web()]) {
  const made = await openDeck({ slides: 2 });
  Object.assign(made.host, extra);
  const ids = made.session.elements.insert(elements);
  const view = render(<Workspace session={made.session} ui={made.ui} />);
  await act(async () => {});
  return { ...made, ...view, ids, stage: () => view.container.querySelector<HTMLElement>(".ks-stage")! };
}

const peek = () => document.querySelector<HTMLElement>(".ks-wp");

describe("Preview live", () => {
  it("is a command that can be done for one web page only", async () => {
    const kit = await editor({}, [web(), web({ url: "", source: { page: "notes/plan.md", kind: "embed" } }), web({ url: "javascript:alert(1)" })]);
    const [page, host, bad] = kit.ids as [string, string, string];
    const command = COMMANDS.get("embed.preview-live")!;
    expect(command.label).toBe("Preview live");
    act(() => kit.session.select([page]));
    expect(isEnabled(command, kit)).toBe(true);
    act(() => kit.session.select([host]));
    expect(isEnabled(command, kit)).toBe(false);
    act(() => kit.session.select([bad]));
    expect(isEnabled(command, kit)).toBe(false);
    act(() => kit.session.select([page, host]));
    expect(isEnabled(command, kit)).toBe(false);
    act(() => kit.session.select([]));
    expect(isEnabled(command, kit)).toBe(false);
  });

  it("opens the page in the peek beside the slide, in the host's view, where the host has one", async () => {
    const { preview, open } = fakePreview();
    const kit = await editor({ webPreview: preview });
    act(() => kit.session.select([kit.ids[0]!]));
    expect(peek()).toBeNull();
    await act(async () => runCommand("embed.preview-live", kit));
    expect(open).toHaveBeenCalledWith(WEB, expect.objectContaining({ mode: "side" }));
    expect(peek()?.dataset.surface).toBe("editor");
    expect(peek()?.closest(".ks-body")).not.toBeNull();
    expect(previewOf(kit.session).getSnapshot()).toBe(WEB);
  });

  it("is closed with Escape, which gives the keys back to the slide", async () => {
    const { preview, handle } = fakePreview();
    const kit = await editor({ webPreview: preview });
    act(() => kit.session.select([kit.ids[0]!]));
    await act(async () => runCommand("embed.preview-live", kit));
    fireEvent.keyDown(peek()!, { key: "Escape" });
    expect(peek()).toBeNull();
    expect(handle.close).toHaveBeenCalledTimes(1);
    expectFocusOn(kit.stage());
    // The slide's Escape was not taken: it still clears the selection.
    fireEvent.keyDown(kit.stage(), { key: "Escape" });
    expect(kit.session.state.selection).toEqual([]);
  });

  it("is one page at a time: another address navigates the peek", async () => {
    const { preview, open } = fakePreview();
    const kit = await editor({ webPreview: preview }, [web(), web({ url: "https://example.org/other", x: 600 })]);
    const [a, b] = kit.ids as [string, string];
    act(() => kit.session.select([a]));
    await act(async () => runCommand("embed.preview-live", kit));
    act(() => kit.session.select([b]));
    await act(async () => runCommand("embed.preview-live", kit));
    expect(document.querySelectorAll(".ks-wp")).toHaveLength(1);
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenLastCalledWith("https://example.org/other", expect.anything());
  });

  it("opens the address outside, in the host's way, where the host has no peek", async () => {
    const openUrl = vi.fn();
    const kit = await editor({ openUrl });
    act(() => kit.session.select([kit.ids[0]!]));
    await act(async () => runCommand("embed.preview-live", kit));
    expect(openUrl).toHaveBeenCalledWith(WEB);
    expect(peek()).toBeNull();
  });

  it("opens it in a window that shares nothing with the slide when the host has no way at all", async () => {
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    const kit = await editor();
    act(() => kit.session.select([kit.ids[0]!]));
    await act(async () => runCommand("embed.preview-live", kit));
    expect(opened).toHaveBeenCalledWith(WEB, "_blank", "noopener,noreferrer");
  });

  it("is a button on the chip over the selected page, with Open externally, and not over a page of the host", async () => {
    const { preview, open } = fakePreview();
    const openUrl = vi.fn();
    const kit = await editor({ webPreview: preview, openUrl }, [web(), web({ url: "", source: { page: "notes/plan.md", kind: "embed" }, x: 600 })]);
    const [page, host] = kit.ids as [string, string];
    act(() => kit.session.select([page]));
    const chip = document.querySelector<HTMLElement>(".ks-embed-controls")!;
    expect(chip.querySelector('[aria-label="Preview live"]')).not.toBeNull();
    fireEvent.click(chip.querySelector('[aria-label="Open externally"]')!);
    expect(openUrl).toHaveBeenCalledWith(WEB);
    await act(async () => fireEvent.click(chip.querySelector('[aria-label="Preview live"]')!));
    expect(open).toHaveBeenCalledTimes(1);
    act(() => kit.session.select([host]));
    const other = document.querySelector<HTMLElement>(".ks-embed-controls")!;
    expect(other.querySelector('[aria-label="Preview live"]')).toBeNull();
    expect(other.querySelector('[aria-label="Open externally"]')).toBeNull();
  });

  it("is a row of the menu on the embed, for a web page", async () => {
    const kit = await editor({}, [web(), web({ url: "", source: { page: "notes/plan.md", kind: "embed" }, x: 600 })]);
    const [page, host] = kit.ids as [string, string];
    act(() => kit.session.select([page]));
    act(() => kit.ui.openContextMenu({ kind: "element", x: 10, y: 10 }));
    expect(screen.queryByRole("menuitem", { name: /^Preview live/ })).not.toBeNull();
    act(() => kit.ui.openContextMenu(null));
    act(() => kit.session.select([host]));
    act(() => kit.ui.openContextMenu({ kind: "element", x: 10, y: 10 }));
    expect(screen.queryByRole("menuitem", { name: /^Preview live/ })).toBeNull();
  });

  it("steps aside for a dialog of the editor that opens over it, and comes back", async () => {
    const { preview, handle } = fakePreview();
    const kit = await editor({ webPreview: preview });
    act(() => kit.session.select([kit.ids[0]!]));
    await act(async () => runCommand("embed.preview-live", kit));
    handle.hide.mockClear();
    handle.show.mockClear();
    act(() => kit.ui.openDialog("shortcuts"));
    expect(handle.hide).toHaveBeenCalled();
    act(() => kit.ui.openDialog(null));
    expect(handle.show).toHaveBeenCalled();
  });

  it("says so, with a way to switch previews on, when the host cannot show one", async () => {
    const { preview } = fakePreview({ handle: false });
    const turnOn = vi.fn();
    const kit = await editor({ webPreview: { ...preview, turnOn } });
    act(() => kit.session.select([kit.ids[0]!]));
    await act(async () => runCommand("embed.preview-live", kit));
    fireEvent.click(screen.getByRole("button", { name: "Turn on web previews" }));
    expect(turnOn).toHaveBeenCalledTimes(1);
  });
});

describe("the editor's own frame for a web page", () => {
  const scene = (host: SlidesHost) => {
    const { deck, slide } = plainDeck([{ type: "embed", id: "e", x: 10, y: 20, w: 300, h: 200, url: WEB } as unknown as Element]);
    return <EmbedLayer deck={deck} slide={slide} step={undefined} selection={["e"]} host={host} imageUrl={() => undefined} />;
  };

  it("is made for the selected page where the host has no peek and does not frame for itself", () => {
    const view = render(scene(new MemoryHost()));
    expect(view.container.querySelector("iframe")?.getAttribute("src")).toBe(WEB);
    expect(view.container.querySelector<HTMLIFrameElement>("iframe")?.style.opacity).toBe("0");
  });

  it("is never made where the host has a peek of its own, nor where it must permit frames first", () => {
    const withPeek = new MemoryHost();
    withPeek.webPreview = fakePreview().preview;
    expect(render(scene(withPeek)).container.querySelector("iframe")).toBeNull();
    cleanup();
    const permits = new MemoryHost();
    Object.assign(permits, { willPresent: () => {} });
    expect(render(scene(permits)).container.querySelector("iframe")).toBeNull();
  });

  it("is not made for a page that is not selected", () => {
    const { deck, slide } = plainDeck([{ type: "embed", id: "e", x: 10, y: 20, w: 300, h: 200, url: WEB } as unknown as Element]);
    const view = render(<EmbedLayer deck={deck} slide={slide} step={undefined} selection={[]} host={new MemoryHost()} imageUrl={() => undefined} />);
    expect(view.container.querySelector("iframe")).toBeNull();
  });

  it("says in words when the page is refused, and shows it when it has loaded; nothing is taken away on a guess", async () => {
    const view = render(scene(new MemoryHost()));
    const frame = view.container.querySelector("iframe")!;
    const event = new Event("securitypolicyviolation", { bubbles: true });
    Object.assign(event, { effectiveDirective: "frame-src", violatedDirective: "frame-src", blockedURI: WEB });
    await act(async () => void document.dispatchEvent(event));
    expect(view.container.querySelector(".ks-embed-card")?.textContent).toMatch(/can't be shown inside a slide/);
    // The card is words only: this layer takes no pointer, and the chip over the selection has the buttons.
    expect(view.container.querySelector(".ks-embed-card button")).toBeNull();
    expect(view.container.querySelector("iframe")).toBe(frame);
  });
});
