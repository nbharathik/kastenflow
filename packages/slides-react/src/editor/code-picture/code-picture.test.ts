// Code pictures in the editor: the program is kept inside the picture, a run swaps the picture in one step of undo, code an
// agent wrote waits for "Allow to run", and Run all swaps every picture that came out different as one step.

import { describe, expect, it, vi } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { type CommandContext, COMMANDS, isEnabled, runCommand } from "../commands/index.ts";
import { insertItems } from "../insert/model.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { EditorUi } from "../ui-state.ts";
import { FORMAT, libraryText, newId, parseLibraryText } from "./library-file.ts";
import { asGenerator, codePictures, fileNameFor, fnv, generatorOf, inputsHash, problemOf, refit, runHash, selectedCodePicture, themeOf } from "./model.ts";
import { insertCodePicture, runAll, runAllWords, runPicture } from "./run.ts";
import { STARTERS } from "./starters.ts";
import { targetOf } from "./target.ts";
import type { GeneratorLibraryHost, GeneratorRequest, GeneratorResult, GeneratorTrust, Program } from "./types.ts";

type Ran = Extract<GeneratorResult, { ok: true }>;

const AT = 1_762_000_000_000;

function drawn(width = 200, height = 100, extra: Partial<Ran> = {}): Ran {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}"/></svg>`;
  return { ok: true, kind: "svg", bytes: new TextEncoder().encode(svg), width, height, inputs: [{ name: "sales", text: "a,b\n1,2\n" }], warnings: [], logs: [], at: AT, ...extra };
}

const program = (code: string, extra: Partial<Program> = {}): Program => ({ language: "js", code, inputs: [], output: "svg", ...extra });

interface Options {
  run?: (request: GeneratorRequest) => Promise<GeneratorResult>;
  trust?: GeneratorTrust;
  library?: GeneratorLibraryHost;
  without?: boolean;
}

async function open({ run, trust, library, without = false }: Options = {}) {
  const host = new MemoryHost();
  const requests: GeneratorRequest[] = [];
  if (!without) {
    Object.assign(host, {
      runGenerator: async (request: GeneratorRequest) => {
        requests.push(request);
        return run ? run(request) : drawn();
      },
      ...(trust ? { generatorTrust: trust } : {}),
      ...(library ? { generatorLibrary: library } : {}),
    });
  }
  const session = new EditorSession(await newDeck("Talk"), host, { saveDelay: 60_000 });
  const context: CommandContext = { session, ui: new EditorUi() };
  return { host, session, context, requests };
}

const idOf = (made: { id: string } | { error: unknown }): string => {
  if (!("id" in made)) throw new Error("the picture was not put on the slide");
  return made.id;
};

const imageOf = (session: EditorSession, id: string) => {
  const found = session.elements.find([id])[0];
  if (found?.type !== "image") throw new Error("not a picture");
  return found;
};

