// The rehearsals of a deck, listed: when, how long, outdated or not, and how each slide went beside the run before.

import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type RehearsalRecord, recordOf } from "../../present/rehearsal.ts";
import { localRehearsals } from "../../present/rehearsal-store.ts";
import { durationText } from "../../present/rehearsal-text.ts";
import { COMMANDS } from "../commands/index.ts";
import { mountDialogs } from "./test-kit.tsx";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const slides = (ids: string[]) => ids.map((id) => ({ id, layout: "blank", elements: [] }));
const run = (id: string, slideIds: string[], times: number[], at: number): RehearsalRecord =>
  recordOf(
    { id, slides: slides(slideIds) },
    { totalMs: times.reduce((a, b) => a + b, 0), slides: slideIds.map((slide, i) => ({ id: slide, ms: times[i] ?? 0, visits: 1, steps: [{ step: 0, ms: times[i] ?? 0 }] })) },
    at,
  );

describe("the command", () => {
  it("is Past rehearsals…, which opens the dialog", async () => {
    const kit = await mountDialogs();
    expect(COMMANDS.get("view.rehearsals")?.label).toBe("Past rehearsals…");
    await act(async () => void COMMANDS.get("view.rehearsals")?.run({ session: kit.session, ui: kit.ui }));
    expect(kit.ui.state.dialog).toBe("rehearsals");
  });
});

describe("the dialog", () => {
  it("says when the deck has not been rehearsed", async () => {
    await mountDialogs({ dialog: "rehearsals" });
    expect(await screen.findByText(/has not been rehearsed/)).toBeTruthy();
  });

  it("lists the runs of this deck, newest first, with their length, and marks one of an earlier version of the deck", async () => {
    const kit = await mountDialogs({ dialog: "rehearsals" });
    const ids = kit.session.deck.slides.map((s) => s.id);
    const store = localRehearsals();
    kit.host.rehearsals = store;
    await store.save(run(kit.session.deck.id, ["gone-1", "gone-2"], [60_000, 30_000], Date.UTC(2026, 0, 5, 9, 30)));
    await store.save(run(kit.session.deck.id, ids, ids.map(() => 20_000), Date.UTC(2026, 0, 6, 9, 30)));
    // The dialog reads when it opens: open it again.
    act(() => kit.ui.openDialog(null));
    act(() => kit.ui.openDialog("rehearsals"));
    const list = await screen.findByRole("list", { name: "Rehearsals, newest first" });
    const rows = within(list).getAllByRole("button");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain(durationText(ids.length * 20_000));
    expect(rows[0]?.textContent).not.toContain("Outdated");
    expect(rows[1]?.textContent).toContain("Outdated");
    expect(rows[1]?.textContent).toContain("1:30");
  });

  it("shows how each slide went beside the run before, when a run is chosen", async () => {
    const kit = await mountDialogs({ dialog: null });
    const deck = kit.session.deck;
    const ids = deck.slides.map((s) => s.id);
    const store = localRehearsals();
    kit.host.rehearsals = store;
    await store.save(run(deck.id, ids, ids.map(() => 30_000), 1_000));
    await store.save(run(deck.id, ids, ids.map(() => 45_000), 2_000));
    // The deck's revision is the one the runs were made with only if the slides are the same.
    const revision = (await store.list(deck.id))[0]?.revision;
    expect(revision).toBeDefined();
    act(() => kit.ui.openDialog("rehearsals"));
    const list = await screen.findByRole("list", { name: "Rehearsals, newest first" });
    const newest = within(list).getAllByRole("button")[0]!;
    fireEvent.click(newest);
    const summary = await screen.findByRole("region", { name: "Rehearsal summary" });
    await waitFor(() => expect(within(summary).getAllByRole("row").length).toBeGreaterThan(1));
    const cells = within(summary).getAllByRole("row")[1]?.querySelectorAll("td");
    expect([...(cells ?? [])].map((cell) => cell.textContent)).toEqual(["0:45", "0:30", "+0:15"]);
    fireEvent.click(newest);
    expect(screen.queryByRole("region", { name: "Rehearsal summary" })).toBeNull();
  });

  it("starts a rehearsal from Rehearse now, and closes", async () => {
    const kit = await mountDialogs({ dialog: "rehearsals" });
    const present = vi.fn();
    act(() => void (kit.ui.actions = { present }));
    await screen.findByText(/has not been rehearsed/);
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Rehearse now" })));
    expect(present).toHaveBeenCalledWith("start", { presenter: true, rehearse: true });
    expect(kit.ui.state.dialog).toBeNull();
  });
});
