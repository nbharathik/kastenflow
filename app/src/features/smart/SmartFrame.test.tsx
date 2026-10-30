// A smart page's frame: sandboxed to its own scripts and nothing more, loaded
// when it is scrolled into view from an address with a secret of its own,
// paused while hidden, and heard only through its own window.

import { act, cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NO_REVISION, useRevision } from "../workspace/revision";
import { BridgeHost } from "./bridge-host";
import { SMART_SANDBOX } from "./schema";
import { SmartFrame, type SmartFrameProps } from "./SmartFrame";
import { FakeBackend, request } from "./test-support/fake-frame";
import { frameUrl } from "./urls";

// The frame answers through the window's message queue: a busy CI machine needs more than the 1 s default to hear it.
configure({ asyncUtilTimeout: 5000 });

class FakeObserver {
  static all: FakeObserver[] = [];
  constructor(private readonly callback: (entries: { isIntersecting: boolean }[]) => void) {
    FakeObserver.all.push(this);
  }
  observe() {}
  disconnect() {
    FakeObserver.all = FakeObserver.all.filter((o) => o !== this);
  }
  static show(isIntersecting: boolean) {
    act(() => FakeObserver.all.forEach((o) => o.callback([{ isIntersecting }])));
  }
}

const PROPS: SmartFrameProps = { pagePath: "projects/trip/tracker.md", pageId: "01PAGE", title: "Tracker", height: 300, maxHeight: 500 };

/** Puts a recorder on the window the frame holds now. A slow machine may give the frame a new window after it loads: the recorder follows it. */
let rehook: (() => void) | null = null;

/** Renders the frame on screen, with the app behind it faked, and gives the window the frame holds with its postMessage recorded. */
async function mount(extra: Partial<SmartFrameProps> = {}, backend = new FakeBackend()) {
  FakeObserver.show(true);
  const view = render(<SmartFrame {...PROPS} backend={backend} {...extra} />);
  FakeObserver.show(true);
  // The frame appears once the app has made its secret.
  const frame = await waitFor(() => {
    const found = view.container.querySelector("iframe");
    if (!found) throw new Error("the frame is not there yet");
    return found;
  });
  const sent: unknown[] = [];
  const recorded = new WeakSet<object>();
  rehook = () => {
    const held = frame.contentWindow;
    if (!held || recorded.has(held)) return;
    recorded.add(held);
    vi.spyOn(held, "postMessage").mockImplementation(((message: unknown) => void sent.push(message)) as Window["postMessage"]);
  };
  rehook();
  return { ...view, frame, sent, backend };
}

/** The answers among what the frame was sent (it is greeted before the first of them). */
const answersIn = (sent: unknown[]) => sent.filter((m) => typeof m === "object" && m !== null && "ok" in m);

/** One message as the window hears it, from `source`. */
function say(data: unknown, source: unknown) {
  rehook?.();
  const event = new MessageEvent("message", { data });
  Object.defineProperty(event, "source", { value: source });
  act(() => void window.dispatchEvent(event));
}