describe("the program of a picture", () => {
  it("is read from the generator field of an image, with defaults for what is left out", () => {
    expect(asGenerator({ code: "return 1" })).toEqual({ language: "js", code: "return 1", inputs: [], output: "svg" });
    const whole = asGenerator({ language: "js", code: "x", inputs: [{ name: "a", kind: "asset", value: "assets/a.csv" }, { name: 1 }, "no"], output: "png", lastRun: { hash: "h", at: 5 }, madeBy: "agent:x", "x-future": 1 });
    expect(whole).toEqual({ language: "js", code: "x", inputs: [{ name: "a", kind: "asset", value: "assets/a.csv" }], output: "png", lastRun: { hash: "h", at: 5 }, madeBy: "agent:x" });
    for (const not of [null, "code", 4, [], {}, { code: 4 }]) expect(asGenerator(not), String(not)).toBeUndefined();
    expect(generatorOf(undefined)).toBeUndefined();
  });

  it("is checked before it is run", () => {
    expect(problemOf(program("return 1"))).toBeUndefined();
    expect(problemOf(program("   "))).toMatch(/empty/);
    expect(problemOf(program("x", { language: "python" }))).toMatch(/JavaScript/);
    expect(problemOf(program("x".repeat(128 * 1024 + 1)))).toMatch(/longer/);
    const named = (name: string) => program("x", { inputs: [{ name, kind: "data", value: "" }] });
    expect(problemOf(named("sales"))).toBeUndefined();
    for (const bad of ["", "1a", "a b", "a-b", "n".repeat(41)]) expect(problemOf(named(bad)), bad).toMatch(/cannot name/);
    const twice = program("x", { inputs: [{ name: "a", kind: "data", value: "" }, { name: "a", kind: "data", value: "" }] });
    expect(problemOf(twice)).toMatch(/Two inputs/);
  });

  it("gives the same hashes the agent tools do, and a new box only when the proportions change", () => {
    // The standard test vectors of FNV-1a over 64 bits; slides-core's `hash_of` is the same function.
    expect(fnv("")).toBe("cbf29ce484222325");
    expect(fnv("a")).toBe("af63dc4c8601ec8c");
    const theme = { accent1: "#2563eb", bg1: "#ffffff" };
    expect(inputsHash([{ name: "a", text: "1" }], theme)).toBe(inputsHash([{ name: "a", text: "1" }], { bg1: "#ffffff", accent1: "#2563eb" }));
    expect(inputsHash([{ name: "a", text: "1" }], theme)).not.toBe(inputsHash([{ name: "a", text: "2" }], theme));
    expect(inputsHash([{ name: "a", text: "1" }], theme)).not.toBe(inputsHash([{ name: "a", text: "1" }], { accent1: "#000000" }));
    const run = runHash("code", "in", "svg");
    expect(run).toBe(fnv("code\u0000in\u0000svg"));
    expect(run).toHaveLength(16);
    expect(run).not.toBe(runHash("code", "in", "png"));
    expect(run).not.toBe(runHash("code2", "in", "svg"));
    expect(fileNameFor(run, "svg")).toBe(`code-${run.slice(0, 8)}.svg`);

    const box = { x: 100, y: 250, w: 400, h: 200 };
    expect(refit(box, 800, 400)).toBeNull();
    expect(refit(box, 100, 100)).toEqual({ x: 200, y: 250, w: 200, h: 200 });
    expect(refit(box, 100, 400)).toEqual({ x: 275, y: 250, w: 50, h: 200 });
    expect(refit({ ...box, w: 0 }, 100, 100)).toBeNull();
  });

  it("takes the deck's colours as hex, for the drawing kit", async () => {
    const { session } = await open();
    const theme = themeOf(session.deck);
    expect(Object.keys(theme)).toEqual(expect.arrayContaining(["text1", "bg1", "accent1", "accent6"]));
    for (const colour of Object.values(theme)) expect(colour).toMatch(/^#[0-9a-f]{3,8}$/i);
  });
});

describe("a new code picture", () => {
  it("is run first, then put on the slide holding its program, in one step of undo", async () => {
    const { session, requests } = await open();
    const starter = STARTERS[0]!.program;
    const id = idOf(await insertCodePicture(session, starter, "Sales"));
    const image = imageOf(session, id);
    expect(image.src).toMatch(/^assets\/code-[0-9a-f]{8}\.svg$/);
    expect(image.alt).toBe("Sales");
    const generator = generatorOf(image)!;
    expect(generator.code).toBe(starter.code);
    expect(generator.inputs).toEqual(starter.inputs);
    expect(generator.lastRun).toEqual({ hash: expect.stringMatching(/^[0-9a-f]{16}$/), at: AT });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ language: "js", code: starter.code, output: "svg" });
    expect(requests[0]!.theme["accent1"]).toMatch(/^#/);
    expect(session.state.selection).toEqual([id]);
    // One undo takes the picture and its program away together.
    session.core.undo();
    expect(codePictures(session.deck)).toEqual([]);
  });

  it("is not put on the slide when its code fails, and the person is told the line", async () => {
    const { session, host } = await open({ run: async () => ({ ok: false, error: { message: "ReferenceError: sales is not defined", line: 3, column: 9 } }) });
    const made = await insertCodePicture(session, program("return sales;"), "x");
    expect(made).toEqual({ error: { message: "ReferenceError: sales is not defined", line: 3, column: 9 } });
    expect(codePictures(session.deck)).toEqual([]);
    expect(await host.images()).toEqual([]);
    // A host that throws is an error of the code's too; a program that is not fit to run never reaches the host.
    const refusing = await open({ run: async () => Promise.reject(new Error("The sandbox is closed")) });
    expect(await insertCodePicture(refusing.session, program("x"), "x")).toEqual({ error: { message: "The sandbox is closed" } });
    const never = await open();
    expect(await insertCodePicture(never.session, program(""), "x")).toEqual({ error: { message: "The code is empty." } });
    expect(never.requests).toEqual([]);
  });
});

