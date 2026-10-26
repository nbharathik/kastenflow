// A smart page as a block inside another page: its named view, its height, at
// most four running at once, waiting for "Allow to run" when an agent made it,
// and stopping with the switch.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BridgeHost } from "./bridge-host";
import { running } from "./live-frames";
import { forgetRunSwitch } from "./run-switch";
import { SmartBlock, type SmartBlockProps } from "./SmartBlock";
import { FakeBackend, request } from "./test-support/fake-frame";
import { FakeObserver } from "./test-support/observer";

const PAGE = "library/conference-tracker.md";

const block = (backend: FakeBackend, extra: Partial<SmartBlockProps> = {}) => (
  <SmartBlock pagePath={PAGE} pageId="01SMART" title="Conference tracker" scope="library/host.md" backend={backend} {...extra} />
);

const frames = (container: HTMLElement) => container.querySelectorAll("iframe");
const blocks = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>(".kasten-smart-block")];

/** Everything is in view; polled until `done` holds, since a frame appears after the app has answered. */
async function reveal(done: () => void) {
  await waitFor(() => {
    FakeObserver.show(true);
    done();
  });
}

function say(data: unknown, source: unknown) {
  const event = new MessageEvent("message", { data });
  Object.defineProperty(event, "source", { value: source });
  act(() => void window.dispatchEvent(event));
}

beforeEach(() => {
  FakeObserver.reset();
  forgetRunSwitch();
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (globalThis as unknown as { isTauri?: boolean }).isTauri;
});

describe("one block", () => {
  it("loads when it is scrolled into view, and not before", async () => {
    const backend = new FakeBackend();
    const { container } = render(block(backend));
    await Promise.resolve();
    expect(frames(container)).toHaveLength(0);
    expect(backend.made).toEqual([]);
    await reveal(() => expect(frames(container)).toHaveLength(1));
    expect(backend.made).toHaveLength(1);
  });

  it("starts at the height the page asks for, follows what it asks later, and never grows past 1,200 px", async () => {
    const backend = new FakeBackend();
    const { container } = render(block(backend));
    await reveal(() => expect(frames(container)).toHaveLength(1));
    const frame = container.querySelector("iframe")!;
    expect(frame.style.height).toBe("300px");
    say(request(1, "resize", { px: 900 }), frame.contentWindow);
    // The manifest says 500 at most.
    await waitFor(() => expect(frame.style.height).toBe("500px"));
    cleanup();

    const free = new FakeBackend();
    free.pageInfo = { height: null, maxHeight: null };
    const open = render(block(free));
    await reveal(() => expect(frames(open.container)).toHaveLength(1));
    const tall = open.container.querySelector("iframe")!;
    say(request(1, "resize", { px: 5000 }), tall.contentWindow);
    await waitFor(() => expect(tall.style.height).toBe("1200px"));
  });

  it("is told the named view and loads that view's file when the manifest names one", async () => {
    const backend = new FakeBackend();
    backend.pageInfo = { views: [{ name: "deadlines", title: "Deadlines", entry: "views/deadlines.html" }, { name: "map", title: null, entry: null }] };
    const { container } = render(block(backend, { view: "Deadlines" }));
    await reveal(() => expect(frames(container)).toHaveLength(1));
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toMatch(/\/01SMART\/views\/deadlines\.html$/);
    const sent: unknown[] = [];
    vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(((message: unknown) => void sent.push(message)) as Window["postMessage"]);
    fireEvent.load(frame);
    expect(sent[0]).toMatchObject({ event: "init", pageId: "01SMART", view: "deadlines" });
    cleanup();

    // A view the manifest gives no file for is drawn by the page's own index, which is told the name.
    const other = render(block(backend, { view: "map" }));
    await reveal(() => expect(frames(other.container)).toHaveLength(1));
    const second = other.container.querySelector("iframe")!;
    expect(second.getAttribute("src")).toMatch(/\/01SMART\/index\.html$/);
    const heard: unknown[] = [];
    vi.spyOn(second.contentWindow!, "postMessage").mockImplementation(((message: unknown) => void heard.push(message)) as Window["postMessage"]);
    fireEvent.load(second);
    expect(heard[0]).toMatchObject({ event: "init", view: "map" });
  });

  it("is paused while the window is in the background, and wakes again", async () => {
    const pause = vi.spyOn(BridgeHost.prototype, "setPaused");
    const backend = new FakeBackend();
    const { container } = render(block(backend));
    await reveal(() => expect(frames(container)).toHaveLength(1));
    await waitFor(() => expect(pause).toHaveBeenLastCalledWith(false));
    const state = vi.spyOn(document, "visibilityState", "get");
    state.mockReturnValue("hidden");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(pause).toHaveBeenLastCalledWith(true);
    state.mockReturnValue("visible");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(pause).toHaveBeenLastCalledWith(false);
  });

  it("shows the errors the page ran into, from the app's log", async () => {
    const backend = new FakeBackend();
    backend.log = { records: [{ time: "2026-10-23T10:00:00Z", kind: "error", message: "boom", source: "app.js", line: 3 }, { time: "2026-10-23T10:01:00Z", kind: "error", message: "bang", source: "app.js", line: 9 }] };
    const { container } = render(block(backend));
    await reveal(() => expect(frames(container)).toHaveLength(1));
    fireEvent.click(await screen.findByRole("button", { name: "2 errors" }));
    expect(screen.getByRole("region", { name: "Errors in this page" }).textContent).toContain("bang");
  });

  it("says what it needs when the page has no view yet, and when it cannot be read", async () => {
    const backend = new FakeBackend();
    backend.pageInfo = { ready: false };
    const first = render(block(backend));
    await waitFor(() => expect(first.container.textContent).toContain("no view yet"));
    expect(frames(first.container)).toHaveLength(0);
    cleanup();
    const broken = new FakeBackend();
    broken.info = async () => {
      throw new Error("not a smart page");
    };
    const second = render(block(broken));
    await waitFor(() => expect(second.container.textContent).toContain("could not be opened as a smart page"));
  });

  it("is a sentence and no frame outside the app", () => {
    const { container } = render(<SmartBlock pagePath={PAGE} pageId="01SMART" title="Tracker" scope="library/host.md" />);
    expect(container.textContent).toContain("open in the KastenFlow app");
    expect(frames(container)).toHaveLength(0);
  });
});

