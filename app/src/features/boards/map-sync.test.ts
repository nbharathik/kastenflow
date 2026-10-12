import { describe, expect, it, vi } from "vitest";

import type { BoardView, NoteMeta } from "../../lib/vault/types";
import { splitFrontmatter } from "../pages/markdown/frontmatter";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { applySync, describe as said, planSync } from "./map-sync";
import { mapFromPage, sendTo } from "./page-map";
import { SEED } from "./map-fixtures";
import { readOutline } from "./outline";

async function mapped(body?: string): Promise<{ vault: MemoryVault; note: NoteMeta; path: string }> {
  const vault = new MemoryVault(SEED);
  const note = (await vault.list()).find((n) => n.title === "Seaside trip")!;
  if (body !== undefined) await edit(vault, note, () => body);
  return { vault, note, path: await mapFromPage(vault, note) };
}

/** Writes the page again with `change` applied to its body. */
async function edit(vault: MemoryVault, note: NoteMeta, change: (body: string) => string): Promise<void> {
  const file = await vault.read(note.path);
  await vault.saveBody(note.path, change(splitFrontmatter(file.text).body), file.hash);
}

/** Brings the map in step with the page as it is now. */
async function sync(vault: MemoryVault, note: NoteMeta, path: string) {
  const doc = await vault.board(path);
  const body = splitFrontmatter((await vault.read(note.path)).text).body;
  const plan = planSync(doc, note, readOutline(body))!;
  const result = await applySync(doc, plan, sendTo(vault, path));
  return { plan, result, doc };
}

const node = (board: BoardView, text: string) => board.nodes.find((n) => n.text === text)!;
const live = (board: BoardView) => board.nodes.filter((n) => n.kind === "text").map((n) => n.text);