describe("running a code picture again", () => {
  it("swaps in the new picture, refits the box to its shape and undoes in one step", async () => {
    let call = 0;
    const { session } = await open({ run: async () => (++call === 1 ? drawn(200, 100) : drawn(100, 100, { inputs: [{ name: "sales", text: "changed" }] })) });
    const id = idOf(await insertCodePicture(session, program("A", { inputs: [{ name: "sales", kind: "data", value: "a" }] }), "x"));
    const before = imageOf(session, id);
    const report = await runPicture(session, session.state.slideId, id);
    expect(report).toMatchObject({ status: "done", unchanged: false });
    const after = imageOf(session, id);
    expect(after.src).not.toBe(before.src);
    expect(after.w).toBe(after.h);
    expect(generatorOf(after)!.lastRun!.hash).not.toBe(generatorOf(before)!.lastRun!.hash);
    expect(generatorOf(after)!.code).toBe("A");
    session.core.undo();
    expect(imageOf(session, id).src).toBe(before.src);
    expect(generatorOf(imageOf(session, id))!.lastRun!.hash).toBe(generatorOf(before)!.lastRun!.hash);
  });

  it("does nothing when the code and what it read have not changed", async () => {
    const { session } = await open();
    const id = idOf(await insertCodePicture(session, program("A"), "x"));
    const apply = vi.spyOn(session.core, "apply");
    const report = await runPicture(session, session.state.slideId, id);
    expect(report).toMatchObject({ status: "done", unchanged: true });
    expect(apply).not.toHaveBeenCalled();
  });

  it("takes the program the person edited in the panel, and the picture is theirs from then on", async () => {
    const { session, requests } = await open({ run: async (r) => drawn(200, 100, { inputs: [{ name: "x", text: r.code }] }) });
    const id = idOf(await insertCodePicture(session, program("A"), "x"));
    session.elements.patch({ generator: { madeBy: "agent:claude-code" } }, [id]);
    expect(generatorOf(imageOf(session, id))!.madeBy).toBe("agent:claude-code");
    const report = await runPicture(session, session.state.slideId, id, program("B", { output: "svg" }));
    expect(report.status).toBe("done");
    expect(requests.at(-1)!.code).toBe("B");
    const generator = generatorOf(imageOf(session, id))!;
    expect(generator.code).toBe("B");
    expect(generator.madeBy).toBeUndefined();
  });

  it("waits for Allow to run when an agent wrote the code, and runs once it is allowed", async () => {
    let allowed = false;
    const trust: GeneratorTrust = { allowed: vi.fn(async () => allowed), allow: vi.fn(async (_code: string) => void (allowed = true)) };
    const { session, requests } = await open({ trust, run: async (r) => drawn(200, 100, { inputs: [{ name: "x", text: r.code + requests.length }] }) });
    const id = idOf(await insertCodePicture(session, program("A"), "x"));
    session.elements.patch({ generator: { madeBy: "agent:claude-code" } }, [id]);
    const asked = requests.length;
    expect(await runPicture(session, session.state.slideId, id)).toEqual({ status: "needs-allow" });
    expect(requests).toHaveLength(asked);
    await trust.allow("A");
    expect(await runPicture(session, session.state.slideId, id)).toMatchObject({ status: "done" });
    expect(requests).toHaveLength(asked + 1);
  });

  it("asks the host about the picture's own code, so changed code waits again", async () => {
    const seen = new Set(["A"]);
    const trust: GeneratorTrust = { allowed: vi.fn(async (code: string) => seen.has(code)), allow: vi.fn(async (code: string) => void seen.add(code)) };
    const { session, requests } = await open({ trust, run: async () => drawn() });
    const id = idOf(await insertCodePicture(session, program("A"), "x"));
    session.elements.patch({ generator: { madeBy: "agent:claude-code" } }, [id]);
    expect(await runPicture(session, session.state.slideId, id)).toMatchObject({ status: "done" });
    expect(trust.allowed).toHaveBeenLastCalledWith("A");
    // The agent rewrites the code under the same picture: the allow for "A" does not cover it.
    session.elements.patch({ generator: { code: "B", madeBy: "agent:claude-code" } }, [id]);
    const ran = requests.length;
    expect(await runPicture(session, session.state.slideId, id)).toEqual({ status: "needs-allow" });
    expect(trust.allowed).toHaveBeenLastCalledWith("B");
    expect(requests).toHaveLength(ran);
  });

  it("reports what went wrong without touching the picture", async () => {
    let fail = false;
    const { session } = await open({ run: async () => (fail ? { ok: false, error: { message: "boom", line: 2 } } : drawn()) });
    const id = idOf(await insertCodePicture(session, program("A"), "x"));
    const was = imageOf(session, id).src;
    fail = true;
    expect(await runPicture(session, session.state.slideId, id)).toEqual({ status: "error", error: { message: "boom", line: 2 } });
    expect(imageOf(session, id).src).toBe(was);
    // A picture that has no program, a slide that is gone, and a host that cannot run code.
    expect(await runPicture(session, session.state.slideId, "nothing")).toMatchObject({ status: "unavailable" });
    const bare = await open({ without: true });
    expect(await runPicture(bare.session, bare.session.state.slideId, "x")).toMatchObject({ status: "unavailable", why: expect.stringContaining("cannot run code") });
  });
});

