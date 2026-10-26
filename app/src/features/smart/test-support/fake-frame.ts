// A stand-in for a smart page's frame and for the app behind the host, for the
// tests: the frame is a window that records what it is sent; the backend
// answers from a function the test gives it and records what it was asked.

import type { ErrorLog, ErrorReport } from "../../../lib/vault/smart-types";
import type { CommitInfo } from "../../../lib/vault/types";
import type { PageInfo, Restored, SmartBackend, Trust } from "../backend";
import type { VaultCall } from "../schema";

/** A window that only records what is posted to it. */
export function fakeWindow(): Window & { sent: unknown[] } {
  const sent: unknown[] = [];
  return { sent, postMessage: (message: unknown) => void sent.push(message) } as unknown as Window & { sent: unknown[] };
}

export interface Asked {
  page: string;
  call: VaultCall;
}

export class FakeBackend implements SmartBackend {
  asked: Asked[] = [];
  /** The frame secret each call (and each report) came with, in order. */
  askedBy: string[] = [];
  reports: { page: string; report: ErrorReport }[] = [];
  log: ErrorLog = { records: [] };
  /** Frames made and not yet closed, then every frame ever made, in order. */
  live = new Set<string>();
  made: string[] = [];
  closed: string[] = [];
  /** When set, making a frame fails. */
  failOpen = false;
  /** What the app answers a call with; throw to make it fail. */
  answer: (call: VaultCall) => unknown | Promise<unknown> = () => ({ ok: true });

  async openFrame(): Promise<string> {
    if (this.failOpen) throw new Error("no random numbers");
    // Like the app's: 64 hex digits, a different one each time.
    const frame = (this.made.length + 1).toString(16).padStart(64, "a");
    this.made.push(frame);
    this.live.add(frame);
    return frame;
  }
  async closeFrame(frame: string): Promise<void> {
    this.live.delete(frame);
    this.closed.push(frame);
  }
  async call(page: string, call: VaultCall, frame: string): Promise<unknown> {
    this.asked.push({ page, call });
    this.askedBy.push(frame);
    return this.answer(call);
  }
  async report(page: string, report: ErrorReport, frame: string): Promise<ErrorLog> {
    this.askedBy.push(frame);
    this.reports.push({ page, report });
    this.log = { records: [...this.log.records, { ...report, time: "2026-10-23T10:00:00Z" }] };
    return this.log;
  }
  async errors(): Promise<ErrorLog> {
    return this.log;
  }
  async clearErrors(): Promise<void> {
    this.log = { records: [] };
  }
  /** What the app says about the page; a test changes it. */
  pageInfo: Partial<PageInfo> = {};
  async info(path: string): Promise<PageInfo> {
    return { id: "01PAGE", path, title: "Tracker", ready: true, height: 300, maxHeight: 500, problems: [], webImages: false, views: [], ...this.pageInfo };
  }
  webImagesSet: boolean[] = [];
  async setWebImages(_page: string, allow: boolean): Promise<void> {
    this.webImagesSet.push(allow);
  }
  /** Who made the page; a test changes it. */
  trustOf: Trust = { madeBy: null, needsAllow: false, allowed: false };
  allowed: string[] = [];
  async trust(): Promise<Trust> {
    return this.trustOf;
  }
  async allowRun(page: string): Promise<void> {
    this.allowed.push(page);
    this.trustOf = { ...this.trustOf, needsAllow: false, allowed: true };
  }
  running = true;
  async runEnabled(): Promise<boolean> {
    return this.running;
  }
  async setRunEnabled(on: boolean): Promise<void> {
    this.running = on;
  }
  /** The versions of the page's code, newest first. */
  versions: CommitInfo[] = [];
  /** How many versions the window asked for last. */
  askedFor: number | null = null;
  async history(_page?: string, limit?: number): Promise<CommitInfo[]> {
    this.askedFor = limit ?? null;
    return limit === undefined ? this.versions : this.versions.slice(0, limit);
  }
  restored: string[] = [];
  /** When set, putting a version back fails with this sentence. */
  restoreFails: string | null = null;
  async restoreVersion(_page: string, rev: string): Promise<Restored> {
    if (this.restoreFails) throw new Error(this.restoreFails);
    this.restored.push(rev);
    return { written: ["x.smart/index.html"], trashed: [], commit: "c-restore" };
  }
}

/** The arguments of a call (a call with none has an empty object). */
export const argsOf = <T = Record<string, unknown>>(call: VaultCall): T => ((call as { args?: T }).args ?? {}) as T;

/** A request as the kit sends it. */
export const request = (id: number, kind: string, args?: unknown) => (args === undefined ? { id, kind } : { id, kind, args });
