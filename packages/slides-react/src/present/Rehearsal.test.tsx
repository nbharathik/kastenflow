// The rehearsal in the presenter's view: Rehearse, Pause and Resume, Restart and Finish are named buttons; a run is timed slide by slide as
// the talk moves (and only as the presenter moves it); the summary sets it beside the last run and keeps it or lets it go.

import type { Deck, Slide } from "@kasten-slides/wasm";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { plainDeck } from "../render/testing/decks.ts";
import type { RehearsalRecord } from "./rehearsal.ts";
import { recordOf, revisionOf } from "./rehearsal.ts";
import { type RehearsalStore } from "./rehearsal-store.ts";
import { Presenter } from "./Presenter.tsx";
import { PresenterWindow } from "./PresenterWindow.tsx";
import type { Position } from "./plan.ts";
import { memorySyncPair, readMessage } from "./sync.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const slide = (id: string, extra: Partial<Slide> = {}): Slide => ({ id, layout: "blank", elements: [], ...extra });
const deck: Deck = { ...plainDeck([]).deck, title: "The talk", slides: [slide("a"), slide("b", { steps: 2 }), slide("c")] };

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-11T10:00:00Z"));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  localStorage.clear();
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  host.remove();
});

/** A store that keeps runs in a list and says what it was asked. */
function memoryStore(initial: RehearsalRecord[] = []): RehearsalStore & { saved: RehearsalRecord[]; reads: string[]; fail: boolean } {
  const runs = [...initial];
  const store = {
    saved: [] as RehearsalRecord[],
    reads: [] as string[],
    fail: false,
    async list(deckId: string) {
      store.reads.push(deckId);
      return runs.filter((run) => run.deckId === deckId);
    },
    async save(record: RehearsalRecord) {
      if (store.fail) throw new Error("The rehearsals could not be kept");
      runs.push(record);
      store.saved.push(record);
      return runs.filter((run) => run.deckId === record.deckId);
    },
  };
  return store;
}

const flush = () => act(async () => void (await Promise.resolve()));
const later = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));
const render = (ui: React.ReactElement) => act(async () => root.render(ui));
const button = (name: string | RegExp) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => (typeof name === "string" ? b.textContent?.trim() === name : name.test(b.textContent ?? "")));
const click = (name: string | RegExp) => {
  const found = button(name);
  if (!found) throw new Error(`No button ${String(name)}`);
  return act(async () => void found.click());
};
const text = (selector: string) => host.querySelector(selector)?.textContent?.replaceAll(/\s+/g, " ").trim();

const view = (position: Position, extra: Partial<Parameters<typeof Presenter>[0]> = {}) => (
  <Presenter deck={deck} imageUrl={() => undefined} position={position} paused={false} since={Date.now()} onGo={() => {}} {...extra} />
);
const at = (h: number, f = -1): Position => ({ h, v: 0, f });

