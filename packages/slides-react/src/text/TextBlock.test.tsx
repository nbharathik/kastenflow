import type { Paragraph, Run, Text, Theme } from "@kasten-slides/wasm";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

import { fontStack } from "../theme/index.ts";
import { TextBlock, type TextBlockProps } from "./TextBlock.tsx";
import { themeNamed } from "./test-support.ts";

let light: Theme;
let dark: Theme;

beforeAll(async () => {
  light = await themeNamed("Light");
  dark = await themeNamed("Dark");
});

const p = (...runs: Run[]): Paragraph => ({ runs });
const text = (...paragraphs: Paragraph[]): Text => ({ paragraphs });

function draw(t: Text, props: Partial<TextBlockProps> = {}, theme: Theme = light): HTMLElement {
  const holder = document.createElement("div");
  holder.innerHTML = renderToStaticMarkup(<TextBlock theme={theme} text={t} baseStyle="body" width={600} height={300} {...props} />);
  return holder.firstElementChild as HTMLElement;
}

const style = (element: Element, property: string): string => (element as HTMLElement).style.getPropertyValue(property);
const paragraphs = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(".ks-p")];

describe("the box", () => {
  it("fills its parent and stacks the paragraphs from the top", () => {
    const root = draw(text(p({ t: "Hi" })));
    expect(root.className).toBe("ks-text");
    expect(root.tagName).toBe("DIV");
    for (const [property, value] of Object.entries({
      position: "absolute",
      inset: "0px",
      width: "600px",
      height: "300px",
      "box-sizing": "border-box",
      display: "flex",
      "flex-direction": "column",
      "justify-content": "flex-start",
      padding: "4.8px 9.6px",
      overflow: "visible",
      "white-space": "pre-wrap",
      "word-break": "break-word",
    })) {
      expect(style(root, property), property).toBe(value);
    }
  });

  it("sits the text at the middle or the bottom", () => {
    expect(style(draw(text(p({ t: "Hi" })), { valign: "middle" }), "justify-content")).toBe("center");
    expect(style(draw(text(p({ t: "Hi" })), { valign: "bottom" }), "justify-content")).toBe("flex-end");
    expect(style(draw(text(p({ t: "Hi" })), { valign: "top" }), "justify-content")).toBe("flex-start");
  });

  it("lets the text's own valign and insets win over the props", () => {
    const own: Text = { ...text(p({ t: "Hi" })), valign: "bottom", insets: { left: 1, top: 2, right: 3, bottom: 4 } };
    const root = draw(own, { valign: "middle", insets: { left: 10, top: 20, right: 30, bottom: 40 } });
    expect(style(root, "justify-content")).toBe("flex-end");
    expect(style(root, "padding")).toBe("2px 3px 4px 1px");
    const given = draw(text(p({ t: "Hi" })), { insets: { left: 10, top: 20, right: 30, bottom: 40 } });
    expect(style(given, "padding")).toBe("20px 30px 40px 10px");
  });

  it("adds a class of the caller's", () => {
    expect(draw(text(p({ t: "Hi" })), { className: "mine" }).className).toBe("ks-text mine");
  });

  it("draws the same markup for the same props, and leaves the text alone", () => {
    const t = text({ runs: [{ t: "a", b: true }], list: "bullet" });
    const before = JSON.stringify(t);
    const props = { theme: light, text: t, baseStyle: "body", width: 600, height: 300 };
    expect(renderToStaticMarkup(<TextBlock {...props} />)).toBe(renderToStaticMarkup(<TextBlock {...props} />));
    expect(JSON.stringify(t)).toBe(before);
  });
});