describe("keeping a map in step with its page", () => {
  it("adds new lines beside their parents, rewords branches, dims what left and leaves hand-made things alone", async () => {
    const { vault, note, path } = await mapped();
    const before = await vault.board(path);
    // The person moves and resizes a branch, adds a sticky and a join of their own.
    const baixa = node(before, "Baixa");
    const stay = node(before, "Where to stay");
    const made = await vault.boardApply(path, [{ kind: "place", id: baixa.id, x: 5000, y: 4000, width: 500, height: 90 }, { kind: "sticky", text: "My idea", x: 800, y: 900 }]);
    const mine = made.made[0]!;
    await vault.boardApply(path, [{ kind: "connect", from: stay.id, to: mine, label: "mine" }]);
    const own = await vault.board(path);

    await edit(vault, note, (body) =>
      body
        .replace("- Baixa\n", "- Baixa district\n")
        .replace("  - close to the trams\n", "  - close to the trams\n- Alfama\n")
        .replace("- [x] Insurance\n", "")
        .concat("\n## Day trips\n- Sintra\n- Cascais\n"),
    );
    const { plan, result } = await sync(vault, note, path);

    expect(plan.added.map((a) => a.text)).toEqual(["Alfama", "Day trips", "Sintra", "Cascais"]);
    expect(plan.retexts).toEqual([{ id: baixa.id, text: "Baixa district" }]);
    expect(plan.stale).toEqual([node(before, "☑ Insurance").id]);
    expect(result).toMatchObject({ added: 4, updated: 1, stale: 1, revived: 0 });
    expect(said(result!)).toBe("4 new, 1 changed, 1 not in the page any more");

    const after = await vault.board(path);
    // The reworded branch is the same node, still where the person put it.
    expect(node(after, "Baixa district")).toMatchObject({ id: baixa.id, x: 5000, y: 4000, width: 500, height: 90 });
    // What the person made is untouched, its join too.
    expect(after.nodes.find((n) => n.id === mine)).toEqual(own.nodes.find((n) => n.id === mine));
    expect(after.edges.find((e) => e.label === "mine")).toEqual(own.edges.find((e) => e.label === "mine"));
    // Nothing left that was there before: what left the page is dimmed, not taken off.
    const gone = node(before, "☑ Insurance");
    expect(after.nodes.find((n) => n.id === gone.id)).toEqual(gone);
    expect(after.source!.branches![gone.id]!.stale).toBe(true);
    for (const old of before.nodes.filter((n) => n.id !== baixa.id)) expect(after.nodes.find((n) => n.id === old.id)).toEqual(old);
    expect(live(after)).toEqual(expect.arrayContaining(["Alfama", "Day trips", "Sintra", "Cascais"]));

    // New branches hang from their parents, to the right of them.
    const edgeTo = (id: string) => after.edges.find((e) => e.to === id)!;
    const alfama = node(after, "Alfama");
    expect(edgeTo(alfama.id).from).toBe(stay.id);
    expect(alfama.x).toBeGreaterThan(stay.x + stay.width);
    const trips = node(after, "Day trips");
    expect(edgeTo(trips.id).from).toBe(after.source!.root);
    expect(edgeTo(node(after, "Sintra").id).from).toBe(trips.id);
    expect(node(after, "Sintra").x).toBeGreaterThan(trips.x + trips.width);
    // The branches are remembered under their new ids.
    expect(after.source!.branches![alfama.id]).toEqual({ parent: stay.id, key: "alfama", text: "Alfama" });
    expect(after.source!.branches![node(after, "Cascais").id]!.parent).toBe(trips.id);
  });

  it("makes no board change when the page has not changed in a way the map shows", async () => {
    const { vault, note, path } = await mapped();
    const spy = vi.spyOn(vault, "boardApply");
    const { plan, result } = await sync(vault, note, path);
    expect(plan.changed).toBe(false);
    expect(result).toMatchObject({ added: 0, updated: 0, stale: 0 });
    // Words outside the outline, and a to-do ticked, change nothing for it.
    await edit(vault, note, (body) => body.replace("Some notes that are not part", "Some words that are not part").replace("- [ ] Flights", "- [x] Flights"));
    const again = await sync(vault, note, path);
    expect(again.plan.retexts).toEqual([{ id: node(again.doc, "☐ Flights").id, text: "☑ Flights" }]);
    spy.mockClear();
    await edit(vault, note, (body) => body.replace("Some words that are not part", "Other words that are not part"));
    const quiet = await sync(vault, note, path);
    expect(quiet.plan.changed).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("leaves a branch the person reworded alone until the page's line changes", async () => {
    const { vault, note, path } = await mapped();
    const baixa = node(await vault.board(path), "Baixa");
    await vault.boardApply(path, [{ kind: "text", id: baixa.id, text: "Baixa (my words)" }]);
    const spy = vi.spyOn(vault, "boardApply");
    const quiet = await sync(vault, note, path);
    expect(quiet.plan.changed).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    await edit(vault, note, (body) => body.replace("- Baixa\n", "- Baixa district\n"));
    await sync(vault, note, path);
    expect(node(await vault.board(path), "Baixa district").id).toBe(baixa.id);
  });

  it("dims a branch once, and brings it back when its line does", async () => {
    const { vault, note, path } = await mapped();
    const insurance = node(await vault.board(path), "☑ Insurance");
    await edit(vault, note, (body) => body.replace("- [x] Insurance\n", ""));
    const first = await sync(vault, note, path);
    expect(first.plan.stale).toEqual([insurance.id]);
    const spy = vi.spyOn(vault, "boardApply");
    const second = await sync(vault, note, path);
    expect(second.plan.stale).toEqual([]);
    expect(second.plan.changed).toBe(false);
    expect(spy).not.toHaveBeenCalled();

    await edit(vault, note, (body) => body.replace("- [ ] Flights\n", "- [ ] Flights\n- [x] Insurance\n"));
    const back = await sync(vault, note, path);
    expect(back.plan.revived).toEqual([insurance.id]);
    expect(back.plan.added).toEqual([]);
    const board = await vault.board(path);
    expect(board.source!.branches![insurance.id]!.stale).toBeUndefined();
    expect(board.nodes.filter((n) => n.text === "☑ Insurance")).toHaveLength(1);
  });

  it("dims a whole branch's children with it", async () => {
    const { vault, note, path } = await mapped();
    await edit(vault, note, (body) => body.replace("- Baixa\n  - close to the trams\n", ""));
    const { plan } = await sync(vault, note, path);
    const board = await vault.board(path);
    expect(plan.stale).toEqual([node(board, "Baixa").id, node(board, "close to the trams").id]);
  });

  it("keeps what hangs from a heading when the heading is reworded", async () => {
    const { vault, note, path } = await mapped();
    const before = await vault.board(path);
    await edit(vault, note, (body) => body.replace("## What to eat", "## What to try"));
    const { plan } = await sync(vault, note, path);
    expect(plan.retexts).toEqual([{ id: node(before, "What to eat").id, text: "What to try" }]);
    expect(plan.added).toEqual([]);
    expect(plan.stale).toEqual([]);
    const after = await vault.board(path);
    expect(after.nodes).toHaveLength(before.nodes.length);
    expect(after.edges).toHaveLength(before.edges.length);
  });

  it("does not bring back a branch the person took off", async () => {
    const { vault, note, path } = await mapped();
    const before = await vault.board(path);
    await vault.boardApply(path, [{ kind: "remove", ids: [node(before, "Baixa").id] }]);
    await edit(vault, note, (body) => body.replace("  - close to the trams\n", "  - close to the trams\n  - a new line under it\n"));
    const quiet = await sync(vault, note, path);
    expect(quiet.plan.added).toEqual([]);
    expect(quiet.plan.stale).toEqual([]);
    const after = await vault.board(path);
    expect(live(after)).not.toContain("Baixa");
    expect(live(after)).not.toContain("a new line under it");
    expect(live(after)).toContain("close to the trams");
    // A branch of the page next to it is still added.
    await edit(vault, note, (body) => body.replace("  - a new line under it\n", "  - a new line under it\n- Alfama\n"));
    expect((await sync(vault, note, path)).plan.added.map((a) => a.text)).toEqual(["Alfama"]);
  });

  it("takes lines past what a map follows for lines still there, not lines gone", async () => {
    const lines = Array.from({ length: 90 }, (_, i) => `- item ${i}`).join("\n");
    const { vault, note, path } = await mapped(`## Long\n${lines}\n`);
    expect((await vault.board(path)).nodes.filter((n) => n.kind === "text")).toHaveLength(80);
    await edit(vault, note, (body) => body.replace("## Long\n", "## Long\n- first\n"));
    const { plan } = await sync(vault, note, path);
    expect(plan.cut).toBe(true);
    expect(plan.stale).toEqual([]);
    expect(plan.added.map((a) => a.text)).toEqual(["first"]);
  });

  it("has nothing to sync with once the page's card is off the board", async () => {
    const { vault, note, path } = await mapped();
    const doc = await vault.board(path);
    await vault.boardApply(path, [{ kind: "remove", ids: [doc.source!.root!] }]);
    const body = splitFrontmatter((await vault.read(note.path)).text).body;
    expect(planSync(await vault.board(path), note, readOutline(body))).toBeNull();
  });

  it("lays a new line out only among the branches it joins, however the rest was moved", async () => {
    const { vault, note, path } = await mapped();
    const before = await vault.board(path);
    const shift = before.nodes.filter((n) => n.kind === "text").map((n, i) => ({ kind: "place" as const, id: n.id, x: n.x + 37 * i, y: n.y - 11 * i }));
    await vault.boardApply(path, shift);
    const moved = await vault.board(path);
    await edit(vault, note, (body) => body.replace("  - close to the trams\n", "  - close to the trams\n- Alfama\n"));
    await sync(vault, note, path);
    const after = await vault.board(path);
    for (const old of moved.nodes) expect(after.nodes.find((n) => n.id === old.id)).toEqual(old);
    const alfama = node(after, "Alfama");
    const overlaps = after.nodes.filter((n) => n.id !== alfama.id && n.x < alfama.x + alfama.width && alfama.x < n.x + n.width && n.y < alfama.y + alfama.height && alfama.y < n.y + n.height);
    expect(overlaps).toEqual([]);
  });

  it("is sent in two batches (the second needs the new ids), none when nothing is new", async () => {
    const { vault, note, path } = await mapped();
    const spy = vi.spyOn(vault, "boardApply");
    await edit(vault, note, (body) => body.replace("  - close to the trams\n", "  - close to the trams\n- Alfama\n"));
    await sync(vault, note, path);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockClear();
    await edit(vault, note, (body) => body.replace("- Baixa\n", "- Baixa district\n"));
    await sync(vault, note, path);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("takes off again what its first batch made when the second is refused", async () => {
    const { vault, note, path } = await mapped();
    const doc = await vault.board(path);
    await edit(vault, note, (body) => body.replace("  - close to the trams\n", "  - close to the trams\n- Alfama\n"));
    const body = splitFrontmatter((await vault.read(note.path)).text).body;
    const plan = planSync(doc, note, readOutline(body))!;
    const calls: string[] = [];
    const run = async (changes: Parameters<ReturnType<typeof sendTo>>[0]) => {
      calls.push(changes.map((c) => c.kind).join(","));
      return calls.length === 2 ? null : sendTo(vault, path)(changes);
    };
    expect(await applySync(doc, plan, run)).toBeNull();
    expect(calls).toHaveLength(3);
    expect(calls[2]).toBe("remove");
    expect(live(await vault.board(path))).not.toContain("Alfama");
  });
});
