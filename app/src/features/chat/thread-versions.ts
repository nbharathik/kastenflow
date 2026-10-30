// Versions of a conversation from one question on. Asking again (Regenerate)
// or changing an earlier question does not throw the old reply away: from
// that question on, the thread keeps each way it went as a version, and the
// answer shows "‹ 2 / 3 ›" to move between them. A fork is the place where
// the thread branches (the index of the question); the version on screen is
// the thread's own messages, so the others are all that is stored.
//
// The assistant remembers only one version: the `live` one, the latest asked.
// An older one is for reading; the thread goes back to the live one before
// anything is asked (`latestFirst`).

import type { Message } from "./thread";

/** One way the conversation went from a fork on: its messages, and the forks inside them. */
export interface Branch {
  messages: Message[];
  forks: Fork[];
}

export interface Fork {
  /** The index of the question the thread branches at. */
  at: number;
  /** Every version; the one on screen is `null` (those messages are the thread's own). */
  versions: (Branch | null)[];
  /** The version on screen. */
  shown: number;
  /** The version the assistant remembers. */
  live: number;
}

/** The thread parts these functions read and write. */
interface Holder {
  messages: Message[];
  forks?: Fork[];
}

const byPlace = (a: Fork, b: Fork) => a.at - b.at;

/** Moves the messages from `at` on into a version of their own and leaves the thread at `at`, ready for the question that takes their place. */
export function forkAt<T extends Holder>(thread: T, at: number): T {
  const forks = thread.forks ?? [];
  const tail: Branch = { messages: thread.messages.slice(at), forks: forks.filter((f) => f.at > at) };
  const here = forks.find((f) => f.at === at);
  const outer = forks.filter((f) => f.at < at);
  let fork: Fork;
  if (here) {
    const versions = here.versions.slice();
    versions[here.shown] = tail;
    versions.push(null);
    fork = { at, versions, shown: versions.length - 1, live: versions.length - 1 };
  } else {
    fork = { at, versions: [tail, null], shown: 1, live: 1 };
  }
  return { ...thread, messages: thread.messages.slice(0, at), forks: [...outer, fork].sort(byPlace) };
}

/** The thread showing version `k` of the fork at `at`; the same thread when there is no such version. */
export function showVersion<T extends Holder>(thread: T, at: number, k: number): T {
  const forks = thread.forks ?? [];
  const fork = forks.find((f) => f.at === at);
  if (!fork || k === fork.shown) return thread;
  const target = fork.versions[k];
  if (!target) return thread;
  const versions = fork.versions.slice();
  versions[fork.shown] = { messages: thread.messages.slice(at), forks: forks.filter((f) => f.at > at) };
  versions[k] = null;
  const next: Fork = { ...fork, versions, shown: k };
  const outer = forks.filter((f) => f.at < at);
  return { ...thread, messages: [...thread.messages.slice(0, at), ...target.messages], forks: [...outer, next, ...target.forks].sort(byPlace) };
}

/** Whether the thread shows a version the assistant does not remember. */
export const viewingEarlier = (thread: Pick<Holder, "forks">): boolean => (thread.forks ?? []).some((f) => f.shown !== f.live);

/** The thread with every fork back on its live version. */
export function latestFirst<T extends Holder>(thread: T): T {
  let now = thread;
  // Going back at one fork shows the forks of its live version, which may need the same.
  for (let guard = 0; guard < 1000; guard++) {
    const off = (now.forks ?? []).find((f) => f.shown !== f.live);
    if (!off) return now;
    const next = showVersion(now, off.at, off.live);
    if (next === now) return now;
    now = next;
  }
  return now;
}

/** Where the answer with `id` stands among its versions: its place, how many there are, and the fork. None when it has no other version. */
export function versionsOf(thread: Holder, id: string): { shown: number; total: number; at: number } | null {
  const index = thread.messages.findIndex((m) => m.id === id);
  if (index < 1) return null;
  const fork = (thread.forks ?? []).find((f) => f.at === index - 1);
  return fork && fork.versions.length > 1 ? { shown: fork.shown, total: fork.versions.length, at: fork.at } : null;
}

// Reading a saved fork back: anything may be there.

const object = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

function readBranch(raw: unknown, read: (raw: unknown) => Message | null, depth: number): Branch | null {
  const branch = object(raw);
  if (!Array.isArray(branch["messages"])) return null;
  const messages = branch["messages"].flatMap((m) => read(m) ?? []);
  return messages.length ? { messages, forks: depth < 8 ? readForks(branch["forks"], read, depth + 1) : [] } : null;
}

/** The forks of a saved thread (or of a saved version): every field checked, and a fork that does not hold together left out. */
export function readForks(raw: unknown, read: (raw: unknown) => Message | null, depth = 0): Fork[] {
  if (!Array.isArray(raw)) return [];
  const out: Fork[] = [];
  for (const item of raw) {
    const { at, shown, live, versions } = object(item);
    if (typeof at !== "number" || !Number.isInteger(at) || at < 0 || typeof shown !== "number" || typeof live !== "number" || !Array.isArray(versions)) continue;
    const read1 = versions.map((v) => (v === null ? null : readBranch(v, read, depth)));
    const whole = versions.every((v, i) => (v === null ? i === shown : read1[i] !== null));
    if (!whole || shown < 0 || shown >= versions.length || live < 0 || live >= versions.length || read1.filter((v) => v === null).length !== 1) continue;
    out.push({ at, versions: read1, shown, live });
  }
  return out.sort(byPlace);
}
