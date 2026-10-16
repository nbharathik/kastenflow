// Watching a frame that shows a web page. The refusal of a page is seen on its frame as it happens (a policy violation report, a load,
// a timeout) and never asked of the network: a fetch cannot see a frame policy, and used to be the whole of how a dead page was told.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type FrameStatus, SLOW_SECONDS, frameProblem, isLocalAddress, watchFrame } from "./web-frame.ts";

const ADDRESS = "https://example.com/page";

let frame: HTMLIFrameElement;

beforeEach(() => {
  frame = document.createElement("iframe");
  document.body.append(frame);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  frame.remove();
});

/** What the browser sends when the policy of the page around a frame refuses an address. */
function refuse(address: string, directive = "frame-src"): void {
  const event = new Event("securitypolicyviolation", { bubbles: true });
  Object.assign(event, { effectiveDirective: directive, violatedDirective: directive, blockedURI: address });
  document.dispatchEvent(event);
}

function watch(address = ADDRESS, seconds?: number) {
  const seen: FrameStatus[] = [];
  const stop = watchFrame(frame, address, { ...(seconds === undefined ? {} : { seconds }), onChange: (status) => seen.push(status) });
  return { seen, stop };
}

describe("a frame that is watched", () => {
  it("is given its address once the listeners are on, so a refusal reported at that moment is not missed", () => {
    const seen: FrameStatus[] = [];
    // The browser reports a refusal a moment after the frame is told where to go; the worst case is that it reports it at once.
    Object.defineProperty(frame, "src", {
      configurable: true,
      set: () => refuse(ADDRESS),
      get: () => "",
    });
    watchFrame(frame, ADDRESS, { onChange: (status) => seen.push(status) });
    expect(seen).toEqual(["blocked"]);
  });

  it("is blocked when the policy refuses its address (the refusal arrives after the frame was inserted)", () => {
    const { seen } = watch();
    expect(frame.getAttribute("src")).toBe(ADDRESS);
    refuse(ADDRESS);
    expect(seen).toEqual(["blocked"]);
  });

  it("takes the address with its path, and an origin alone, as the same page", () => {
    const { seen } = watch();
    refuse("https://example.com");
    expect(seen).toEqual(["blocked"]);
  });

  it("is not blocked by the refusal of another page, or of something else about this one", () => {
    const { seen } = watch();
    refuse("https://other.example/page");
    refuse(ADDRESS, "script-src");
    refuse("inline", "frame-src");
    refuse("");
    expect(seen).toEqual([]);
  });

  it("is ready when it loads", () => {
    const { seen } = watch();
    frame.dispatchEvent(new Event("load"));
    expect(seen).toEqual(["ready"]);
  });

  it("stays blocked: the error page the browser loads in place of a refused page is not a page that is ready", () => {
    const { seen } = watch();
    refuse(ADDRESS);
    frame.dispatchEvent(new Event("load"));
    expect(seen).toEqual(["blocked"]);
  });

  it("is slow when it has not loaded in time, is kept, and is ready if it loads after all", () => {
    vi.useFakeTimers();
    const { seen } = watch(ADDRESS, 3);
    vi.advanceTimersByTime(2900);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(seen).toEqual(["slow"]);
    expect(frame.isConnected).toBe(true);
    frame.dispatchEvent(new Event("load"));
    expect(seen).toEqual(["slow", "ready"]);
  });

  it("is not slow if it loaded in time, and waits SLOW_SECONDS when no time is given", () => {
    vi.useFakeTimers();
    const first = watch(ADDRESS, 3);
    frame.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(60_000);
    expect(first.seen).toEqual(["ready"]);
    first.stop();
    const second = watch();
    vi.advanceTimersByTime(SLOW_SECONDS * 1000 - 100);
    expect(second.seen).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(second.seen).toEqual(["slow"]);
  });

  it("asks the network nothing", () => {
    vi.useFakeTimers();
    const fetched = vi.spyOn(globalThis, "fetch");
    const xhr = vi.spyOn(XMLHttpRequest.prototype, "open");
    const beacon = typeof navigator.sendBeacon === "function" ? vi.spyOn(navigator, "sendBeacon") : null;
    watch();
    refuse(ADDRESS);
    vi.advanceTimersByTime(60_000);
    expect(fetched).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
    if (beacon) expect(beacon).not.toHaveBeenCalled();
  });

  it("stops watching when told to: no report, no timer, and the listeners are gone", () => {
    vi.useFakeTimers();
    const { seen, stop } = watch(ADDRESS, 3);
    stop();
    refuse(ADDRESS);
    frame.dispatchEvent(new Event("load"));
    vi.advanceTimersByTime(60_000);
    expect(seen).toEqual([]);
  });

  it("does not load a page that is not on this machine while the device is offline, and loads it when the network is back", () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { seen } = watch();
    expect(seen).toEqual(["offline"]);
    expect(frame.getAttribute("src")).toBeNull();
    // The empty page a frame with no address loads is not the page.
    frame.dispatchEvent(new Event("load"));
    expect(seen).toEqual(["offline"]);
    online.mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    expect(seen).toEqual(["offline", "loading"]);
    expect(frame.getAttribute("src")).toBe(ADDRESS);
    frame.dispatchEvent(new Event("load"));
    expect(seen).toEqual(["offline", "loading", "ready"]);
  });

  it("loads a page on this machine whether or not the device is online", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { seen } = watch("http://localhost:3000/demo");
    expect(seen).toEqual([]);
    expect(frame.getAttribute("src")).toBe("http://localhost:3000/demo");
  });
});

describe("which addresses are on this machine", () => {
  it("are localhost, its subdomains, loopback addresses and ::1", () => {
    for (const local of ["http://localhost:3000", "http://app.localhost/", "http://127.0.0.1:9/x", "http://127.1.2.3/", "http://[::1]:8080/"]) expect(isLocalAddress(local), local).toBe(true);
    for (const far of ["https://example.com", "http://192.168.0.2/", "https://localhost.example.com/", "not an address"]) expect(isLocalAddress(far), far).toBe(false);
  });
});

describe("what the card says", () => {
  it("is a sentence for a page that is refused, slow or offline, and nothing while it loads or shows", () => {
    expect(frameProblem("blocked")).toMatch(/can't be shown inside a slide/);
    expect(frameProblem("slow")).toMatch(/long time to load/);
    expect(frameProblem("offline")).toMatch(/offline/);
    expect(frameProblem("loading")).toBeNull();
    expect(frameProblem("ready")).toBeNull();
  });
});