describe("paragraphs and runs", () => {
  it("makes a div for each paragraph, in order, with its runs' words", () => {
    const root = draw(text(p({ t: "One" }, { t: " and two" }), p({ t: "Three" }), p({ t: "" })));
    const ps = paragraphs(root);
    expect(ps.map((element) => element.textContent)).toEqual(["One and two", "Three", ""]);
    expect(ps.every((element) => element.parentElement === root)).toBe(true);
  });

  it("gives each paragraph its look from the theme", () => {
    const [first, second] = paragraphs(draw(text({ runs: [{ t: "a" }], align: "center", lineSpacing: 1.5, spaceBefore: 6 }, p({ t: "b" }))));
    expect(style(first!, "text-align")).toBe("center");
    expect(style(first!, "line-height")).toBe("1.5");
    expect(style(first!, "margin-top")).toBe("8px");
    expect(style(first!, "font-size")).toBe("29.333px");
    expect(style(first!, "font-family")).toBe(fontStack(light, "body"));
    expect(style(second!, "margin-bottom")).toBe("8px");
    expect(style(first!, "color")).toBe("rgb(32, 33, 36)");
    expect(style(paragraphs(draw(text(p({ t: "a" })), {}, dark))[0]!, "color")).toBe("rgb(241, 243, 244)");
  });

  it("sets the text in the box's style", () => {
    const [title] = paragraphs(draw(text(p({ t: "Title" })), { baseStyle: "title" }));
    expect(style(title!, "font-size")).toBe("48px");
    expect(style(title!, "font-weight")).toBe("700");
    expect(style(title!, "line-height")).toBe("1");
  });

  it("draws a run with no settings as a span with nothing on it", () => {
    const [first] = paragraphs(draw(text(p({ t: "plain" }, { t: " more" }))));
    expect([...first!.children].map((child) => [child.tagName, child.attributes.length, child.textContent])).toEqual([["SPAN", 0, "plain"], ["SPAN", 0, " more"]]);
  });

  it("wraps a run in an element for each thing it sets, outermost first", () => {
    const [first] = paragraphs(draw(text(p({ t: "x", u: true, b: true, size: 16, color: "accent2", font: "Georgia", i: true }))));
    const chain: string[] = [];
    let element: Element | null = first!.firstElementChild;
    while (element) {
      chain.push(element.getAttribute("style") ?? "");
      element = element.firstElementChild;
    }
    expect(chain.map((declarations) => declarations.split(":")[0])).toEqual(["font-size", "font-family", "font-weight", "font-style", "color", "text-decoration"]);
    expect(first!.textContent).toBe("x");
    expect(first!.querySelector<HTMLElement>("[style*='font-size']")!.style.fontSize).toBe("21.333px");
    expect(first!.querySelector<HTMLElement>("[style*='color']")!.style.color).toBe("rgb(234, 67, 53)");
    expect(first!.querySelector<HTMLElement>("[style*='font-family']")!.style.fontFamily).toContain("Georgia");
  });

  it("draws code in the code font on a faint ground", () => {
    const [first] = paragraphs(draw(text(p({ t: "x", code: true }))));
    const code = first!.querySelector<HTMLElement>(".ks-text-code")!;
    expect(code.style.fontFamily).toBe(fontStack(light, "code"));
    expect(code.style.background).toBe("rgba(32, 33, 36, 0.08)");
  });

  it("draws math as italic text", () => {
    const [first] = paragraphs(draw(text(p({ t: "\\frac{a}{b}", math: true }))));
    expect(first!.querySelector<HTMLElement>(".ks-text-math")!.style.fontStyle).toBe("italic");
    expect(first!.textContent).toBe("\\frac{a}{b}");
  });

  it("draws a link as an element with its address in data-href and none to follow", () => {
    const [first] = paragraphs(draw(text(p({ t: "see " }, { t: "this", link: "https://example.com", color: "accent2" }))));
    const link = first!.querySelector<HTMLElement>("a")!;
    expect(link.textContent).toBe("this");
    expect(link.getAttribute("data-href")).toBe("https://example.com");
    expect(link.hasAttribute("href")).toBe(false);
    expect(link.className).toBe("ks-text-link");
    expect(link.style.color).toBe("rgb(26, 115, 232)");
    expect(link.style.textDecoration).toBe("underline");
  });

  it("does not follow an address the format does not allow: it is still only data", () => {
    const html = renderToStaticMarkup(<TextBlock theme={light} text={text(p({ t: "x", link: 'javascript:alert("x")' }))} baseStyle="body" width={100} height={100} />);
    expect(html).not.toMatch(/ href=/);
  });

  it("keeps line breaks in the words and gives an empty last line room", () => {
    const root = draw(text(p({ t: "a\nb" }), p({ t: "c\n" }), p({ t: "" }), { runs: [], list: undefined }, p({ t: "d" })));
    const ps = paragraphs(root);
    expect(ps.map((element) => element.textContent)).toEqual(["a\nb", "c\n", "", "", "d"]);
    expect(ps.map((element) => element.querySelector("br") !== null)).toEqual([false, true, true, true, false]);
  });

  it("does not mistake the html in a run for markup", () => {
    const root = draw(text(p({ t: "<b>&amp;</b>" })));
    expect(paragraphs(root)[0]!.textContent).toBe("<b>&amp;</b>");
    expect(root.querySelector("b")).toBeNull();
  });
});

