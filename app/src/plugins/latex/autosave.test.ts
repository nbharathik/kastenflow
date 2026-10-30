import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Autosaver, type AutosaveEvents } from "./autosave";
import type { SourceFile, SourceSaved } from "./types";

const file = (text: string, hash: string): SourceFile => ({ path: "p/a/main.tex", text, hash });

function setup(answer: (base: string, text: string) => SourceSaved | Promise<SourceSaved>) {
  const save = vi.fn((_path: string, base: string, text: string) => Promise.resolve(answer(base, text)));
  const events: AutosaveEvents = { saved: vi.fn(), merged: vi.fn(), conflict: vi.fn(), failed: vi.fn() };
  const saver = new Autosaver({ file: file("one\n", "h0"), save, delayMs: 500, events });
  return { save, events, saver };
}

const written = (text: string, hash: string): SourceSaved => ({ status: "written", file: file(text, hash) });

describe("autosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("saves 500 ms after the last key, once, with the base hash", async () => {
    const { save, saver, events } = setup((_b, t) => written(t, "h1"));
    saver.edit("one\ntwo\n");
    await vi.advanceTimersByTimeAsync(499);
    saver.edit("one\ntwo\nthree\n");
    await vi.advanceTimersByTimeAsync(499);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("p/a/main.tex", "h0", "one\ntwo\nthree\n");
    expect(events.saved).toHaveBeenCalledTimes(1);
    expect(saver.dirty).toBe(false);
    // The next save is written against the new hash.
    saver.edit("x\n");
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenLastCalledWith("p/a/main.tex", "h1", "x\n");
  });

  it("does not save text that is already saved", async () => {
    const { save, saver } = setup((_b, t) => written(t, "h1"));
    saver.edit("one\nx\n");
    saver.edit("one\n");
    await vi.advanceTimersByTimeAsync(600);
    expect(save).not.toHaveBeenCalled();
    expect(saver.dirty).toBe(false);
  });

  it("flush saves at once and waits for it", async () => {
    const { save, saver } = setup((_b, t) => written(t, "h1"));
    saver.edit("two\n");
    expect(saver.dirty).toBe(true);
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(saver.dirty).toBe(false);
  });

  it("one save at a time: typing during a save is saved after it", async () => {
    let release: (() => void) | undefined;
    const { save, saver } = setup((base, t) =>
      base === "h0"
        ? new Promise<SourceSaved>((resolve) => {
            release = () => resolve(written(t, "h1"));
          })
        : written(t, "h2"),
    );
    saver.edit("a\n");
    await vi.advanceTimersByTimeAsync(500);
    saver.edit("a\nb\n");
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);
    release?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("p/a/main.tex", "h1", "a\nb\n");
  });

  it("a merge hands the merged text to the editor when nothing was typed since", async () => {
    const { saver, events } = setup((_b, t) => ({ status: "merged", file: file(`${t}remote\n`, "h9") }));
    saver.edit("mine\n");
    await saver.flush();
    expect(events.merged).toHaveBeenCalledWith("mine\nremote\n");
    expect(saver.dirty).toBe(false);
  });

  it("a merge does not overwrite what was typed while saving: it is saved again against the old base", async () => {
    let first = true;
    const { save, saver, events } = setup((_b, t) => {
      if (first) {
        first = false;
        return { status: "merged", file: file("mine\nremote\n", "h9") };
      }
      return written(t, "h10");
    });
    saver.edit("mine\n");
    const flushing = saver.flush();
    saver.edit("mine\nmore\n");
    await flushing;
    await vi.advanceTimersByTimeAsync(0);
    expect(events.merged).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(2);
    // Still the old base, so the disk's extra line is merged in, not written over.
    expect(save).toHaveBeenLastCalledWith("p/a/main.tex", "h0", "mine\nmore\n");
  });

  it("a conflict pauses saving and offers both ways out", async () => {
    const { save, saver, events } = setup(() => ({ status: "conflict", copy: "p/a/main (conflict 1).tex", file: file("theirs\n", "hD") }));
    saver.edit("mine\n");
    await saver.flush();
    expect(events.conflict).toHaveBeenCalledWith({ copy: "p/a/main (conflict 1).tex", text: "theirs\n" });
    expect(saver.conflicted).toBe(true);
    saver.edit("mine\nmore\n");
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
    // Use the file on disk.
    expect(saver.useDisk()).toBe("theirs\n");
    expect(saver.conflicted).toBe(false);
    expect(saver.dirty).toBe(false);
  });

  it("keeping my version after a conflict saves it over the disk's file", async () => {
    let n = 0;
    const { save, saver } = setup((_b, t) => (n++ === 0 ? { status: "conflict", copy: "c.tex", file: file("theirs\n", "hD") } : written(t, "h2")));
    saver.edit("mine\n");
    await saver.flush();
    await saver.keepMine();
    expect(save).toHaveBeenLastCalledWith("p/a/main.tex", "hD", "mine\n");
    expect(saver.conflicted).toBe(false);
    expect(saver.dirty).toBe(false);
  });

  it("a failed save says why, stays dirty, and tries again on the next edit", async () => {
    let fail = true;
    const { save, saver, events } = setup((_b, t) => {
      if (fail) throw new Error("The disk is full");
      return written(t, "h1");
    });
    saver.edit("two\n");
    await saver.flush();
    expect(events.failed).toHaveBeenCalledWith("The disk is full");
    expect(saver.dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
    fail = false;
    saver.edit("two\nthree\n");
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(2);
    expect(saver.dirty).toBe(false);
  });

  it("dispose cancels a waiting save", async () => {
    const { save, saver } = setup((_b, t) => written(t, "h1"));
    saver.edit("two\n");
    saver.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
  });
});
