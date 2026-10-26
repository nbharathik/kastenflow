import { describe, expect, it } from "vitest";

import type { TagView } from "../../../../lib/vault/types";
import { ROW_HEIGHT } from "./context";
import { displayClasses, frozenOf, rowHeightOf } from "./display";

const view = (more: Partial<TagView> = {}): TagView => ({ name: "V", type: "table", ...more });

describe("display settings", () => {
  it("default to the usual row with the title frozen", () => {
    expect(rowHeightOf(view())).toBe(ROW_HEIGHT);
    expect(frozenOf(view())).toBe(true);
    expect(displayClasses(view())).toBe("");
  });

  it("make rows shorter when compact and two lines tall when wrapped", () => {
    expect(rowHeightOf(view({ density: "compact" }))).toBeLessThan(ROW_HEIGHT);
    expect(rowHeightOf(view({ wrap: true }))).toBeGreaterThan(ROW_HEIGHT);
    expect(rowHeightOf(view({ wrap: true, density: "compact" }))).toBeLessThan(rowHeightOf(view({ wrap: true })));
  });

  it("name the classes the stylesheet uses; a stray value is ignored", () => {
    expect(displayClasses(view({ density: "compact", wrap: true, freeze_title: false }))).toBe(" is-compact is-wrap is-loose");
    expect(displayClasses({ name: "V", type: "table", density: "huge", wrap: "yes" } as unknown as TagView)).toBe("");
  });
});
