// "Turn sections into a deck": the page's sections are drafted as a storyboard and the storyboard dialog is asked for. Nothing is made, and the
// page is not changed.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { loadSlides } from "@kasten-slides/wasm";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { derive } from "../../workspace/store-layout";
import { initialLayout } from "../../workspace/tabs";
import { useDecks } from "../../slides/store";
import { registerSections, type SectionsHandle } from "../editor/sections/registry";
import { useStoryboard } from "./storyboard/state";
import { turnSectionsIntoDeck } from "./to-deck";

beforeAll(async () => {
  await loadSlides(await readFile(join(import.meta.dirname, "../../../../../packages/slides-wasm/pkg/slides_wasm_bg.wasm")));
});

const PLAN = "projects/trip/pages/plan.md";
const BODY = "## Plan\n\nBook early.\n\n- flights\n- guesthouse\n\n## Budget\n\n![chart](assets/c.png)\n";
const SEED = {
  "projects/trip/_project.md": "---\ntitle: Trip\ntype: project\n---\n",
  [PLAN]: `---\ntitle: Seaside trip\n---\n${BODY}\n---\n\n## Thanks\n\nQuestions?\n`,
  "library/loose.md": "---\ntitle: Loose [page]\n---\nWords.\n",
};

let vault: MemoryVault;
let forget: (() => void) | null = null;

/** A page's editor, as the registry knows it: what its sections say. */
function showing(page: string, sections: { title: string; markdown: string }[]): void {
  const dom = document.createElement("div");
  document.body.append(dom);
  const handle: SectionsHandle = { dom, page: () => page, foldAll: () => 0, present: () => sections.length, step: () => {}, stop: () => {}, texts: () => sections };
  const unregister = registerSections(handle);
  forget = () => {
    unregister();
    dom.remove();
  };
}

beforeEach(async () => {
  vault = new MemoryVault(SEED);
  useWorkspace.setState({ client: vault, ready: true, notes: await vault.list(), ...derive(initialLayout()), recent: [], toasts: [] });
  useDecks.setState({ list: [], loaded: false });
  useStoryboard.setState({ request: null });
});
afterEach(() => {
  forget?.();
  forget = null;
});

const note = (path: string) => useWorkspace.getState().notes.find((n) => n.path === path)!;
const said = () => useWorkspace.getState().toasts.map((t) => t.text).join(" ");

describe("turning sections into a deck", () => {
  it("drafts a slide for each section and asks for the storyboard, without making anything", async () => {
    const page = note(PLAN);
    showing(page.id || page.path, [
      { title: "Plan", markdown: "## Plan\n\nBook early.\n\n- flights\n- guesthouse" },
      { title: "Budget", markdown: "## Budget\n\n![chart](assets/c.png)" },
      { title: "Thanks", markdown: "Questions?" },
      { title: "Extra", markdown: "Not on the page." },
    ]);
    await turnSectionsIntoDeck(page);
    const request = useStoryboard.getState().request;
    expect(request, said()).not.toBeNull();
    expect(request?.note.path).toBe(PLAN);
    const entries = request!.entries;
    expect(entries.map((e) => e.title)).toEqual(["Plan", "Budget", "Thanks", "Extra"]);
    expect(entries[0]).toMatchObject({ point: "Book early.", evidence: ["- flights", "- guesthouse"] });
    expect(entries[1]).toMatchObject({ evidence: ["![chart](assets/c.png)"], media: true });
    expect(entries[2]?.point).toBe("Questions?");
    // A section that says what the page's heading says is kept in step with it; words the page does not have under a heading are not.
    expect(entries[0]?.sources[0]).toMatchObject({ page: PLAN, section: "Plan" });
    expect(entries[1]?.sources[0]?.section).toBe("Budget");
    expect(entries[2]?.sources[0]?.section).toBe("Thanks");
    expect(entries[3]?.sources[0]?.section).toBeUndefined();
    // Nothing was made and the page is not changed.
    expect(await vault.decks()).toEqual([]);
    expect((await vault.read(PLAN)).text).toBe(SEED[PLAN]);
  });

  it("says so, and asks for nothing, when the page is not open or has no sections", async () => {
    await turnSectionsIntoDeck(note(PLAN));
    expect(useStoryboard.getState().request).toBeNull();
    expect(said()).toContain("nothing to turn into slides");
    const page = note(PLAN);
    showing(page.id || page.path, []);
    await turnSectionsIntoDeck(page);
    expect(useStoryboard.getState().request).toBeNull();
    expect(await vault.decks()).toEqual([]);
  });

  it("does nothing without a vault", async () => {
    useWorkspace.setState({ client: null });
    await turnSectionsIntoDeck(note(PLAN));
    expect(useStoryboard.getState().request).toBeNull();
  });
});
