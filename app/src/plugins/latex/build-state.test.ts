import { describe, expect, it } from "vitest";

import { IDLE, hasProblem, reduce, statusText } from "./build-state";
import type { BuildEvent } from "./types";

const ev = (over: Partial<BuildEvent>): BuildEvent => ({ doc: "p/a", seq: 1, state: "queued", ms: 0, diagnostics: [], pdf: false, ...over });
const err = { file: "main.tex", line: 3, severity: "error" as const, message: "Undefined control sequence." };
const warn = { file: null, line: null, severity: "warning" as const, message: "Label multiply defined." };

describe("build state from events", () => {
  it("follows one build from queued to done and remembers the PDF", () => {
    let s = reduce(IDLE, ev({ state: "queued" }), "p/a");
    expect(s.phase).toBe("queued");
    s = reduce(s, ev({ state: "running", note: "Downloading TeX packages…" }), "p/a");
    expect(s.phase).toBe("running");
    expect(s.note).toBe("Downloading TeX packages…");
    s = reduce(s, ev({ state: "done", ms: 840, pdf: true, diagnostics: [warn] }), "p/a");
    expect(s).toMatchObject({ phase: "done", ms: 840, pdfSeq: 1, note: null, error: null });
    expect(s.diagnostics).toEqual([warn]);
  });

  it("ignores another document and older builds", () => {
    const s = reduce(IDLE, ev({ seq: 5, state: "running" }), "p/a");
    expect(reduce(s, ev({ doc: "p/b", seq: 9, state: "done" }), "p/a")).toBe(s);
    // The cancel of build 4 arrives after build 5 started.
    expect(reduce(s, ev({ seq: 4, state: "cancelled" }), "p/a")).toBe(s);
  });

  it("keeps the last good PDF when a build fails, and says why", () => {
    let s = reduce(IDLE, ev({ seq: 1, state: "done", pdf: true }), "p/a");
    s = reduce(s, ev({ seq: 2, state: "failed", diagnostics: [err], error: { kind: "engine-failed", message: "TeX stopped with errors." } }), "p/a");
    expect(s).toMatchObject({ phase: "failed", pdfSeq: 1 });
    expect(s.error?.message).toBe("TeX stopped with errors.");
    expect(hasProblem(s)).toBe(true);
  });

  it("takes a PDF a failed build still made (errors that TeX recovered from)", () => {
    const s = reduce(IDLE, ev({ seq: 3, state: "failed", pdf: true, diagnostics: [err] }), "p/a");
    expect(s.pdfSeq).toBe(3);
  });

  it("a cancelled build is not a problem and leaves the PDF alone", () => {
    let s = reduce(IDLE, ev({ seq: 1, state: "done", pdf: true }), "p/a");
    s = reduce(s, ev({ seq: 2, state: "cancelled" }), "p/a");
    expect(s).toMatchObject({ phase: "cancelled", pdfSeq: 1, error: null });
    expect(hasProblem(s)).toBe(false);
  });

  it("says what is going on in one short phrase", () => {
    expect(statusText(IDLE)).toBe("Not built yet");
    expect(statusText({ ...IDLE, phase: "running", note: null })).toBe("Building…");
    expect(statusText({ ...IDLE, phase: "running", note: "Downloading TeX packages…" })).toBe("Downloading TeX packages…");
    expect(statusText({ ...IDLE, phase: "done", ms: 1234, diagnostics: [] })).toBe("Built in 1.2 s");
    expect(statusText({ ...IDLE, phase: "done", ms: 80, diagnostics: [] })).toBe("Built in 80 ms");
    expect(statusText({ ...IDLE, phase: "failed", diagnostics: [err, err] })).toBe("2 errors");
    expect(statusText({ ...IDLE, phase: "failed", diagnostics: [err] })).toBe("1 error");
    expect(statusText({ ...IDLE, phase: "failed", diagnostics: [], error: { kind: "timeout", message: "The build took too long." } })).toBe("The build took too long.");
  });
});
