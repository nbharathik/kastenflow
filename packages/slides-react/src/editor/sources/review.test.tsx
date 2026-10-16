// Slides made from a page by a storyboard, after the page changes: the untouched ones are updated, the ones the person changed are kept or
// replaced as they choose, the ones whose page is gone are only listed; all of it one step of undo.

import { draftStoryboard } from "@kasten-slides/wasm";
import type { Element } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { updateFromPages } from "../../pages/insert.ts";
import { type FakePages, withPages } from "../../pages/fake-pages.ts";
import { type Kit, mountDialogs } from "../dialogs/test-kit.tsx";
import { applyReview, reviewSources } from "./review.ts";

const PAGE = "## Plan\n\nBook early. Then pack.\n\n- flights\n- guesthouse\n\n## Budget\n\n- bed: 40\n";
const CHANGED = "## Plan\n\nBook late. Then pack.\n\n- flights\n- guesthouse\n- insurance\n\n## Budget\n\n- bed: 40\n";
const PATH = "library/plan.md";

let kit: Kit | null = null;
let pages: FakePages;
afterEach(() => {
  cleanup();
  void kit?.session.dispose();
  kit = null;
});

/** A deck with the two sections of the page as slides, and a host that holds the page. */
async function made(): Promise<{ kit: Kit; slides: string[] }> {
  kit = await mountDialogs({ blank: false });
  pages = withPages(kit.host, [{ path: PATH, title: "Plan", markdown: PAGE }]);
  const entries = draftStoryboard({ page: PATH, title: "Plan", markdown: PAGE });
  const out = kit.session.core.apply("add_storyboard_slides", { entries });
  return { kit, slides: out.output.slides };
}

const bodyOf = (k: Kit, slide: string): Element => k.session.deck.slides.find((s) => s.id === slide)!.elements.find((e) => e.source != null)!;
const wordsOf = (k: Kit, slide: string): string => {
  const body = bodyOf(k, slide);
  return body.type === "text" ? body.text.paragraphs.map((p) => p.runs.map((r) => r.t).join("")).join("\n") : "";
};

describe("looking at the slides made from pages", () => {
  it("lists nothing while every page says what its slide was made from", async () => {
    const { kit: here } = await made();
    expect(await reviewSources(here.session)).toEqual([]);
  });

  it("offers an update for a slide that is as it was made when its page changed, and only for that one", async () => {
    const { kit: here, slides } = await made();
    pages.edit(PATH, CHANGED);
    const rows = await reviewSources(here.session);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slide: slides[0], state: "update", section: "Plan", unsure: false, number: 2 });
    expect(rows[0]?.markdown.startsWith("## Plan")).toBe(true);
  });

  it("does not take a slide that was only moved or renamed for one that was changed", async () => {
    const { kit: here, slides } = await made();
    const body = bodyOf(here, slides[0]!);
    here.session.core.apply("transform_elements", { slide: slides[0]!, items: [{ id: body.id, x: 300, y: 200 }] });
    pages.edit(PATH, CHANGED);
    expect((await reviewSources(here.session))[0]?.state).toBe("update");
  });

  it("marks a slide the person changed as edited, and a page that is gone as missing", async () => {
    const { kit: here, slides } = await made();
    here.session.core.apply("set_text", { slide: slides[0]!, id: bodyOf(here, slides[0]!).id, markdown: "My own words." });
    pages.edit(PATH, CHANGED);
    expect((await reviewSources(here.session)).map((row) => [row.slide, row.state])).toEqual([[slides[0], "edited"]]);
    pages.remove(PATH);
    const gone = await reviewSources(here.session);
    expect(gone.map((row) => row.state)).toEqual(["missing", "missing"]);
    expect(gone[0]?.reason).toMatch(/could not be found/);
  });

  it("says a section that is not in the page any more is missing", async () => {
    const { kit: here, slides } = await made();
    pages.edit(PATH, "## Plan\n\nBook early. Then pack.\n\n- flights\n- guesthouse\n");
    const rows = await reviewSources(here.session);
    expect(rows.find((row) => row.slide === slides[1])).toMatchObject({ state: "missing" });
  });
});