describe("at most four run at once in a page", () => {
  const six = (backend: FakeBackend) => render(<div>{Array.from({ length: 6 }, (_, n) => <SmartBlock key={n} pagePath={`${PAGE}${n}`} pageId={`0${n}`} title={`Block ${n}`} scope="library/host.md" backend={backend} />)}</div>);

  /** Four frames up and two blocks waiting. */
  const running4 = (container: HTMLElement) =>
    reveal(() => {
      expect(frames(container)).toHaveLength(4);
      expect(screen.getAllByRole("button", { name: "Click to run" })).toHaveLength(2);
    });

  it("runs the first four and makes the others wait behind Click to run", async () => {
    const backend = new FakeBackend();
    const { container } = six(backend);
    await running4(container);
    expect(frames(container)).toHaveLength(4);
    await waitFor(() => expect(backend.live.size).toBe(4));
    expect(running("library/host.md")).toBe(4);
    // The two that wait are the last two, and say which they are.
    const waiting = blocks(container).filter((b) => b.dataset.place === "waiting");
    expect(waiting.map((b) => b.textContent)).toEqual(["Click to runBlock 4", "Click to runBlock 5"]);
  });

  it("refuses a click while all four are in view, and says why", async () => {
    const backend = new FakeBackend();
    const { container } = six(backend);
    await running4(container);
    fireEvent.click(screen.getAllByRole("button", { name: "Click to run" })[0]!);
    expect(await screen.findByText(/already runs 4 smart blocks/)).toBeTruthy();
    expect(frames(container)).toHaveLength(4);
  });

  it("gives a click the place of a block that is scrolled away, which then waits its turn", async () => {
    const backend = new FakeBackend();
    const { container } = six(backend);
    await running4(container);
    const first = blocks(container)[0]!;
    FakeObserver.show(false, first);
    fireEvent.click(screen.getAllByRole("button", { name: "Click to run" })[0]!);
    await waitFor(() => expect(first.dataset.place).toBe("waiting"));
    await reveal(() => expect(blocks(container).filter((b) => b.dataset.place === "live")).toHaveLength(4));
    // Four run, the scrolled-away one is not among them, and the app holds four frames.
    expect(first.querySelector("iframe")).toBeNull();
    expect(first.textContent).toContain("Click to run");
    await waitFor(() => expect(backend.live.size).toBe(4));
  });

  it("frees a place when a block goes away", async () => {
    const backend = new FakeBackend();
    const { container, rerender } = six(backend);
    await running4(container);
    // The first block (one of the four that run) is taken out of the page.
    rerender(<div>{Array.from({ length: 5 }, (_, n) => <SmartBlock key={n + 1} pagePath={`${PAGE}${n + 1}`} pageId={`0${n + 1}`} title={`Block ${n + 1}`} scope="library/host.md" backend={backend} />)}</div>);
    await waitFor(() => expect(running("library/host.md")).toBe(3));
    fireEvent.click(screen.getAllByRole("button", { name: "Click to run" })[0]!);
    await reveal(() => expect(frames(container)).toHaveLength(4));
  });

  it("counts each page on its own", async () => {
    const backend = new FakeBackend();
    const { container } = render(
      <div>
        {Array.from({ length: 4 }, (_, n) => (
          <SmartBlock key={`a${n}`} pagePath={`${PAGE}${n}`} pageId={`0${n}`} title={`A${n}`} scope="library/one.md" backend={backend} />
        ))}
        {Array.from({ length: 4 }, (_, n) => (
          <SmartBlock key={`b${n}`} pagePath={`${PAGE}b${n}`} pageId={`1${n}`} title={`B${n}`} scope="library/two.md" backend={backend} />
        ))}
      </div>,
    );
    await reveal(() => expect(frames(container)).toHaveLength(8));
    expect(screen.queryByRole("button", { name: "Click to run" })).toBeNull();
  });
});

