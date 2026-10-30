import { describe, expect, it } from "vitest";

import { restore, savedOf } from "./saved-thread";
import { newThread, type Answer, type Message, type Thread } from "./thread";
import { forkAt, latestFirst, readForks, showVersion, versionsOf, viewingEarlier } from "./thread-versions";

const q = (id: string, text: string): Message => ({ id, role: "user", text, context: [] });
const a = (id: string, text: string): Answer => ({ id, role: "assistant", turn: id, provider: "p", model: "m", parts: [{ kind: "text", text }], status: "done", error: null, pinned: null });

const thread = (...messages: Message[]): Thread => ({ ...newThread({ id: "t" }), messages });
const ids = (t: Thread) => t.messages.map((m) => m.id).join(",");

describe("versions of a conversation", () => {
  it("keeps the old answer as a version when a question is asked again, and shows the new one", () => {
    const first = thread(q("q1", "One"), a("a1", "First"));
    const forked = forkAt(first, 0);
    expect(forked.messages).toEqual([]);
    const again: Thread = { ...forked, messages: [q("q2", "One"), a("a2", "Second")] };
    expect(versionsOf(again, "a2")).toEqual({ shown: 1, total: 2, at: 0 });
    // The first version is reachable, and the second is kept while it is away.
    const back = showVersion(again, 0, 0);
    expect(ids(back)).toBe("q1,a1");
    expect(versionsOf(back, "a1")).toEqual({ shown: 0, total: 2, at: 0 });
    expect(viewingEarlier(back)).toBe(true);
    expect(ids(showVersion(back, 0, 1))).toBe("q2,a2");
  });

  it("branches at any question and keeps what came before it", () => {
    const t = thread(q("q1", "One"), a("a1", "First"), q("q2", "Two"), a("a2", "Second"));
    const forked = forkAt(t, 0);
    const edited: Thread = { ...forked, messages: [q("q3", "One, edited"), a("a3", "Third")] };
    expect(ids(showVersion(edited, 0, 0))).toBe("q1,a1,q2,a2");
    // Asking only the second question again forks inside the branch.
    const inner = forkAt(showVersion(edited, 0, 0), 2);
    expect(ids(inner)).toBe("q1,a1");
    const regenerated: Thread = { ...inner, messages: [...inner.messages, q("q4", "Two"), a("a4", "Second, again")] };
    expect(versionsOf(regenerated, "a4")).toEqual({ shown: 1, total: 2, at: 2 });
    expect(versionsOf(regenerated, "a1")).toEqual({ shown: 0, total: 2, at: 0 });
    // Leaving the branch and coming back finds the inner fork as it was.
    const away = showVersion(regenerated, 0, 1);
    expect(ids(away)).toBe("q3,a3");
    expect(ids(showVersion(away, 0, 0))).toBe("q1,a1,q4,a4");
    expect(versionsOf(showVersion(away, 0, 0), "a4")).toEqual({ shown: 1, total: 2, at: 2 });
  });

  it("adds a version to an existing fork rather than making another", () => {
    let t = thread(q("q1", "One"), a("a1", "1"));
    t = forkAt(t, 0);
    t = { ...t, messages: [q("q2", "One"), a("a2", "2")] };
    t = forkAt(t, 0);
    t = { ...t, messages: [q("q3", "One"), a("a3", "3")] };
    expect(t.forks).toHaveLength(1);
    expect(versionsOf(t, "a3")).toEqual({ shown: 2, total: 3, at: 0 });
    expect(ids(showVersion(t, 0, 0))).toBe("q1,a1");
    expect(ids(showVersion(showVersion(t, 0, 0), 0, 1))).toBe("q2,a2");
  });

  it("goes back to the version the assistant remembers", () => {
    let t = thread(q("q1", "One"), a("a1", "1"), q("q2", "Two"), a("a2", "2"));
    t = forkAt(t, 2);
    t = { ...t, messages: [...t.messages, q("q3", "Two"), a("a3", "3")] };
    const old = showVersion(t, 2, 0);
    expect(viewingEarlier(old)).toBe(true);
    const latest = latestFirst(old);
    expect(ids(latest)).toBe("q1,a1,q3,a3");
    expect(viewingEarlier(latest)).toBe(false);
    expect(latestFirst(latest)).toBe(latest);
  });

  it("does nothing for a version or fork that is not there", () => {
    const t = forkAt(thread(q("q1", "One"), a("a1", "1")), 0);
    expect(showVersion(t, 0, 5)).toBe(t);
    expect(showVersion(t, 4, 0)).toBe(t);
    expect(versionsOf(thread(q("q1", "One"), a("a1", "1")), "a1")).toBeNull();
  });
});

describe("versions kept with the thread", () => {
  it("come back as saved, with the version on screen", () => {
    let t = thread(q("q1", "One"), a("a1", "First"));
    t = forkAt(t, 0);
    t = { ...t, messages: [q("q2", "One"), a("a2", "Second")] };
    t = showVersion(t, 0, 0);
    const back = restore("t", { ui: JSON.parse(JSON.stringify(savedOf(t))), status: "idle", provider: "p", model: "m", seq: 0, plan: [], queued: [] } as never);
    expect(ids(back)).toBe("q1,a1");
    expect(back.forks?.[0]).toMatchObject({ at: 0, shown: 0, live: 1 });
    expect(ids(showVersion(back, 0, 1))).toBe("q2,a2");
  });

  it("are absent from an old thread, which loads as it did", () => {
    const old = { v: 1, id: "t", created: 1, provider: null, model: null, context: [], messages: [q("q1", "One"), a("a1", "First")], session: null, changed: false, undone: false };
    const back = restore("t", { ui: old, status: "idle", provider: "p", model: "m", seq: 0, plan: [], queued: [] } as never);
    expect(back.forks).toBeUndefined();
    expect(ids(back)).toBe("q1,a1");
  });

  it("leave out a fork that does not hold together", () => {
    const read = (m: unknown) => (m && typeof m === "object" ? (m as Message) : null);
    const branch = { messages: [q("q1", "One")], forks: [] };
    expect(readForks([{ at: 0, shown: 0, live: 1, versions: [null, branch] }], read)).toHaveLength(1);
    expect(readForks([{ at: 0, shown: 3, live: 1, versions: [null, branch] }], read)).toEqual([]);
    expect(readForks([{ at: 0, shown: 0, live: 1, versions: [branch, branch] }], read)).toEqual([]);
    expect(readForks([{ at: "x" }, 4, null], read)).toEqual([]);
    expect(readForks("nope", read)).toEqual([]);
  });
});
