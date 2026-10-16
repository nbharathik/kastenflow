import { describe, expect, it } from "vitest";

import { COLLECTION_LIMITS, WHEN_TOKENS } from "../../lib/vault/collection-types";
import { EXAMPLES, missingExamples } from "./examples";
import { fullQuery } from "./run";

describe("the example collections", () => {
  it("have unique ids and names, and use only days the core knows", () => {
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(EXAMPLES.length);
    expect(new Set(EXAMPLES.map((e) => e.name.toLowerCase())).size).toBe(EXAMPLES.length);
    for (const example of EXAMPLES) {
      expect(example.edits.query?.length ?? 0).toBeLessThanOrEqual(COLLECTION_LIMITS.query);
      for (const token of Object.values(example.edits.when ?? {})) expect(WHEN_TOKENS).toContain(token);
    }
  });

  it("include Captured this week: the captures of the last seven days, by the person's own days", () => {
    const week = EXAMPLES.find((e) => e.id === "captured-this-week")!;
    expect(week.name).toBe("Captured this week");
    // Counted from today, as the collections' "last 7 days" are: the seven days before it, and today.
    expect(fullQuery({ query: week.edits.query ?? "", when: week.edits.when ?? null }, "2026-10-11")).toBe("#capture created:2026-10-04..2026-10-11");
    expect(fullQuery({ query: week.edits.query ?? "", when: week.edits.when ?? null }, "2026-01-03")).toBe("#capture created:2025-12-27..2026-01-03");
  });

  it("are offered until a collection has their name", () => {
    expect(missingExamples([{ name: "captured this WEEK" }]).map((e) => e.id)).not.toContain("captured-this-week");
    expect(missingExamples([]).map((e) => e.id)).toContain("captured-this-week");
  });
});
