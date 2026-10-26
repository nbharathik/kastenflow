// A bridge host joined to a fake frame and a fake app, with everything it does
// recorded, for the host's tests.

import { vi } from "vitest";

import type { BridgeAnswer, SmartTheme } from "../../../lib/vault/smart-types";
import { BridgeHost, type HostOptions } from "../bridge-host";
import { FakeBackend, fakeWindow } from "./fake-frame";

export const PAGE = "projects/trip/tracker.md";
/** The secret of the rig's frame. */
export const FRAME = "f".repeat(64);

export type Event = { event: string; [key: string]: unknown };

export interface Rig {
  host: BridgeHost;
  backend: FakeBackend;
  frame: ReturnType<typeof fakeWindow>;
  /** The frame says something (or another window does, when a source is given, even `undefined`). */
  say(data: unknown, ...source: [unknown?]): void;
  /** Everything the frame was sent. */
  sent(): unknown[];
  answers(): BridgeAnswer[];
  /** Every event the frame was sent, and those of a watch alone. */
  events(): Event[];
  watched(): Event[];
  /** The vault changes. */
  change(): void;
  stops: { count: number };
  subscribers: { count: number };
  theme: { value: SmartTheme };
  opened: string[];
  resized: number[];
  logged: unknown[][];
  reported: { count: number };
}

export function rig(extra: Partial<HostOptions> = {}): Rig {
  const backend = new FakeBackend();
  const frame = fakeWindow();
  const listeners = new Set<() => void>();
  const stops = { count: 0 };
  const subscribers = { count: 0 };
  const theme = { value: "light" as SmartTheme };
  const opened: string[] = [];
  const resized: number[] = [];
  const logged: unknown[][] = [];
  const reported = { count: 0 };
  const host = new BridgeHost({
    pagePath: PAGE,
    pageId: "01PAGE",
    frameToken: FRAME,
    backend,
    frame: () => frame,
    theme: () => theme.value,
    onVaultChange: (listener) => {
      listeners.add(listener);
      subscribers.count += 1;
      return () => {
        listeners.delete(listener);
        stops.count += 1;
      };
    },
    onOpen: (path) => opened.push(path),
    onResize: (px) => resized.push(px),
    onLog: (args) => logged.push(args),
    onReported: () => (reported.count += 1),
    ...extra,
  });
  const events = () => frame.sent.filter((m): m is Event => typeof m === "object" && m !== null && "event" in m);
  return {
    host,
    backend,
    frame,
    say: (data, ...source) => host.handle({ data, source: (source.length > 0 ? source[0] : frame) as MessageEventSource | null }),
    sent: () => frame.sent,
    answers: () => frame.sent.filter((m): m is BridgeAnswer => typeof m === "object" && m !== null && "ok" in m),
    events,
    watched: () => events().filter((e) => e.event === "watch"),
    change: () => listeners.forEach((l) => l()),
    stops,
    subscribers,
    theme,
    opened,
    resized,
    logged,
    reported,
  };
}

/** Lets the answers that are on their way arrive. */
export const settle = () => vi.advanceTimersByTimeAsync(0);
