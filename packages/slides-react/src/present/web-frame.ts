// Watching a frame that shows a web page. A page cannot be asked whether it will show in a frame: a fetch cannot see a frame
// policy, a connection that was refused looks like any other answer, and a frame that was blocked still "loads" its error page. So
// the frame is watched while it works, and the three things that can be known are reported:
//
// - blocked: the security policy of the page around the frame refused the address (a `securitypolicyviolation` event for `frame-src`
//   whose address is the frame's). The listener is on before the frame is told where to go and stays for the frame's life, so the
//   report that comes a moment after the request is never missed.
// - ready: the frame loaded.
// - slow: it has not loaded in time. The frame is kept; if it loads later, it is ready.
// - offline: the device has no network and the address is not on this machine; the frame waits for the network.
//
// What cannot be known (a site that sends `X-Frame-Options` or `frame-ancestors`, a host that is down) shows as a loaded frame with
// the browser's own error page in it: the person can always open the address outside (the callers offer that button).

export type FrameStatus = "loading" | "ready" | "blocked" | "slow" | "offline";

/** How long a page has to load before it counts as slow, in seconds. */
export const SLOW_SECONDS = 8;

export interface FrameWatchOptions {
  /** Seconds a page has to load; `SLOW_SECONDS` when left out. */
  seconds?: number;
  /** Called with each new status (not the first, which is `loading`). */
  onChange(status: FrameStatus): void;
}

const originOf = (address: string): string | null => {
  try {
    return new URL(address).origin;
  } catch {
    return null;
  }
};

/** Whether an address is on this machine, where being offline does not matter. */
export function isLocalAddress(address: string): boolean {
  try {
    const { hostname } = new URL(address);
    return hostname === "localhost" || hostname === "[::1]" || hostname === "::1" || hostname.endsWith(".localhost") || /^127\./.test(hostname);
  } catch {
    return false;
  }
}

/** Whether a policy violation is the refusal of this frame's address. */
function refusesFrame(event: Event, origin: string): boolean {
  const report = event as Partial<SecurityPolicyViolationEvent>;
  const directive = report.effectiveDirective ?? report.violatedDirective ?? "";
  if (directive !== "frame-src" && !/^(frame-src|child-src)\b/.test(report.violatedDirective ?? "")) return false;
  return originOf(report.blockedURI ?? "") === origin;
}

/**
 * Starts the frame on `address` and reports how it goes. Call it with a frame that has no address yet: the listeners are put on first,
 * and then the address is given. Returns how to stop watching (the frame is left as it is).
 */
export function watchFrame(frame: HTMLIFrameElement, address: string, { seconds = SLOW_SECONDS, onChange }: FrameWatchOptions): () => void {
  let status: FrameStatus = "loading";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  // A frame with no address of its own "loads" its empty page when it is inserted (some browsers report that a moment later): that is not the page.
  let started = false;
  const origin = originOf(address);
  const report = (next: FrameStatus): void => {
    if (stopped || next === status) return;
    // A refusal stays: the error page the browser then loads is not a page that is ready.
    if (status === "blocked") return;
    status = next;
    onChange(next);
  };

  const onViolation = (event: Event): void => {
    if (origin !== null && refusesFrame(event, origin)) report("blocked");
  };
  const onLoad = (): void => {
    if (started) report("ready");
  };
  // The refusal is reported on the document that has the policy, and bubbles there from wherever it was raised.
  const doc = frame.ownerDocument;
  doc.addEventListener("securitypolicyviolation", onViolation, true);
  frame.addEventListener("load", onLoad);

  const start = (): void => {
    if (stopped) return;
    if (frame.getAttribute("src") !== address) frame.src = address;
    started = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (status === "loading") report("slow");
    }, seconds * 1000);
  };

  const view = doc.defaultView;
  const waiting = typeof navigator === "object" && navigator.onLine === false && !isLocalAddress(address);
  const onOnline = (): void => {
    view?.removeEventListener("online", onOnline);
    if (stopped) return;
    status = "loading";
    onChange("loading");
    start();
  };
  if (waiting) {
    status = "offline";
    onChange("offline");
    view?.addEventListener("online", onOnline);
  } else {
    start();
  }

  return () => {
    stopped = true;
    clearTimeout(timer);
    doc.removeEventListener("securitypolicyviolation", onViolation, true);
    frame.removeEventListener("load", onLoad);
    view?.removeEventListener("online", onOnline);
  };
}

/** What the card over a page that is not showing says, by why. `null` for a page that is loading or ready. */
export function frameProblem(status: FrameStatus): string | null {
  switch (status) {
    case "blocked":
      return "This page can't be shown inside a slide here: the app's security rules do not let it load in a frame.";
    case "slow":
      return "This page is taking a long time to load. It may be down, or it may refuse to be shown inside a slide.";
    case "offline":
      return "You are offline, so this page can't load. It will load when the network is back.";
    default:
      return null;
  }
}
