import { describe, expect, it, vi } from "vitest";

import { WHEN_TOKENS, type Collection } from "../../lib/vault/collection-types";
import type { Hit, NoteMeta, TagSchema, VaultClient } from "../../lib/vault/types";
import { expandWhen, fullQuery, mergedSchema, runCollection, shownLimit, viewOf, whenRange } from "./run";

const TODAY = "2026-10-10"; // a Saturday

describe("whenRange", () => {
  it("covers each span, both ends included", () => {
    const range = (token: (typeof WHEN_TOKENS)[number], today = TODAY, weekStart = 1) => {
      const { from, to } = whenRange(token, today, weekStart);
      return `${from}..${to}`;
    };
    expect(range("today")).toBe("2026-10-10..2026-10-10");
    expect(range("yesterday")).toBe("2026-10-09..2026-10-09");
    expect(range("last-7-days")).toBe("2026-10-03..2026-10-10");
    expect(range("last-30-days")).toBe("2026-09-10..2026-10-10");
    expect(range("next-7-days")).toBe("2026-10-10..2026-10-17");
    expect(range("this-month")).toBe("2026-10-01..2026-10-31");
    expect(range("last-month")).toBe("2026-09-01..2026-09-30");
    expect(range("this-year")).toBe("2026-01-01..2026-12-31");
  });

  it("starts the week on the day the settings say", () => {
    expect(whenRange("this-week", TODAY, 1)).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(whenRange("this-week", TODAY, 0)).toEqual({ from: "2026-10-04", to: "2026-10-10" });
    expect(whenRange("this-week", TODAY, 6)).toEqual({ from: "2026-10-10", to: "2026-10-16" });
    expect(whenRange("this-week", "2026-10-11", 1)).toEqual({ from: "2026-10-05", to: "2026-10-11" });
  });

  it("crosses a month, a year and a leap day", () => {
    expect(whenRange("yesterday", "2026-03-01")).toEqual({ from: "2026-02-28", to: "2026-02-28" });
    expect(whenRange("yesterday", "2028-03-01")).toEqual({ from: "2028-02-29", to: "2028-02-29" });
    expect(whenRange("last-month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(whenRange("last-month", "2028-03-31")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(whenRange("this-month", "2026-02-10").to).toBe("2026-02-28");
    expect(whenRange("next-7-days", "2026-12-28").to).toBe("2027-01-04");
    expect(whenRange("last-30-days", "2026-01-10").from).toBe("2025-12-11");
  });

  it("knows every token", () => {
    for (const token of WHEN_TOKENS) {
      const { from, to } = whenRange(token, TODAY);
      expect(from <= to, token).toBe(true);
      expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("the query a collection asks", () => {
  it("adds the days to the words", () => {
    expect(expandWhen({ updated: "last-30-days" }, TODAY)).toEqual(["updated:2026-09-10..2026-10-10"]);
    expect(expandWhen({ created: "this-year", on: "today" }, TODAY)).toEqual(["created:2026-01-01..2026-12-31", "on:2026-10-10..2026-10-10"]);
    expect(expandWhen(null, TODAY)).toEqual([]);
    expect(fullQuery({ query: "  #capture project:photo-organiser ", when: { updated: "last-30-days" } }, TODAY)).toBe("#capture project:photo-organiser updated:2026-09-10..2026-10-10");
    expect(fullQuery({ query: "", when: { updated: "today" } }, TODAY)).toBe("updated:2026-10-10..2026-10-10");
    expect(fullQuery({ query: "", when: null }, TODAY)).toBe("");
  });
});

const note = (path: string, props: Record<string, unknown> = {}, extra: Partial<NoteMeta> = {}): NoteMeta => ({
  path,
  id: path,
  title: path.replace(/^.*\//, "").replace(/\.md$/, ""),
  kind: "card",
  icon: null,
  cover: null,
  parent: null,
  project: null,
  tags: ["capture"],
  modified: 0,
  created: null,
  updated: null,
  excerpt: "",
  words: 0,
  props,
  locked: false,
  ...extra,
});

const collection = (patch: Partial<Collection> = {}): Collection => ({
  path: "views/q.yaml",
  slug: "q",
  name: "Queue",
  icon: null,
  query: "#capture",
  when: null,
  filter: [],
  sort: [],
  display: null,
  format: 1,
  hash: "h",
  modified: 0,
  problem: null,
  readOnly: false,
  ...patch,
});

const NOTES = [
  note("inbox/a.md", { reading: "Unread", captured: "2026-10-01" }),
  note("inbox/b.md", { reading: "Finished", captured: "2026-10-05" }),
  note("inbox/c.md", { reading: "Reading", captured: "2026-09-20" }),
  note("inbox/d.md", {}),
  note("templates/t.md", {}, { kind: "template" }),
];

const clientFor = (paths: string[]) => {
  const search = vi.fn(async (_query: string, _limit?: number): Promise<Hit[]> => paths.map((path) => ({ path, title: path, icon: null, snippet: "", score: 1 })));
  return { client: { search } as unknown as VaultClient, search };
};

describe("runCollection", () => {
  it("asks the search engine with the days added and maps its hits to notes", async () => {
    const { client, search } = clientFor(["inbox/c.md", "inbox/a.md", "gone/x.md"]);
    const run = await runCollection(client, collection({ when: { updated: "last-30-days" } }), NOTES, TODAY);
    expect(search).toHaveBeenCalledWith("#capture updated:2026-09-10..2026-10-10", 5000);
    // A hit the workspace has no note for is left out; the order is the title order without sorts.
    expect(run.notes.map((n) => n.path)).toEqual(["inbox/a.md", "inbox/c.md"]);
    expect(run).toMatchObject({ total: 2, capped: false, query: "#capture updated:2026-09-10..2026-10-10" });
  });

  it("filters and sorts as a tag database view does", async () => {
    const { client } = clientFor(["inbox/a.md", "inbox/b.md", "inbox/c.md", "inbox/d.md"]);
    const c = collection({ filter: [{ key: "reading", op: "is_not", value: "Finished" }], sort: [{ key: "captured", dir: "desc" }] });
    expect((await runCollection(client, c, NOTES, TODAY)).notes.map((n) => n.path)).toEqual(["inbox/a.md", "inbox/c.md", "inbox/d.md"]);
    const unread = collection({ filter: [{ key: "reading", op: "is", value: "unread" }] });
    expect((await runCollection(client, unread, NOTES, TODAY)).notes.map((n) => n.path)).toEqual(["inbox/a.md"]);
    const sorted = collection({ sort: [{ key: "reading" }] });
    const schema: TagSchema = { name: "capture", color: null, properties: [{ key: "reading", type: "select", options: ["Unread", "Reading", "Finished"] }], views: [], path: "tags/capture.yaml" };
    expect((await runCollection(client, sorted, NOTES, TODAY, 1, [schema])).notes.map((n) => n.path)).toEqual(["inbox/a.md", "inbox/c.md", "inbox/b.md", "inbox/d.md"]);
  });

  it("is every note, templates apart, when it holds no words and no days, and does not search", async () => {
    const { client, search } = clientFor([]);
    const run = await runCollection(client, collection({ query: " ", filter: [{ key: "reading", op: "not_empty" }] }), NOTES, TODAY);
    expect(search).not.toHaveBeenCalled();
    expect(run.notes.map((n) => n.path)).toEqual(["inbox/a.md", "inbox/b.md", "inbox/c.md"]);
    expect(run.query).toBe("");
  });

  it("shows at most its limit, and says how many matched and when the engine stopped", async () => {
    const many = Array.from({ length: 7 }, (_, n) => note(`inbox/n${n}.md`));
    const { client } = clientFor(many.map((n) => n.path));
    const run = await runCollection(client, collection({ display: { limit: 3 } }), many, TODAY);
    expect(run.notes).toHaveLength(3);
    expect(run.total).toBe(7);
    const big = Array.from({ length: 5000 }, (_, n) => note(`inbox/b${n}.md`));
    const capped = await runCollection(clientFor(big.map((n) => n.path)).client, collection({ display: { limit: 5000 } }), big, TODAY);
    expect(capped.capped).toBe(true);
    expect(capped.notes).toHaveLength(5000);
  });

  it("keeps the limit in range", () => {
    expect(shownLimit(collection())).toBe(500);
    expect(shownLimit(collection({ display: { limit: 0 } }))).toBe(1);
    expect(shownLimit(collection({ display: { limit: 99999 } }))).toBe(5000);
  });
});

describe("the view a collection is shown as", () => {
  it("is a table unless the display says, with its columns and sorts", () => {
    expect(viewOf(collection())).toEqual({ name: "Queue", type: "table", filter: [], sort: [] });
    expect(viewOf(collection({ display: { type: "gallery", columns: ["title", "site"] }, sort: [{ key: "captured" }] }))).toMatchObject({ type: "gallery", columns: ["title", "site"], sort: [{ key: "captured", dir: "asc" }] });
  });

  it("merges every tag's properties, the first definition of a key winning", () => {
    const a: TagSchema = { name: "a", color: null, properties: [{ key: "status", type: "select", options: ["x"] }], views: [], path: "" };
    const b: TagSchema = { name: "b", color: null, properties: [{ key: "status", type: "text", options: [] }, { key: "due", type: "date", options: [] }], views: [], path: "" };
    expect(mergedSchema([a, b]).properties.map((p) => `${p.key}:${p.type}`)).toEqual(["status:select", "due:date"]);
  });
});