describe("lists", () => {
  it("hangs a marker to the left of the text of each item", () => {
    const root = draw(text({ runs: [{ t: "a" }], list: "bullet" }, { runs: [{ t: "b" }], list: "bullet", level: 1 }, { runs: [{ t: "c" }], list: "bullet", level: 2 }, { runs: [{ t: "d" }], list: "bullet", level: 3 }));
    const ps = paragraphs(root);
    expect(ps.map((element) => element.querySelector(".ks-marker")?.textContent)).toEqual(["●", "○", "■", "●"]);
    // Each level hangs its marker in the room the markers of that level need (30 at 22 pt) and sits under the words of the one above.
    expect(ps.map((element) => style(element, "padding-left"))).toEqual(["30px", "60px", "90px", "120px"]);
    expect(ps.every((element) => style(element, "text-indent") === "-30px")).toBe(true);
    const marker = ps[0]!.firstElementChild as HTMLElement;
    expect(marker.className).toBe("ks-marker");
    expect(marker.tagName).toBe("SPAN");
    expect(marker.getAttribute("aria-hidden")).toBe("true");
    expect(ps[0]!.textContent).toBe("●a");
  });

  it("numbers items by their run, with letters and Roman numerals for deeper levels", () => {
    const item = (t: string, level?: number): Paragraph => ({ runs: [{ t }], list: "number", ...(level === undefined ? {} : { level }) });
    const root = draw(text(item("a"), item("b", 1), item("c", 1), item("d", 2), item("e"), p({ t: "plain" }), item("f")));
    expect(paragraphs(root).map((element) => element.querySelector(".ks-marker")?.textContent ?? null)).toEqual(["1.", "a.", "b.", "i.", "2.", null, "1."]);
  });

  it("gives a marker the look of the first run", () => {
    const [first] = paragraphs(draw(text({ runs: [{ t: "big", size: 32, color: "accent2", b: true }], list: "bullet" })));
    expect(style(first!, "--ks-marker-size")).toBe("42.667px");
    expect(style(first!, "--ks-marker-color")).toBe("#ea4335");
    expect(style(first!, "--ks-marker-weight")).toBe("700");
    // A bullet at 32 pt needs 41 units and its air, which is 42 in steps of 6.
    expect(style(first!, "--ks-indent")).toBe("42px");
  });

  it("shows an empty list item's marker, and a line for it", () => {
    const [first] = paragraphs(draw(text({ runs: [{ t: "" }], list: "bullet" })));
    expect(first!.querySelector(".ks-marker")?.textContent).toBe("●");
    expect(first!.querySelector("br")).not.toBeNull();
  });

  it("draws an empty item's marker and line as the words of the item above are drawn, when its mark says the same", () => {
    const [words, empty] = paragraphs(draw(text({ runs: [{ t: "How are you", size: 12, color: "accent2" }], list: "bullet" }, { runs: [{ t: "", size: 12, color: "accent2" }], list: "bullet" })));
    for (const property of ["font-size", "--ks-marker-size", "--ks-marker-color"]) expect(style(empty!, property), property).toBe(style(words!, property));
    expect(style(empty!, "font-size")).toBe("16px");
    // With no mark it is the text style's size, as before.
    const [plain] = paragraphs(draw(text({ runs: [{ t: "" }], list: "bullet" })));
    expect(style(plain!, "font-size")).toBe("29.333px");
  });

  it("scales the marker by its own share of the size of its items words, empty or not", () => {
    const sized = (t: string): Paragraph => ({ runs: [{ t, size: 12 }], list: "bullet", bulletSize: 2 });
    const [words, empty] = paragraphs(draw(text(sized("a"), sized(""))));
    expect(style(words!, "--ks-marker-size")).toBe("32px");
    expect(style(empty!, "--ks-marker-size")).toBe("32px");
  });
});