describe("the controls", () => {
  it("are absent without a place to keep rehearsals", async () => {
    await render(view(at(0)));
    expect(button("Rehearse")).toBeUndefined();
    expect(host.querySelector(".ks-pv-rehearsal")).toBeNull();
  });

  it("are Rehearse first, then Pause, Restart and Finish, each a named button; Pause becomes Resume", async () => {
    await render(view(at(0), { rehearsal: { store: memoryStore() } }));
    expect(button("Pause")).toBeUndefined();
    await click("Rehearse");
    expect(button("Rehearse")).toBeUndefined();
    expect(button("Pause")).toBeDefined();
    expect(button("Restart")).toBeDefined();
    expect(button("Finish")).toBeDefined();
    await click("Pause");
    expect(button("Resume")).toBeDefined();
    expect(button("Pause")).toBeUndefined();
    expect(text("[role=status].ks-pv-rehearsal-state")).toBe("Rehearsal paused");
    await click("Resume");
    expect(text("[role=status].ks-pv-rehearsal-state")).toBe("Rehearsing");
  });

  it("show the time of the run as it goes, and not the time paused", async () => {
    await render(view(at(0), { rehearsal: { store: memoryStore() } }));
    await click("Rehearse");
    await later(5_000);
    expect(text("[role=timer][aria-label='Rehearsal time']")).toBe("0:05");
    await click("Pause");
    await later(60_000);
    expect(text("[role=timer][aria-label='Rehearsal time']")).toBe("0:05");
    await click("Resume");
    await later(2_000);
    expect(text("[role=timer][aria-label='Rehearsal time']")).toBe("0:07");
  });

  it("restart begins again from nothing", async () => {
    await render(view(at(0), { rehearsal: { store: memoryStore() } }));
    await click("Rehearse");
    await later(9_000);
    await click("Restart");
    expect(text("[role=timer][aria-label='Rehearsal time']")).toBe("0:00");
    await later(3_000);
    expect(text("[role=timer][aria-label='Rehearsal time']")).toBe("0:03");
  });

  it("start by themselves only when the editor asked for a rehearsal, and only once", async () => {
    const store = memoryStore();
    await render(view(at(0), { rehearsal: { store, autoStart: true } }));
    expect(button("Rehearse")).toBeUndefined();
    expect(button("Finish")).toBeDefined();
    await click("Finish");
    await click("Discard");
    // Back to idle: asking again (the deck message is repeated) does not start another.
    await render(view(at(0), { rehearsal: { store, autoStart: true } }));
    expect(button("Rehearse")).toBeDefined();
  });
});

describe("timing the talk", () => {
  it("counts the time on each slide as the presenter moves, and never moves the talk itself", async () => {
    const onGo = vi.fn();
    const store = memoryStore();
    await render(view(at(0), { onGo, rehearsal: { store } }));
    await click("Rehearse");
    await later(4_000);
    await render(view(at(1), { onGo, rehearsal: { store } }));
    await later(10_000);
    await render(view(at(1, 0), { onGo, rehearsal: { store } }));
    await later(6_000);
    await render(view(at(2), { onGo, rehearsal: { store } }));
    await later(1_000);
    await click("Finish");
    await flush();
    const rows = [...host.querySelectorAll(".ks-pv-table tbody tr")].map((row) => [...row.querySelectorAll("th, td")].map((cell) => cell.textContent?.replaceAll(/\s+/g, " ").trim()));
    expect(rows.map((row) => [row[0]?.replace(/Steps:.*/, "").trim(), row[1]])).toEqual([
      ["1. Untitled slide", "0:04"],
      ["2. Untitled slide", "0:16"],
      ["3. Untitled slide", "0:01"],
    ]);
    expect(rows[1]?.[0]).toContain("Steps: 0 0:10 · 1 0:06");
    expect(text(".ks-pv-summary-total")).toBe("Total 0:21");
    // The only moves are the ones the test made: a clock that runs never advances a slide.
    expect(onGo).not.toHaveBeenCalled();
  });

  it("counts a pause as no time, also when the talk moves while it is paused", async () => {
    const store = memoryStore();
    await render(view(at(0), { rehearsal: { store } }));
    await click("Rehearse");
    await later(3_000);
    await click("Pause");
    await later(30_000);
    await render(view(at(1), { rehearsal: { store } }));
    await later(30_000);
    await click("Resume");
    await later(2_000);
    await click("Finish");
    const times = [...host.querySelectorAll(".ks-pv-table tbody tr")].map((row) => row.querySelector("td")?.textContent);
    expect(times).toEqual(["0:03", "0:02"]);
  });
});