beforeEach(() => {
  FakeObserver.all = [];
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useRevision.setState({ revision: NO_REVISION });
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe("the frame", () => {
  it("has the sandbox allow-scripts and no other token, and nothing that widens it", async () => {
    const { frame } = await mount();
    expect(frame).not.toBeNull();
    expect(SMART_SANDBOX).toBe("allow-scripts");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    const tokens = frame.getAttribute("sandbox")!.split(/\s+/).filter(Boolean);
    expect(tokens).toEqual(["allow-scripts"]);
    for (const token of ["allow-same-origin", "allow-popups", "allow-popups-to-escape-sandbox", "allow-top-navigation", "allow-top-navigation-by-user-activation", "allow-top-navigation-to-custom-protocols", "allow-forms", "allow-modals", "allow-downloads", "allow-pointer-lock", "allow-presentation", "allow-orientation-lock"]) {
      expect(tokens.includes(token), token).toBe(false);
    }
    // No inline document, no delegated powers, no policy of its own to relax.
    for (const attribute of ["srcdoc", "allow", "allowfullscreen", "allowpaymentrequest", "csp", "credentialless"]) expect(frame.hasAttribute(attribute), attribute).toBe(false);
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.getAttribute("title")).toBe("Tracker");
  });

  it("is loaded from the smart scheme, from its own secret and the page's own id, and from nowhere else", async () => {
    const first = await mount();
    expect(first.frame.getAttribute("src")).toBe(`smart://localhost/${first.backend.made[0]}/01PAGE/index.html`);
    cleanup();
    const view = await mount({ entry: "views/overview.html", pageId: "01OTHER" });
    expect(view.frame.getAttribute("src")).toBe(`smart://localhost/${view.backend.made[0]}/01OTHER/views/overview.html`);
    // Where a web view knows only http, the same address in its other form.
    cleanup();
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      convertFileSrc: (path: string, protocol: string) => `http://${protocol}.localhost/${encodeURIComponent(path)}`,
    };
    const windows = await mount();
    expect(windows.frame.getAttribute("src")).toBe(`http://smart.localhost/${windows.backend.made[0]}/01PAGE/index.html`);
    // A name with a slash, a dot or a space can never become more parts of the path.
    expect(frameUrl("f".repeat(64), "a/b", "x/../y z.html")).toMatch(/\/a%2Fb\/x\/\.\.\/y%20z\.html$/);
  });

  it("is not loaded until it is scrolled into view, and says so meanwhile", async () => {
    const { container } = render(<SmartFrame {...PROPS} backend={new FakeBackend()} />);
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Loading");
    FakeObserver.show(true);
    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
    // Scrolled away again, it stays loaded.
    FakeObserver.show(false);
    expect(container.querySelector("iframe")).not.toBeNull();
  });

  it("makes no secret for a frame that is not on screen yet", async () => {
    const backend = new FakeBackend();
    render(<SmartFrame {...PROPS} backend={backend} />);
    await Promise.resolve();
    expect(backend.made).toEqual([]);
  });

  it("is a plain sentence and no frame outside the app", () => {
    FakeObserver.show(true);
    const { container } = render(<SmartFrame {...PROPS} />);
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("open in the KastenFlow app");
  });

  it("starts at the height it is given, within what it may have, and follows what the page asks for", async () => {
    const { frame, sent } = await mount();
    expect(frame.style.height).toBe("300px");
    say(request(1, "resize", { px: 900 }), frame.contentWindow);
    await waitFor(() => expect(frame.style.height).toBe("500px"));
    say(request(2, "resize", { px: 120 }), frame.contentWindow);
    await waitFor(() => expect(frame.style.height).toBe("120px"));
    expect(answersIn(sent)).toHaveLength(2);
    cleanup();
    const tall = await mount({ height: 5000, maxHeight: 9000 });
    expect(tall.frame.style.height).toBe("1200px");
    cleanup();
    const filled = await mount({ fill: true });
    expect(filled.frame.style.height).toBe("");
    say(request(1, "resize", { px: 200 }), filled.frame.contentWindow);
    await waitFor(() => expect(answersIn(filled.sent)).toHaveLength(1));
    expect(filled.frame.style.height).toBe("");
  });
});

