import { describe, expect, it } from "vitest";

import { COMMON_FONTS, familyOf, fontGroups, isRole } from "./fonts.ts";

const fonts = { heading: { family: "Inter" }, body: { family: "Inter" }, code: { family: "Roboto Mono" } };
const groups = (query: string, current = "body", recents: string[] = []) => fontGroups({ query, current, recents, fonts });
const names = (query: string, current = "body", recents: string[] = []) => groups(query, current, recents).map((g) => `${g.title}: ${g.options.map((o) => o.label).join(", ")}`);

describe("the font list", () => {
  it("shows the theme's fonts, then the common ones, with the one in use checked", () => {
    const [theme, common] = groups("");
    expect(theme?.title).toBe("Theme fonts");
    expect(theme?.options.map((o) => o.label)).toEqual(["Heading font", "Body font", "Code font"]);
    expect(theme?.options.map((o) => o.hint)).toEqual(["Inter", "Inter", "Roboto Mono"]);
    expect(theme?.options.filter((o) => o.checked).map((o) => o.value)).toEqual(["body"]);
    expect(common?.options.map((o) => o.label)).toEqual(COMMON_FONTS);
  });

  it("checks a family by name, whatever its case, and no theme font then", () => {
    const [theme, common] = groups("", "georgia");
    expect(theme?.options.some((o) => o.checked)).toBe(false);
    expect(common?.options.filter((o) => o.checked).map((o) => o.label)).toEqual(["Georgia"]);
  });

  it("checks nothing for words that disagree", () => {
    expect(groups("", "mixed").flatMap((g) => g.options).some((o) => o.checked)).toBe(false);
  });

  it("puts the fonts used lately first, without a theme role among them, and only until something is typed", () => {
    const [recent] = groups("", "body", ["Georgia", "heading", "Lato"]);
    expect(recent?.title).toBe("Recent");
    expect(recent?.options.map((o) => o.label)).toEqual(["Georgia", "Lato"]);
    expect(groups("geo", "body", ["Georgia"]).some((g) => g.title === "Recent")).toBe(false);
  });

  it("narrows to the names that hold what is typed, in any case", () => {
    // What is typed can always be used as a name of its own, unless it is already on the list.
    expect(names("MONO")).toEqual(["Theme fonts: Code font", "Fonts: Roboto Mono", ": Use “MONO”"]);
    expect(names("georgia")).toEqual(["Fonts: Georgia"]);
  });

  it("finds a theme font by the family it stands for", () => {
    expect(names("roboto mono")[0]).toBe("Theme fonts: Code font");
  });

  it("offers a name that is not on the list as it was typed, last", () => {
    const found = groups("Comic Sans MS");
    expect(found.at(-1)?.options).toEqual([{ id: "custom", label: "Use “Comic Sans MS”", value: "Comic Sans MS", family: "Comic Sans MS", checked: false }]);
    expect(groups("Georgia").some((g) => g.options.some((o) => o.id === "custom"))).toBe(false);
  });

  it("offers nothing to use for nothing typed", () => {
    expect(groups("").some((g) => g.options.some((o) => o.id === "custom"))).toBe(false);
  });
});

describe("naming a font", () => {
  it("spells a theme role out as the family the theme gives it", () => {
    expect(familyOf("code", fonts)).toBe("Roboto Mono");
    expect(familyOf("Georgia", fonts)).toBe("Georgia");
    expect(isRole("heading")).toBe(true);
    expect(isRole("Heading")).toBe(false);
  });
});