describe("the summary", () => {
  const run = async (store: RehearsalStore) => {
    await render(view(at(0), { rehearsal: { store } }));
    await click("Rehearse");
    await later(10_000);
    await render(view(at(1), { rehearsal: { store } }));
    await later(20_000);
    await click("Finish");
    await flush();
  };

  it("sets each slide beside the last run of the deck as it is, and the difference", async () => {
    const before = (() => {
      const record = recordOf(deck, { totalMs: 40_000, slides: [{ id: "a", ms: 15_000, visits: 1, steps: [{ step: 0, ms: 15_000 }] }, { id: "b", ms: 25_000, visits: 1, steps: [{ step: 0, ms: 25_000 }] }] }, 1);
      return record;
    })();
    expect(before.revision).toBe(revisionOf(deck));
    const store = memoryStore([before]);
    await run(store);
    const rows = [...host.querySelectorAll(".ks-pv-table tbody tr")].map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent));
    expect(rows).toEqual([
      ["0:10", "0:15", "−0:05"],
      ["0:20", "0:25", "−0:05"],
    ]);
    expect(store.reads).toEqual(["d-1"]);
    expect(host.querySelector(".ks-pv-warning")).toBeNull();
  });

  it("says when the last run is of an earlier version of the deck", async () => {
    const other = recordOf({ id: "d-1", slides: [slide("a"), slide("z")] }, { totalMs: 5_000, slides: [{ id: "a", ms: 5_000, visits: 1, steps: [{ step: 0, ms: 5_000 }] }] }, 1);
    await run(memoryStore([other]));
    expect(text(".ks-pv-warning")).toContain("earlier version");
    expect([...host.querySelectorAll(".ks-pv-table tbody tr")].map((row) => row.querySelectorAll("td")[1]?.textContent)).toEqual(["0:05", "–"]);
  });

  it("keeps the run with Save, as a record of this deck and its revision, and says it is saved", async () => {
    const store = memoryStore();
    await run(store);
    await click("Save");
    await flush();
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0]).toMatchObject({ deckId: "d-1", revision: revisionOf(deck), totalMs: 30_000 });
    expect(store.saved[0]?.slides.map((s) => [s.id, s.ms])).toEqual([["a", 10_000], ["b", 20_000]]);
    expect(text("[role=status].ks-pv-saved")).toBe("Saved");
    await click("Close");
    expect(host.querySelector(".ks-pv-summary")).toBeNull();
    expect(button("Rehearse")).toBeDefined();
  });

  it("keeps nothing with Discard", async () => {
    const store = memoryStore();
    await run(store);
    await click("Discard");
    await flush();
    expect(store.saved).toEqual([]);
    expect(host.querySelector(".ks-pv-summary")).toBeNull();
    expect(button("Rehearse")).toBeDefined();
  });

  it("says why a run could not be kept, and offers Save again", async () => {
    const store = memoryStore();
    store.fail = true;
    await run(store);
    await click("Save");
    await flush();
    expect(host.querySelector("[role=alert]")?.textContent).toBe("The rehearsals could not be kept");
    expect(button("Save")).toBeDefined();
  });
});

describe("the presenter's window", () => {
  it("starts timing when the talk says it is a rehearsal, with the deck, and keeps the run where it is told", async () => {
    const [audience, presenter] = memorySyncPair();
    audience.subscribe((message) => {
      if (message.type === "hello") {
        audience.post({ type: "deck", deck, images: {}, state: { indexh: 0, indexv: 0 }, since: Date.now() });
        audience.post({ type: "rehearse" });
      }
    });
    await act(async () => root.render(<PresenterWindow sync={presenter} rehearsals={memoryStore()} />));
    await flush();
    await flush();
    await flush();
    expect(button("Finish")).toBeDefined();
    expect(button("Rehearse")).toBeUndefined();
  });

  it("does not time anything when the talk is not a rehearsal", async () => {
    const [audience, presenter] = memorySyncPair();
    audience.subscribe((message) => {
      if (message.type === "hello") audience.post({ type: "deck", deck, images: {}, state: { indexh: 0, indexv: 0 }, since: Date.now() });
    });
    await act(async () => root.render(<PresenterWindow sync={presenter} rehearsals={memoryStore()} />));
    await flush();
    await flush();
    expect(button("Rehearse")).toBeDefined();
    expect(button("Finish")).toBeUndefined();
  });

  it("reads the rehearse message, and nothing else is one", () => {
    expect(readMessage({ type: "rehearse" })).toEqual({ type: "rehearse" });
    expect(readMessage({ type: "rehearse", extra: 1 })).toEqual({ type: "rehearse" });
  });
});