describe("the frame's secret", () => {
  it("is made for each frame, so two frames of one page have two", async () => {
    const backend = new FakeBackend();
    const a = await mount({}, backend);
    const b = await mount({}, backend);
    expect(backend.made).toHaveLength(2);
    expect(backend.made[0]).not.toBe(backend.made[1]);
    expect(a.frame.getAttribute("src")).not.toBe(b.frame.getAttribute("src"));
    expect(a.frame.getAttribute("src")).toContain(backend.made[0]);
    expect(b.frame.getAttribute("src")).toContain(backend.made[1]);
  });

  it("ends with the frame: the app is told when the frame is unmounted", async () => {
    const { unmount, backend } = await mount();
    expect([...backend.live]).toEqual(backend.made);
    unmount();
    expect(backend.live.size).toBe(0);
    expect(backend.closed).toEqual(backend.made);
  });

  it("is a new one when the frame loads again, and the old one ends", async () => {
    const backend = new FakeBackend();
    const view = await mount({ reloadKey: 1 }, backend);
    const first = view.frame.getAttribute("src");
    view.rerender(<SmartFrame {...PROPS} backend={backend} reloadKey={2} />);
    await waitFor(() => expect(view.container.querySelector("iframe")?.getAttribute("src")).not.toBe(first));
    expect(backend.made).toHaveLength(2);
    expect(backend.closed).toEqual([backend.made[0]]);
    expect([...backend.live]).toEqual([backend.made[1]]);
    expect(view.container.querySelector("iframe")?.getAttribute("src")).toContain(backend.made[1]);
    expect(view.container.querySelector("iframe")?.getAttribute("src")).not.toContain(backend.made[0]!);
  });

  it("is ended at once when the frame went away while the app was still making it", async () => {
    const backend = new FakeBackend();
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const made = backend.openFrame.bind(backend);
    backend.openFrame = async () => {
      const frame = await made();
      await held;
      return frame;
    };
    FakeObserver.show(true);
    const view = render(<SmartFrame {...PROPS} backend={backend} />);
    FakeObserver.show(true);
    view.unmount();
    release();
    await waitFor(() => expect(backend.closed).toEqual(backend.made));
    expect(backend.live.size).toBe(0);
  });

  it("says so in plain words when the app cannot make one, and shows no frame", async () => {
    const backend = new FakeBackend();
    backend.failOpen = true;
    FakeObserver.show(true);
    const { container } = render(<SmartFrame {...PROPS} backend={backend} />);
    FakeObserver.show(true);
    await waitFor(() => expect(container.textContent).toContain("could not be started"));
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("goes with every call the frame makes", async () => {
    const { frame, backend } = await mount();
    say(request(1, "query", { tag: "venue" }), frame.contentWindow);
    say(request(2, "report", { kind: "error", message: "boom" }), frame.contentWindow);
    await waitFor(() => expect(backend.askedBy).toHaveLength(2));
    expect(backend.askedBy).toEqual([backend.made[0], backend.made[0]]);
  });
});

describe("what the window hears", () => {
  it("greets the frame when it loads and answers its requests through the bridge", async () => {
    const { frame, sent, backend } = await mount();
    backend.answer = () => [{ id: "a", title: "A venue" }];
    fireEvent.load(frame);
    expect(sent[0]).toEqual({ event: "init", pageId: "01PAGE", theme: "light" });
    say(request(1, "query", { tag: "venue" }), frame.contentWindow);
    await waitFor(() => expect(sent).toContainEqual({ id: 1, ok: true, value: [{ id: "a", title: "A venue" }] }));
    expect(backend.asked).toEqual([{ page: PROPS.pagePath, call: { kind: "query", args: { tag: "venue" } } }]);
    // Messages go to the frame's own window, to be read by it alone.
    const post = frame.contentWindow!.postMessage as unknown as ReturnType<typeof vi.fn>;
    expect(post.mock.calls.every((call) => call[1] === "*")).toBe(true);
  });

  it("hears the frame's window and nobody else's", async () => {
    const { frame, sent, backend } = await mount();
    const stranger = document.createElement("iframe");
    document.body.append(stranger);
    for (const source of [window, stranger.contentWindow, null, undefined, {}]) say(request(1, "query", { tag: "venue" }), source);
    await Promise.resolve();
    expect(backend.asked).toEqual([]);
    expect(sent).toEqual([]);
    stranger.remove();
    say(request(1, "theme"), frame.contentWindow);
    await waitFor(() => expect(answersIn(sent)).toHaveLength(1));
  });

  it("hears nothing once the frame is gone, and stops watching the vault", async () => {
    const original = useRevision.subscribe;
    let stopped = 0;
    vi.spyOn(useRevision, "subscribe").mockImplementation(((listener: Parameters<typeof original>[0]) => {
      const off = original(listener);
      return () => {
        stopped += 1;
        off();
      };
    }) as typeof original);
    const { frame, sent, unmount, backend } = await mount();
    say(request(1, "watch", { watchId: "w", query: { tag: "venue" } }), frame.contentWindow);
    await waitFor(() => expect(answersIn(sent)).toHaveLength(1));
    const win = frame.contentWindow;
    unmount();
    expect(stopped).toBe(1);
    const asked = backend.asked.length;
    say(request(2, "theme"), win);
    await Promise.resolve();
    expect(backend.asked).toHaveLength(asked);
    expect(answersIn(sent)).toHaveLength(1);
  });

  it("is paused while the window is in the background or the frame is off screen, and wakes again", async () => {
    const pause = vi.spyOn(BridgeHost.prototype, "setPaused");
    await mount();
    expect(pause).toHaveBeenLastCalledWith(false);
    FakeObserver.show(false);
    expect(pause).toHaveBeenLastCalledWith(true);
    FakeObserver.show(true);
    expect(pause).toHaveBeenLastCalledWith(false);
    const state = vi.spyOn(document, "visibilityState", "get");
    state.mockReturnValue("hidden");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(pause).toHaveBeenLastCalledWith(true);
    state.mockReturnValue("visible");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(pause).toHaveBeenLastCalledWith(false);
  });

  it("tells the page when the app's theme changes", async () => {
    const { frame, sent } = await mount();
    fireEvent.load(frame);
    act(() => document.documentElement.setAttribute("data-theme", "dark"));
    return waitFor(() => expect(sent.at(-1)).toEqual({ event: "theme", theme: "dark" })).finally(() => document.documentElement.removeAttribute("data-theme"));
  });
});

describe("the errors chip", () => {
  const record = (message: string, line = 3) => ({ time: "2026-10-23T10:00:00Z", kind: "error" as const, message, source: "smart://x/app.js", line });

  it("is nothing while the page has no errors, and counts them when it has", async () => {
    const quiet = await mount();
    await Promise.resolve();
    expect(screen.queryByRole("button", { name: /error/ })).toBeNull();
    quiet.unmount();
    const backend = new FakeBackend();
    backend.log = { records: [record("boom"), record("bang", 9)] };
    await mount({}, backend);
    const chip = await screen.findByRole("button", { name: "2 errors" });
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    const list = screen.getByRole("region", { name: "Errors in this page" });
    expect(list.textContent).toContain("boom");
    expect(list.textContent).toContain("app.js, line 9");
    // Newest first.
    expect(list.querySelector("li")!.textContent).toContain("bang");
    fireEvent.keyDown(chip, { key: "Escape" });
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("shows what a page reports at once, as text and never as markup, and can be cleared", async () => {
    const { frame, backend } = await mount();
    say(request(1, "report", { kind: "error", message: "<img src=x onerror=alert(1)>", source: "app.js", line: 4 }), frame.contentWindow);
    const chip = await screen.findByRole("button", { name: "1 error" });
    fireEvent.click(chip);
    const list = screen.getByRole("region");
    expect(list.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(list.querySelector("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear errors" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /error/ })).toBeNull());
    expect(backend.log.records).toEqual([]);
  });

  it("can be left out", async () => {
    const backend = new FakeBackend();
    backend.log = { records: [record("boom")] };
    await mount({ showErrors: false }, backend);
    await Promise.resolve();
    expect(screen.queryByRole("button", { name: /error/ })).toBeNull();
  });
});