describe("Run all code pictures", () => {
  it("swaps every picture that came out different as one step, and counts the rest", async () => {
    const results: Record<string, GeneratorResult> = { A: drawn(), B: drawn(), C: drawn() };
    const trust: GeneratorTrust = { allowed: async () => false, allow: async () => {} };
    const { session } = await open({ trust, run: async (r) => results[r.code]! });
    const a = idOf(await insertCodePicture(session, program("A"), "a"));
    session.slides.add({ layout: "blank" });
    const b = idOf(await insertCodePicture(session, program("B"), "b"));
    const c = idOf(await insertCodePicture(session, program("C"), "c"));
    session.elements.patch({ generator: { madeBy: "agent:claude-code" } }, [c]);
    const first = imageOf(session, b).src;
    const slideA = codePictures(session.deck).find((f) => f.id === a)!.slideId;
    const was = session.deck.slides.find((s) => s.id === slideA)!.elements.find((e) => e.id === a)!;
    if (was.type !== "image") throw new Error("not a picture");

    // The data of the first changed; the second's code now fails; the third waits for the person.
    results["A"] = drawn(240, 120, { inputs: [{ name: "sales", text: "new rows" }] });
    results["B"] = { ok: false, error: { message: "boom", line: 4 } };
    const report = await runAll(session);
    expect(report).toEqual({ updated: 1, unchanged: 0, waiting: 1, failed: [{ slideId: session.state.slideId, id: b, error: { message: "boom", line: 4 } }] });
    expect(runAllWords(report)).toBe("Code pictures: 1 updated, 1 waiting for you to allow the code (Edit code, then Allow to run), 1 failed: boom (line 4).");
    expect(imageOf(session, b).src).toBe(first);
    const nowA = codePictures(session.deck).find((f) => f.id === a)!;
    const slide = session.deck.slides.find((s) => s.id === nowA.slideId)!;
    const imageA = slide.elements.find((e) => e.id === a)!;
    if (imageA.type !== "image") throw new Error("not a picture");
    expect(imageA.src).not.toBe(was.src);

    // One undo takes back everything the run changed.
    session.core.undo();
    const back = session.deck.slides.find((s) => s.id === slideA)!.elements.find((e) => e.id === a)!;
    if (back.type !== "image") throw new Error("not a picture");
    expect(back.src).toBe(was.src);
  });

  it("says plainly when there is nothing to run", () => {
    expect(runAllWords({ updated: 0, unchanged: 0, waiting: 0, failed: [] })).toBe("This deck has no code pictures.");
    expect(runAllWords({ updated: 0, unchanged: 3, waiting: 0, failed: [] })).toBe("Code pictures: 3 unchanged.");
  });
});