describe("a page an agent made", () => {
  it("waits for Allow to run, runs nothing before it, and keeps the choice", async () => {
    const backend = new FakeBackend();
    backend.trustOf = { madeBy: "claude-code", needsAllow: true, allowed: false };
    const { container } = render(block(backend));
    FakeObserver.show(true);
    expect(await screen.findByText("Made by Claude Code")).toBeTruthy();
    FakeObserver.show(true);
    // Nothing started: no secret, no frame.
    expect(frames(container)).toHaveLength(0);
    expect(backend.made).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Allow to run" }));
    await waitFor(() => expect(backend.allowed).toEqual([PAGE]));
    await reveal(() => expect(frames(container)).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "Allow to run" })).toBeNull();
  });

  it("shows one sentence when the choice could not be kept", async () => {
    const backend = new FakeBackend();
    backend.trustOf = { madeBy: "claude-code", needsAllow: true, allowed: false };
    backend.allowRun = async () => {
      throw new Error("KastenFlow has no place to keep this choice.");
    };
    render(block(backend));
    fireEvent.click(await screen.findByRole("button", { name: "Allow to run" }));
    expect((await screen.findByRole("alert")).textContent).toContain("no place to keep this choice");
  });

  it("is not asked about when a person made it", async () => {
    const backend = new FakeBackend();
    const { container } = render(block(backend));
    await reveal(() => expect(frames(container)).toHaveLength(1));
    expect(screen.queryByText(/Made by/)).toBeNull();
  });
});

describe("the Run smart pages switch", () => {
  it("shows a line and no frame while off, and runs the block again when turned on", async () => {
    const backend = new FakeBackend();
    backend.running = false;
    const { container } = render(block(backend));
    FakeObserver.show(true);
    await waitFor(() => expect(container.textContent).toContain("Smart pages are off — Turn on"));
    FakeObserver.show(true);
    expect(frames(container)).toHaveLength(0);
    expect(backend.made).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(backend.running).toBe(true));
    await reveal(() => expect(frames(container)).toHaveLength(1));
  });

  it("stops a running block at once when it goes off, and gives its place back", async () => {
    const backend = new FakeBackend();
    const { container } = render(block(backend));
    await reveal(() => expect(frames(container)).toHaveLength(1));
    expect(running("library/host.md")).toBe(1);
    const { setRunSwitch } = await import("./run-switch");
    await act(async () => void (await setRunSwitch(false, backend)));
    await waitFor(() => expect(frames(container)).toHaveLength(0));
    expect(container.textContent).toContain("Smart pages are off");
    expect(running("library/host.md")).toBe(0);
    await waitFor(() => expect(backend.live.size).toBe(0));
  });
});
