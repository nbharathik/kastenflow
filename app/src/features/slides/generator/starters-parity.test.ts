// The editor's starting points and the starter library of the dev vault are the same seven programs, written twice (the editor has
// its own so Insert works with no library; the vault has them as files a person can read and copy). This keeps the two from drifting.

import { CODE_PICTURE_STARTERS } from "@kasten-slides/react";
import { describe, expect, it } from "vitest";

const files = import.meta.glob("../../../../../fixtures/dev-vault/templates/generators/*.generator", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

interface Entry {
  format: string;
  formatVersion: number;
  id: string;
  label: string;
  generator: { language: string; code: string; inputs: { name: string; kind: string; value: string }[]; output: string };
}

const entries = Object.values(files).map((text) => JSON.parse(text) as Entry);

describe("the starter library of the dev vault", () => {
  it("holds a file for each starting point of the editor, with the same program", () => {
    expect(entries.length).toBeGreaterThanOrEqual(CODE_PICTURE_STARTERS.length);
    for (const starter of CODE_PICTURE_STARTERS) {
      const entry = entries.find((e) => e.label === starter.label);
      expect(entry, `${starter.label} is not in the starter library`).toBeDefined();
      expect(entry!.format).toBe("kasten-generator");
      expect(entry!.formatVersion).toBe(1);
      expect(entry!.generator, starter.label).toEqual(starter.program);
    }
  });

  it("gives each file an id of its own", () => {
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{1,80}$/);
  });
});