describe("applying the choices", () => {
  it("updates the ticked slides in one step of undo", async () => {
    const { kit: here, slides } = await made();
    pages.edit(PATH, CHANGED);
    const rows = await reviewSources(here.session);
    const before = JSON.stringify(here.session.deck);
    const done = await applyReview(here.session, rows, new Set(rows.map((r) => r.key)), new Map());
    expect(done).toEqual({ updated: 1, kept: 0, replaced: 0 });
    expect(wordsOf(here, slides[0]!)).toBe("Book late.\nflights\nguesthouse\ninsurance");
    act(() => here.session.undo());
    expect(JSON.stringify(here.session.deck)).toBe(before);
  });

  it("leaves an unticked slide alone", async () => {
    const { kit: here, slides } = await made();
    pages.edit(PATH, CHANGED);
    const rows = await reviewSources(here.session);
    expect(await applyReview(here.session, rows, new Set(), new Map())).toEqual({ updated: 0, kept: 0, replaced: 0 });
    expect(wordsOf(here, slides[0]!)).toContain("Book early.");
  });

  it("keeps the person's slide: its words stay, and it is not offered again until the page changes again", async () => {
    const { kit: here, slides } = await made();
    here.session.core.apply("set_text", { slide: slides[0]!, id: bodyOf(here, slides[0]!).id, markdown: "My own words." });
    pages.edit(PATH, CHANGED);
    const rows = await reviewSources(here.session);
    const done = await applyReview(here.session, rows, new Set(), new Map([[rows[0]!.key, "keep" as const]]));
    expect(done).toEqual({ updated: 0, kept: 1, replaced: 0 });
    expect(wordsOf(here, slides[0]!)).toBe("My own words.");
    expect(await reviewSources(here.session)).toEqual([]);
    pages.edit(PATH, CHANGED.replace("insurance", "visas"));
    expect((await reviewSources(here.session))[0]?.state).toBe("edited");
  });

  it("replaces the person's slide with the page's words when they choose to", async () => {
    const { kit: here, slides } = await made();
    here.session.core.apply("set_text", { slide: slides[0]!, id: bodyOf(here, slides[0]!).id, markdown: "My own words." });
    pages.edit(PATH, CHANGED);
    const rows = await reviewSources(here.session);
    const done = await applyReview(here.session, rows, new Set(), new Map([[rows[0]!.key, "replace" as const]]));
    expect(done).toEqual({ updated: 0, kept: 0, replaced: 1 });
    expect(wordsOf(here, slides[0]!)).toBe("Book late.\nflights\nguesthouse\ninsurance");
    expect(await reviewSources(here.session)).toEqual([]);
  });

  it("never touches a slide whose page is gone", async () => {
    const { kit: here } = await made();
    pages.remove(PATH);
    const rows = await reviewSources(here.session);
    const before = JSON.stringify(here.session.deck);
    expect(await applyReview(here.session, rows, new Set(rows.map((r) => r.key)), new Map())).toEqual({ updated: 0, kept: 0, replaced: 0 });
    expect(JSON.stringify(here.session.deck)).toBe(before);
  });
});

describe("Update all from their pages", () => {
  it("leaves a slide the person changed alone, and counts it", async () => {
    const { kit: here, slides } = await made();
    here.session.core.apply("set_text", { slide: slides[0]!, id: bodyOf(here, slides[0]!).id, markdown: "My own words." });
    pages.edit(PATH, CHANGED);
    expect(await updateFromPages(here.session)).toEqual({ updated: 0, missing: 0, same: 1, edited: 1 });
    expect(wordsOf(here, slides[0]!)).toBe("My own words.");
  });

  it("updates the ones that are as they were made", async () => {
    const { kit: here, slides } = await made();
    pages.edit(PATH, CHANGED);
    expect(await updateFromPages(here.session)).toEqual({ updated: 1, missing: 0, same: 1 });
    expect(wordsOf(here, slides[0]!)).toContain("insurance");
  });
});

describe("the dialog", () => {
  it("ticks what can be updated, asks about what was changed on both sides, and applies in one step", async () => {
    const { kit: here, slides } = await made();
    here.session.core.apply("set_text", { slide: slides[1]!, id: bodyOf(here, slides[1]!).id, markdown: "Mine." });
    pages.edit(PATH, CHANGED.replace("- bed: 40", "- bed: 45"));
    act(() => here.ui.openDialog("review-sources"));
    const box = await screen.findByRole("dialog", { name: "Review slides made from pages" });
    const list = await within(box).findByRole("list", { name: "Slides to review" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    const update = within(box).getByRole("checkbox", { name: "Update slide 2" }) as HTMLInputElement;
    expect(update.checked).toBe(true);
    // The slide that was changed on both sides defaults to being kept.
    expect(within(box).getByRole("radio", { name: /Keep slide 3 as it is/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(box).getByRole("radio", { name: /Replace slide 3/ }));
    fireEvent.click(within(box).getByRole("button", { name: "Apply to 2 slides" }));
    await waitFor(() => expect(here.ui.state.dialog).toBeNull());
    expect(wordsOf(here, slides[0]!)).toContain("insurance");
    expect(wordsOf(here, slides[1]!)).toBe("bed: 45");
    expect(here.host.notices.at(-1)).toBe("Updated 1 slide from its page. Replaced 1 slide you had changed.");
  });

  it("says when there is nothing to review", async () => {
    const { kit: here } = await made();
    act(() => here.ui.openDialog("review-sources"));
    expect(await screen.findByText(/Nothing to review/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("is a command, in the Tools menu where the host has pages", async () => {
    const { kit: here } = await made();
    const { COMMANDS } = await import("../commands/index.ts");
    const command = COMMANDS.get("page.review-sources")!;
    expect(command.label).toBe("Review sources…");
    await act(async () => void command.run({ session: here.session, ui: here.ui }));
    expect(here.ui.state.dialog).toBe("review-sources");
  });
});