describe("fields", () => {
  const fieldText = text(p({ t: "Slide " }, { t: "1", field: "slideNumber", b: true }, { t: " of " }, { t: "9", field: "slideCount" }, { t: " / ", field: "other" }, { t: "Step 1", field: "stepLabel" }));

  it("shows the value of a field that is given", () => {
    const root = draw(fieldText, { fields: { slideNumber: 4, slideCount: 12, stepLabel: "Step 2 / 5" } });
    expect(paragraphs(root)[0]!.textContent).toBe("Slide 4 of 12 / Step 2 / 5");
    expect(root.querySelector("[data-field='slideNumber']")!.closest<HTMLElement>("[style*='font-weight']")!.style.fontWeight).toBe("700");
  });

  it("shows a field's sample when its value is not given, and for a field it does not know", () => {
    expect(paragraphs(draw(fieldText, { fields: { slideNumber: 4 } }))[0]!.textContent).toBe("Slide 4 of 9 / Step 1");
    expect(paragraphs(draw(fieldText))[0]!.textContent).toBe("Slide 1 of 9 / Step 1");
    expect(paragraphs(draw(fieldText, { fields: { slideNumber: 0 } }))[0]!.textContent).toBe("Slide 0 of 9 / Step 1");
  });
});

describe("steps", () => {
  const steps = text({ runs: [{ t: "always" }] }, { runs: [{ t: "one" }], step: 1 }, { runs: [{ t: "two" }], step: 2 }, { runs: [{ t: "zero" }], step: 0 });

  it("hides the paragraphs of later steps and keeps their place", () => {
    const visibility = (step: number | undefined) => paragraphs(draw(steps, { step })).map((element) => style(element, "visibility") || "visible");
    expect(visibility(1)).toEqual(["visible", "visible", "hidden", "visible"]);
    expect(visibility(0)).toEqual(["visible", "hidden", "hidden", "visible"]);
    expect(visibility(2)).toEqual(["visible", "visible", "visible", "visible"]);
    expect(visibility(undefined)).toEqual(["visible", "visible", "visible", "visible"]);
    expect(paragraphs(draw(steps, { step: 0 }))).toHaveLength(4);
  });
});

describe("the empty prompt", () => {
  it("is shown dimmed when every run is empty", () => {
    const root = draw(text({ runs: [{ t: "" }], align: "center" }), { emptyPrompt: "Click to add title" });
    const shown = paragraphs(root);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.textContent).toBe("Click to add title");
    expect(style(shown[0]!, "opacity")).toBe("0.5");
    expect(style(shown[0]!, "color")).toBe("rgb(95, 99, 104)");
    expect(style(shown[0]!, "text-align")).toBe("center");
  });

  it("has no marker, though the empty placeholder is a list", () => {
    const shown = paragraphs(draw(text({ runs: [{ t: "" }], list: "bullet" }), { emptyPrompt: "Click to add text" }));
    expect(shown[0]!.querySelector(".ks-marker")).toBeNull();
    expect(shown[0]!.textContent).toBe("Click to add text");
  });

  it("is shown for a text with no paragraphs at all", () => {
    expect(paragraphs(draw({ paragraphs: [] }, { emptyPrompt: "Empty" }))[0]!.textContent).toBe("Empty");
  });

  it("gives way to words, and to a field", () => {
    expect(paragraphs(draw(text(p({ t: "Words" })), { emptyPrompt: "Click" }))[0]!.textContent).toBe("Words");
    expect(paragraphs(draw(text(p({ t: "", field: "slideNumber" })), { emptyPrompt: "Click", fields: { slideNumber: 3 } }))[0]!.textContent).toBe("3");
  });

  it("is not shown without one, or with an empty one", () => {
    expect(paragraphs(draw(text(p({ t: "" })), {}))[0]!.textContent).toBe("");
    expect(paragraphs(draw(text(p({ t: "" })), { emptyPrompt: "" }))[0]!.textContent).toBe("");
  });

  it("is dimmed by the theme's text2 colour", () => {
    const shown = paragraphs(draw(text(p({ t: "" })), { emptyPrompt: "Click" }, dark));
    expect(style(shown[0]!, "color")).toBe("rgb(154, 160, 166)");
  });
});
