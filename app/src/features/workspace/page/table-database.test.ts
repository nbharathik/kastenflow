// "Turn into database" for a page in a vault: the schema, the notes and the page's
// table swapped for the embed are ONE batch; what was typed is saved first; the
// page is shown again from disk; a refusal changes nothing and says one sentence.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BatchChange, BatchRun, NoteMeta, PageBlocks, VaultClient } from "../../../lib/vault/types";
import type { DatabasePlan, TableSpot } from "../../pages/editor/tables/database";
import { MemoryVault } from "../preview/memory-vault";
import { useWorkspace } from "../store";
import { registerPage } from "./open-page";
import { PageSession } from "./page-session";
import { plainRefusal, tableDatabaseLinks } from "./table-database";

const PATH = "library/stand.md";
const TEXT = "---\nid: STAND\ntitle: Fruit stand\ntype: page\n---\n# Stand\n\n| Item | Qty |\n|---|---|\n| apple | 3 |\n| pear | 12 |\n\nAfter.\n";

const plan: DatabasePlan = {
  name: "Inventory",
  tag: "inventory",
  properties: [{ key: "Qty", type: "number", options: [] }],
  notes: [
    { title: "apple", props: { Qty: 3 } },
    { title: "pear", props: { Qty: 12 } },
  ],
};
const spot: TableSpot = { index: 0, count: 1, rows: 3, columns: 2 };
const blocks = (over: Partial<PageBlocks> = {}): PageBlocks => ({
  path: PATH,
  title: "Fruit stand",
  hash: "h",
  total: 3,
  truncated: false,
  blocks: [
    { id: "b1", kind: "heading", depth: 0, heading_path: ["Stand"], text: "# Stand", hash: "h1" },
    { id: "b2", kind: "table", depth: 0, heading_path: ["Stand"], text: "| Item | Qty |", hash: "h2", table: { rows: 3, columns: 2 } },
    { id: "b3", kind: "paragraph", depth: 0, heading_path: ["Stand"], text: "After.", hash: "h3" },
  ],
  ...over,
});
const run: BatchRun = { changes: 4, results: [{ path: "tags/inventory.yaml" }, {}, {}, {}], commit: "c0ffee" };

let calls: string[];
let vault: MemoryVault;
let client: VaultClient;
let session: PageSession;
let reloaded: number;
const forget: (() => void)[] = [];
const toasts = () => useWorkspace.getState().toasts;

async function open(kind: "vault" | "preview" = "vault") {
  // The page opened before is closed: only this one reloads.
  for (const stop of forget.splice(0)) stop();
  vault = new MemoryVault({ [PATH]: TEXT });
  await useWorkspace.getState().connect({ client: vault });
  calls = [];
  reloaded = 0;
  const stub = {
    kind,
    pageBlocks: vi.fn(async () => (calls.push("blocks"), blocks())),
    newTagFile: vi.fn(async (tag: string) => (calls.push("file"), `tags/${tag}.yaml`)),
    runBatch: vi.fn(async (_changes: BatchChange[], _reason?: string) => (calls.push("batch"), run)),
    saveBody: vi.fn(async (...args: Parameters<MemoryVault["saveBody"]>) => (calls.push("save"), vault.saveBody(...args))),
  };
  client = Object.assign(Object.create(vault) as MemoryVault, stub) as unknown as VaultClient;
  const note = await vault.read(PATH);
  const none = vi.fn();
  session = new PageSession(client, PATH, note, { onState: none, onNote: none, onRenamed: none, onConflict: none, onMerged: none, onError: none }, 10_000);
  forget.push(registerPage(session, () => void reloaded++, () => {}));
  return { stub, meta: note.meta as NoteMeta };
}

beforeEach(() => {
  useWorkspace.setState({ place: { view: "home" }, back: [], forward: [], toasts: [] });
});

describe("where it is offered", () => {
  it("is for a page in a vault, not the browser preview", async () => {
    const { meta } = await open("preview");
    expect(tableDatabaseLinks(client, session, () => meta).turnTableIntoDatabase).toBeUndefined();
    const real = await open("vault");
    expect(tableDatabaseLinks(client, session, () => real.meta).turnTableIntoDatabase).toBeTypeOf("function");
  });
});