describe("the editor's commands for code pictures", () => {
  it("are offered only where the host runs code, and the ones for a picture only when there is one", async () => {
    const without = await open({ without: true });
    for (const id of ["insert.code-picture", "edit.code-picture", "deck.run-code-pictures"]) expect(isEnabled(COMMANDS.get(id)!, without.context), id).toBe(false);
    expect(insertItems(without.context, "media").map((i) => i.command)).not.toContain("insert.code-picture");

    const { session, context } = await open();
    expect(isEnabled(COMMANDS.get("insert.code-picture")!, context)).toBe(true);
    expect(insertItems(context, "media").map((i) => i.command)).toContain("insert.code-picture");
    expect(isEnabled(COMMANDS.get("edit.code-picture")!, context)).toBe(false);
    expect(isEnabled(COMMANDS.get("deck.run-code-pictures")!, context)).toBe(false);
    const id = idOf(await insertCodePicture(session, program("A"), "x"));
    expect(isEnabled(COMMANDS.get("edit.code-picture")!, context)).toBe(true);
    expect(isEnabled(COMMANDS.get("deck.run-code-pictures")!, context)).toBe(true);
    expect(selectedCodePicture(session.state)).toMatchObject({ id, slideId: session.state.slideId });
    session.select([]);
    expect(isEnabled(COMMANDS.get("edit.code-picture")!, context)).toBe(false);
  });

  it("open the panel for a new picture or for the selected one, and Run all says how it went", async () => {
    const { session, context, host } = await open();
    await runCommand("insert.code-picture", context);
    expect(context.ui.state.dialog).toBe("code-picture");
    expect(targetOf(context.ui)).toEqual({ kind: "new" });
    context.ui.openDialog(null);
    const id = idOf(await insertCodePicture(session, program("A"), "x"));
    await runCommand("edit.code-picture", context);
    expect(context.ui.state.dialog).toBe("code-picture");
    expect(targetOf(context.ui)).toEqual({ kind: "edit", slideId: session.state.slideId, id });
    await runCommand("deck.run-code-pictures", context);
    expect(host.notices.at(-1)).toBe("Code pictures: 1 unchanged.");
  });
});

describe("the starting points", () => {
  it("are seven runnable programs, each with the data it reads", () => {
    expect(STARTERS.map((s) => s.id)).toEqual(["bar-chart", "line-chart", "timeline", "matrix", "funnel", "org-chart", "icon-grid"]);
    expect(new Set(STARTERS.map((s) => s.label)).size).toBe(STARTERS.length);
    for (const starter of STARTERS) {
      expect(problemOf(starter.program), starter.id).toBeUndefined();
      expect(starter.program.inputs.length, starter.id).toBeGreaterThan(0);
      for (const input of starter.program.inputs) {
        expect(starter.program.code, starter.id).toContain(`inputs.${input.name}`);
        expect(input.value.split("\n").length, starter.id).toBeGreaterThan(2);
      }
      expect(starter.program.code, starter.id).toContain("return kit.svg(");
      expect(starter.program.code, starter.id).not.toMatch(/fetch\(|import\(|document\.|window\./);
    }
  });
});

describe("the library file", () => {
  it("is JSON the host keeps as it is given, and reads back to the same program", () => {
    const starter = STARTERS[1]!;
    const id = newId();
    expect(id).toMatch(/^G-[0-9a-z]+$/);
    const text = libraryText(id, "  Visits per week ", starter.program);
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toMatchObject({ format: FORMAT, formatVersion: 1, id, label: "Visits per week" });
    expect(parseLibraryText(text)).toEqual({ id, label: "Visits per week", program: starter.program });
    for (const bad of ["", "not json", "[]", JSON.stringify({ format: "kasten-layout" }), JSON.stringify({ format: FORMAT, id: "x", label: "y" }), JSON.stringify({ format: FORMAT, id: "x", label: "y", generator: { language: "python", code: "x" } })]) {
      expect(parseLibraryText(bad), bad).toBeUndefined();
    }
  });
});
