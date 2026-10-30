import { describe, expect, it } from "vitest";

import { fakeClock } from "../../../demo/fake-clock";
import type { BuildEvent } from "../types";
import { BUILD_MS, LatexDemo } from "./backend";
import { literal, makePdf } from "./pdf";
import { DEMO_FOLDER, DEMO_MAIN, DEMO_SOURCE } from "./source";
import { plainMath, typeset } from "./typeset";

const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);
const linesOf = (pages: ReturnType<typeof typeset>) => pages.flat().map((l) => l.text);

describe("the demo's PDF", () => {
  it("is a valid file: header, objects where the table says, trailer", () => {
    const pdf = text(makePdf([[{ text: "Hello (world)", face: "roman", size: 12, x: 72, y: 700 }]]));
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    const table = pdf.slice(pdf.indexOf("xref"));
    const offsets = [...table.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(Number(/\/Size (\d+)/.exec(pdf)![1]) - 1);
    offsets.forEach((offset, i) => expect(pdf.slice(offset, offset + 8)).toBe(`${i + 1} 0 obj\n`));
    expect(pdf).toContain("(Hello \\(world\\))");
  });

  it("writes marks the fonts lack as plain ones, and Latin-1 as codes", () => {
    expect(literal("a — b “c”")).toBe('(a - b "c")');
    expect(literal("±")).toBe("(\\261)");
    expect(literal("∑")).toBe("(?)");
  });

  it("makes a blank page when there is nothing", () => {
    expect(/\/Count 1\b/.test(text(makePdf([])))).toBe(true);
  });
});

describe("the demo's typesetting", () => {
  it("reads the title, sections, equations and lists of the demo document", () => {
    const lines = linesOf(typeset(DEMO_SOURCE));
    expect(lines).toContain("Notes on a Derivation");
    expect(lines).toContain("Maya Chen");
    expect(lines).toContain("1   The equation");
    expect(lines).toContain("2   The solution");
    expect(lines.some((l) => l.includes("x = (-b ± sqrt(b² - 4ac))/2a"))).toBe(true);
    expect(lines).toContain("(1)");
    expect(lines).toContain("(3)");
    expect(lines.filter((l) => l.startsWith("•"))).toHaveLength(3);
  });

  it("shows maths as plain text", () => {
    expect(plainMath("a x^2 + b x + c = 0, \\qquad a \\neq 0")).toBe("a x² + b x + c = 0, a != 0");
    expect(plainMath("\\left(x + \\frac{b}{2a}\\right)^2")).toBe("(x + b/2a)²");
    expect(plainMath("\\frac{b^2 - 4ac}{4a^2}")).toBe("(b² - 4ac)/(4a²)");
  });

  it("changes with the source, and survives a half-typed one", () => {
    const edited = DEMO_SOURCE.replace("The equation", "A different heading");
    expect(linesOf(typeset(edited))).toContain("1   A different heading");
    expect(() => typeset("\\begin{document}\n\\section{Open\n\\begin{equation}\n\\frac{1")).not.toThrow();
  });

  it("starts a new page when one is full", () => {
    const long = `\\begin{document}\n${Array.from({ length: 80 }, (_, i) => `Paragraph ${i} of some words that fill a line.\n`).join("\n")}\\end{document}`;
    expect(typeset(long).length).toBeGreaterThan(1);
  });
});

describe("the demo's LaTeX build", () => {
  function make() {
    const clock = fakeClock();
    const backend = new LatexDemo(clock);
    const events: BuildEvent[] = [];
    return { clock, backend, events, listen: () => backend.onBuild((e) => events.push(e)) };
  }

  it("has one document, already built, that opens with its source", async () => {
    const { backend } = make();
    const [doc] = await backend.docs();
    expect(doc).toMatchObject({ folder: DEMO_FOLDER, mainPath: DEMO_MAIN, title: "Notes on a derivation" });
    expect((await backend.source(DEMO_MAIN)).text).toBe(DEMO_SOURCE);
    expect(text(await backend.readPdf(DEMO_FOLDER)).startsWith("%PDF")).toBe(true);
    expect((await backend.engines(DEMO_FOLDER)).error).toBeNull();
  });

  it("builds in about 0.6 s, telling queued, running and done, and the PDF follows the source", async () => {
    const { backend, clock, events, listen } = make();
    await listen();
    const before = text(await backend.readPdf(DEMO_FOLDER));
    const seq = await backend.build({ folder: DEMO_FOLDER, buffers: [{ path: DEMO_MAIN, text: DEMO_SOURCE.replace("The equation", "Typed just now") }] });
    expect(events.map((e) => e.state)).toEqual(["queued"]);
    clock.advance(BUILD_MS - 1);
    expect(events.map((e) => e.state)).toEqual(["queued", "running"]);
    expect(text(await backend.readPdf(DEMO_FOLDER))).toBe(before);
    clock.advance(1);
    expect(events.map((e) => e.state)).toEqual(["queued", "running", "done"]);
    expect(events.at(-1)).toMatchObject({ seq, pdf: true, ms: BUILD_MS, doc: DEMO_FOLDER });
    const after = text(await backend.readPdf(DEMO_FOLDER));
    expect(after).not.toBe(before);
    expect(after).toContain("Typed just now");
    expect(BUILD_MS).toBe(600);
  });

  it("lets a newer build take over from one still running", async () => {
    const { backend, clock, events, listen } = make();
    await listen();
    await backend.build({ folder: DEMO_FOLDER, buffers: [] });
    clock.advance(300);
    const second = await backend.build({ folder: DEMO_FOLDER, buffers: [] });
    clock.advance(BUILD_MS);
    const done = events.filter((e) => e.state === "done");
    expect(done).toHaveLength(1);
    expect(done[0]!.seq).toBe(second);
    expect(backend.built).toBe(1);
  });

  it("saves what is typed and answers as the app does", async () => {
    const { backend } = make();
    const saved = await backend.saveSource(DEMO_MAIN, "h", "\\begin{document}Hi\\end{document}");
    expect(saved.status).toBe("written");
    expect((await backend.saveSource(DEMO_MAIN, "h", "\\begin{document}Hi\\end{document}")).status).toBe("unchanged");
    const made = await backend.create("My notes");
    expect(made.folder).toBe("latex/my-notes");
    expect((await backend.docs()).map((d) => d.title)).toEqual(["Notes on a derivation", "My notes"]);
    backend.reset();
    expect((await backend.docs()).map((d) => d.title)).toEqual(["Notes on a derivation"]);
  });
});