describe("making the database", () => {
  it("saves what was typed, then makes the schema, the notes and the page's embed as one batch, and shows the page again", async () => {
    const { stub, meta } = await open();
    const links = tableDatabaseLinks(client, session, () => meta);
    session.editBody(TEXT.split("---\n")[2]!.replace("After.", "After, typed just now."));
    const made = await links.turnTableIntoDatabase!(plan, spot);

    expect(made).toEqual({ path: "tags/inventory.yaml", view: "Table" });
    // Typed text is saved before the page's blocks are read and before the batch.
    expect(calls).toEqual(["save", "blocks", "file", "batch"]);
    const [changes, reason] = stub.runBatch.mock.calls[0]!;
    expect(reason).toBe("Turn the table into a database: Inventory");
    expect(changes.map((c) => c.kind)).toEqual(["tag_schema", "create_note", "create_note", "edit_page"]);
    expect(changes[1]).toMatchObject({ title: "apple", tags: ["inventory"], props: { Qty: 3 }, parent: PATH });
    expect(changes[3]).toEqual({
      kind: "edit_page",
      path: PATH,
      steps: [{ op: "replace", block: { block: "b2", hash: "h2" }, markdown: "![[tags/inventory.yaml#Table]]\n" }],
    });
    expect(reloaded).toBe(1);
    expect(toasts().map((t) => t.text)).toEqual(["Made the database “Inventory” from 2 rows"]);
    expect(toasts()[0]!.action?.label).toBe("Undo");
  });

  it("puts the notes in the project of a note that holds no pages", async () => {
    const { stub, meta } = await open();
    const links = tableDatabaseLinks(client, session, () => ({ ...meta, kind: "card", project: "market" }));
    await links.turnTableIntoDatabase!(plan, spot);
    const changes = stub.runBatch.mock.calls[0]![0];
    expect(changes[1]).toMatchObject({ project: "market" });
    expect(changes[1]).not.toHaveProperty("parent");
  });

  it("offers Undo for the one commit, then shows the page and the lists again", async () => {
    const { meta } = await open();
    const undo = vi.spyOn(client, "undoCommit").mockResolvedValue({ reverted: ["c0ffee"], conflict: null });
    await tableDatabaseLinks(client, session, () => meta).turnTableIntoDatabase!(plan, spot);
    reloaded = 0;
    toasts()[0]!.action!.run();
    await vi.waitFor(() => expect(toasts().map((t) => t.text)).toContain("Took back the database “Inventory”"));
    expect(undo).toHaveBeenCalledWith("c0ffee");
    expect(reloaded).toBe(1);
  });

  it("says when something changed since and nothing was taken back", async () => {
    const { meta } = await open();
    vi.spyOn(client, "undoCommit").mockResolvedValue({ reverted: [], conflict: { commit: "x", summary: "edit", path: PATH, detail: "Edited since" } });
    await tableDatabaseLinks(client, session, () => meta).turnTableIntoDatabase!(plan, spot);
    toasts()[0]!.action!.run();
    await vi.waitFor(() => expect(toasts().map((t) => t.text)).toContain(`Not undone: ${PATH} changed since (edited since).`));
  });
});

