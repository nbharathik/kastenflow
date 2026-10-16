import { describe, expect, it } from "vitest";

import { citationGroups } from "./scan";
import { groupLabel } from "./label";

const WORKS: Record<string, { who: string; year: string }> = {
  vaswani2017: { who: "Vaswani et al.", year: "2017" },
  devlin2019: { who: "Devlin and Chang", year: "2019" },
  noyear: { who: "Smith", year: "" },
};
const name = (key: string) => WORKS[key] ?? null;

/** The label of the first group in `text`. */
function label(text: string): string {
  const group = citationGroups(text)[0]!;
  const source = text.slice(group.from, group.to);
  return groupLabel(
    source,
    group.items.map((i) => ({ key: i.key, at: i.at - group.from, keyTo: i.keyTo - group.from, suppress: i.suppress })),
    name,
  );
}

describe("the words on a citation chip", () => {
  it("names the work by its authors and year, in brackets", () => {
    expect(label("[@vaswani2017]")).toBe("(Vaswani et al., 2017)");
    expect(label("[@noyear]")).toBe("(Smith)");
  });

  it("keeps the words around the keys: a lead-in, a locator, the separators", () => {
    expect(label("[see @vaswani2017, p. 4; @devlin2019, ch. 2]")).toBe("(see Vaswani et al., 2017, p. 4; Devlin and Chang, 2019, ch. 2)");
  });

  it("leaves the author out of a suppressed citation", () => {
    expect(label("[-@vaswani2017]")).toBe("(2017)");
    expect(label("[-@noyear]")).toBe("(Smith)");
  });

  it("shows a key that names no reference as it is written", () => {
    expect(label("[@nobody2000]")).toBe("(nobody2000)");
    expect(label("[@vaswani2017; @nobody2000]")).toBe("(Vaswani et al., 2017; nobody2000)");
  });
});