describe("when it cannot be done", () => {
  it("changes nothing and says one sentence when the core refuses", async () => {
    const { stub, meta } = await open();
    const links = tableDatabaseLinks(client, session, () => meta);
    for (const [said, want] of [
      ["Change 1 of 4 (update_tag_schema): The tag “inventory” already has a schema, and a batch only makes the schema of a tag that has none. Change its properties and views on their own. Nothing in the batch was changed.", "A database called “Inventory” already exists. Give this one another name."],
      ["Change 4 of 4 (edit_page): Block b2 changed since you read it, so nothing was written. Read the page again. Nothing in the batch was changed.", "The page changed while the database was being made, so nothing was changed. Try again."],
      ["Change 2 of 4 (create_note): Property “Qty” (number) must be a number. Nothing in the batch was changed.", "Nothing was changed: property “Qty” (number) must be a number."],
      ["A batch is undone as one step, which needs the vault's history. Turn on history first, or send the changes one at a time", "Turn on history in Settings first, so that making a database can be undone. Nothing was changed."],
    ] as const) {
      stub.runBatch.mockRejectedValueOnce(new Error(said));
      expect(await links.turnTableIntoDatabase!(plan, spot)).toEqual({ error: want });
    }
    expect(reloaded).toBe(0);
    expect(toasts()).toEqual([]);
  });

  it("does not say nothing was changed when the database was made and only showing it failed", async () => {
    const { meta } = await open();
    const links = tableDatabaseLinks(client, session, () => meta);
    const refresh = useWorkspace.getState().refresh;
    useWorkspace.setState({ refresh: () => Promise.reject(new Error("lists unavailable")) });
    try {
      const made = await links.turnTableIntoDatabase!(plan, spot);
      expect(made).toEqual({ path: "tags/inventory.yaml", view: "Table" });
      expect(toasts().map((t) => t.text)).toEqual(["Made the database “Inventory” from 2 rows"]);
    } finally {
      useWorkspace.setState({ refresh });
    }
  });

  it("tells a table that is too big for one commit in plain words", async () => {
    const { stub, meta } = await open();
    const links = tableDatabaseLinks(client, session, () => meta);
    stub.runBatch.mockRejectedValueOnce(new Error("A batch may send at most 1024 KB of text; this one sends 1300 KB. Send it as smaller batches"));
    const made = (await links.turnTableIntoDatabase!(plan, spot)) as { error: string };
    expect(made.error).toBe("This table holds too much to turn into a database at once. Split it into smaller tables first. Nothing was changed.");
    expect(made.error).not.toMatch(/batch/i);
  });

  it("does not guess which table when the page and the editor disagree", async () => {
    const { stub, meta } = await open();
    const links = tableDatabaseLinks(client, session, () => meta);
    for (const bad of [
      blocks({ blocks: blocks().blocks.slice(0, 1) }),
      blocks({ truncated: true }),
      blocks({ blocks: blocks().blocks.map((b) => (b.table ? { ...b, table: { rows: 4, columns: 2 } } : b)) }),
    ]) {
      stub.pageBlocks.mockResolvedValueOnce(bad);
      const made = await links.turnTableIntoDatabase!(plan, spot);
      expect(made).toHaveProperty("error");
      expect((made as { error: string }).error).toMatch(/can't be turned into a database from where it is/);
    }
    expect(stub.runBatch).not.toHaveBeenCalled();
    // Two tables in the editor but one block: the second one is not there to name.
    const second = await links.turnTableIntoDatabase!(plan, { ...spot, index: 1, count: 2 });
    expect(second).toHaveProperty("error");
    expect(stub.runBatch).not.toHaveBeenCalled();
  });

  it("needs a saved page and a page that could be saved", async () => {
    const { stub, meta } = await open();
    const links = tableDatabaseLinks(client, session, () => undefined);
    expect(await links.turnTableIntoDatabase!(plan, spot)).toEqual({ error: "Write something on the page first, so it is saved, then turn the table into a database." });
    // A page whose save fails stays busy: nothing is made on top of text that is not saved.
    const mine = tableDatabaseLinks(client, session, () => meta);
    stub.saveBody.mockRejectedValueOnce(new Error("disk full"));
    session.editBody("typed");
    expect(await mine.turnTableIntoDatabase!(plan, spot)).toEqual({ error: "The page could not be saved first, so nothing was changed. Try again in a moment." });
    expect(stub.runBatch).not.toHaveBeenCalled();
  });
});

describe("the sentence for a refusal", () => {
  it("drops the core's bookkeeping and keeps the reason", () => {
    expect(plainRefusal("Change 3 of 9 (create_note): A note called apple already exists. Nothing in the batch was changed.", "X")).toBe("Nothing was changed: a note called apple already exists.");
    expect(plainRefusal("Something odd", "X")).toBe("Nothing was changed: something odd.");
  });
});
