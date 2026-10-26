import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagnostics } from "./diagnostics";
import { useLatexPrefs } from "./prefs";
import { Session } from "./session";
import { DOC, event, fakeBackend, FOLDER, INTRO, MAIN } from "./test-support";

async function started(initial: Record<string, string> = {}) {
  const fake = fakeBackend(initial);
  const session = new Session(fake.backend, DOC);
  await session.start();
  return { ...fake, session };
}

const typed = (text: string) => `\\documentclass{article}\n${text}`;

describe("a LaTeX session", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useLatexPrefs.getState().set({ autoBuild: true, delayMs: 500 });
  });
  afterEach(() => vi.useRealTimers());

  it("opens the root file and lists the folder's files", async () => {
    const t = await started();
    const s = t.session.snapshot();
    expect(s.open).toBe(MAIN);
    expect(s.files.map((f) => f.path)).toContain(INTRO);
    expect(s.loading).toBe(false);
    expect(t.session.textOf(MAIN)).toContain("\\begin{document}");
    t.session.dispose();
  });

  it("builds once when it opens (auto-build is on), and not at all when it is off", async () => {
    const on = await started();
    expect(on.backend.build).toHaveBeenCalledTimes(1);
    on.session.dispose();
    useLatexPrefs.getState().set({ autoBuild: false });
    const off = await started();
    expect(off.backend.build).not.toHaveBeenCalled();
    off.session.dispose();
  });

  it("says a build was asked for at once, before any event", async () => {
    useLatexPrefs.getState().set({ autoBuild: false });
    const t = await started();
    const calls: boolean[] = [];
    t.session.subscribe(() => calls.push(t.session.snapshot().requesting));
    const asked = t.session.buildNow();
    expect(calls[0]).toBe(true);
    await asked;
    t.send(event({ state: "running" }));
    expect(t.session.snapshot().requesting).toBe(false);
    expect(t.session.snapshot().build.phase).toBe("running");
    t.session.dispose();
  });

  it("autosaves 500 ms after the last key with the file's hash, and sends only unsaved files with a build", async () => {
    useLatexPrefs.getState().set({ autoBuild: false });
    const t = await started();
    t.session.edit(MAIN, typed("one"));
    expect(t.session.snapshot().dirty).toEqual([MAIN]);
    await t.session.buildNow();
    expect(t.backend.build).toHaveBeenLastCalledWith({ folder: FOLDER, buffers: [{ path: MAIN, text: typed("one") }] });
    await vi.advanceTimersByTimeAsync(500);
    expect(t.backend.saveSource).toHaveBeenCalledTimes(1);
    expect(t.backend.saveSource.mock.calls[0]![0]).toBe(MAIN);
    expect(t.session.snapshot().dirty).toEqual([]);
    // Saved: the next build carries no buffers.
    await t.session.buildNow();
    expect(t.backend.build).toHaveBeenLastCalledWith({ folder: FOLDER, buffers: [] });
    t.session.dispose();
  });

  it("builds a moment after typing stops (the delay is the setting), not while keys keep coming", async () => {
    useLatexPrefs.getState().set({ autoBuild: true, delayMs: 300 });
    const t = await started();
    t.backend.build.mockClear();
    t.session.edit(MAIN, typed("a"));
    await vi.advanceTimersByTimeAsync(250);
    t.session.edit(MAIN, typed("ab"));
    await vi.advanceTimersByTimeAsync(250);
    expect(t.backend.build).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(t.backend.build).toHaveBeenCalledTimes(1);
    expect(t.backend.build.mock.calls[0]![0].buffers[0]!.text).toBe(typed("ab"));
    t.session.dispose();
  });

  it("does not build by itself when auto-build is off", async () => {
    useLatexPrefs.getState().set({ autoBuild: false });
    const t = await started();
    t.session.edit(MAIN, typed("a"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.backend.build).not.toHaveBeenCalled();
    t.session.dispose();
  });

  it("Ctrl+S saves and builds at once", async () => {
    useLatexPrefs.getState().set({ autoBuild: false });
    const t = await started();
    t.session.edit(MAIN, typed("x"));
    t.session.saveAndBuild();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.backend.saveSource).toHaveBeenCalledTimes(1);
    expect(t.backend.build).toHaveBeenCalledTimes(1);
    t.session.dispose();
  });

  it("follows the build's events, keeps the diagnostics for the editor, and ignores other documents", async () => {
    useLatexPrefs.getState().set({ autoBuild: false });
    const t = await started();
    const bad = { file: "main.tex", line: 3, severity: "error" as const, message: "Undefined control sequence." };
    t.send(event({ state: "running", note: "Downloading TeX packages…" }));
    expect(t.session.snapshot().build.note).toBe("Downloading TeX packages…");
    t.send(event({ doc: "other/doc", seq: 9, state: "done", pdf: true }));
    expect(t.session.snapshot().build.phase).toBe("running");
    t.send(event({ state: "failed", diagnostics: [bad], error: { kind: "engine-failed", message: "TeX stopped." } }));
    expect(t.session.snapshot().build.phase).toBe("failed");
    expect(useDiagnostics.getState().byDoc[FOLDER]).toEqual([bad]);
    t.send(event({ seq: 2, state: "done", pdf: true, ms: 900 }));
    expect(t.session.snapshot().build).toMatchObject({ phase: "done", pdfSeq: 2 });
    t.session.dispose();
    // Closing the document forgets them.
    expect(useDiagnostics.getState().byDoc[FOLDER]).toBeUndefined();
  });

  it("turns 'no engine' into the card with the next step, stops building by itself, and builds again once there is one", async () => {
    useLatexPrefs.getState().set({ autoBuild: false });
    const t = await started();
    const missing = { kind: "no-engine", message: "There is no TeX engine on this computer.", next: "install-tectonic" as const };
    t.backend.build.mockRejectedValueOnce(missing);
    await t.session.buildNow();
    expect(t.session.snapshot().noEngine).toEqual(missing);
    expect(t.session.snapshot().build.phase).toBe("idle");
    // Typing does not ask for builds that cannot work.
    useLatexPrefs.getState().set({ autoBuild: true });
    t.session.edit(MAIN, typed("y"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.backend.build).toHaveBeenCalledTimes(1);
    // Using the person's own TeX saves the choice, then builds.
    await t.session.useEngine("latexmk-pdf");
    expect(t.backend.setEngine).toHaveBeenCalledWith(FOLDER, "latexmk-pdf");
    expect(t.backend.build).toHaveBeenCalledTimes(2);
    expect(t.session.snapshot().noEngine).toBeNull();
    t.session.dispose();
  });

  it("shows the card on opening when the engine check finds none, without a failed build first", async () => {
    const fake = fakeBackend();
    fake.state.engines = { engines: [], chosen: null, error: { kind: "no-engine", message: "No engine.", next: "install-tectonic" } };
    const session = new Session(fake.backend, DOC);
    await session.start();
    expect(session.snapshot().noEngine?.next).toBe("install-tectonic");
    expect(fake.backend.build).not.toHaveBeenCalled();
    session.dispose();
  });

  it("another kind of build error is shown as a failed build", async () => {
    useLatexPrefs.getState().set({ autoBuild: false });
    const t = await started();
    t.backend.build.mockRejectedValueOnce({ kind: "bad-request", message: "The folder is not a plain folder." });
    await t.session.buildNow();
    expect(t.session.snapshot().build).toMatchObject({ phase: "failed", error: { message: "The folder is not a plain folder." } });
    expect(t.session.snapshot().requesting).toBe(false);
    t.session.dispose();
  });

  it("opens another file of the folder and keeps the first one's unsaved text", async () => {
    useLatexPrefs.getState().set({ autoBuild: false });
    const t = await started();
    t.session.edit(MAIN, typed("kept"));
    await t.session.openFile(INTRO);
    expect(t.session.snapshot().open).toBe(INTRO);
    expect(t.session.textOf(INTRO)).toBe("Intro.\n");
    expect(t.session.textOf(MAIN)).toBe(typed("kept"));
    await t.session.buildNow();
    expect(t.backend.build.mock.calls[0]![0].buffers).toEqual([{ path: MAIN, text: typed("kept") }]);
    t.session.dispose();
  });

  it("a merge replaces the editor's text and says so once; a conflict waits for a choice", async () => {
    useLatexPrefs.getState().set({ autoBuild: false });
    const t = await started();
    const replaced: [string, string][] = [];
    t.session.onReplace = (path, text) => replaced.push([path, text]);
    t.state.saveAnswer = (path, _b, text) => ({ status: "merged", file: { path, text: `${text}theirs\n`, hash: "m1" } });
    t.session.edit(MAIN, typed("mine\n"));
    await t.session.saveAll();
    expect(replaced).toEqual([[MAIN, `${typed("mine\n")}theirs\n`]]);
    expect(t.session.snapshot().notice?.text).toMatch(/merged/);

    t.state.saveAnswer = (path) => ({ status: "conflict", copy: `${FOLDER}/main (conflict 1).tex`, file: { path, text: "disk\n", hash: "d1" } });
    t.session.edit(MAIN, typed("again\n"));
    await t.session.saveAll();
    expect(t.session.snapshot().conflict).toEqual({ path: MAIN, copy: `${FOLDER}/main (conflict 1).tex` });
    // The copy is a new file in the folder.
    expect(t.backend.files).toHaveBeenCalledTimes(2);
    t.session.useDisk();
    expect(replaced.at(-1)).toEqual([MAIN, "disk\n"]);
    expect(t.session.snapshot().conflict).toBeNull();
    expect(t.session.snapshot().dirty).toEqual([]);
    t.session.dispose();
  });

  it("a failed save is shown and goes away when typing goes on", async () => {
    useLatexPrefs.getState().set({ autoBuild: false });
    const t = await started();
    t.backend.saveSource.mockRejectedValueOnce("The disk is full");
    t.session.edit(MAIN, typed("z"));
    await t.session.saveAll();
    expect(t.session.snapshot().saveProblem).toBe("The disk is full");
    t.session.edit(MAIN, typed("zz"));
    expect(t.session.snapshot().saveProblem).toBeNull();
    t.session.dispose();
  });

  it("finds the place in the PDF for a line", async () => {
    useLatexPrefs.getState().set({ autoBuild: false });
    const t = await started();
    expect(await t.session.whereInPdf(MAIN, 3)).toMatchObject({ page: 1, y: 100 });
    expect(t.backend.syncForward).toHaveBeenCalledWith(FOLDER, MAIN, 3);
    t.backend.syncForward.mockResolvedValueOnce([]);
    expect(await t.session.whereInPdf(MAIN, 99)).toBeNull();
    t.session.dispose();
  });

  it("saves what was typed when the document is closed, then stops listening and building", async () => {
    const t = await started();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.listeners.size).toBe(1);
    t.session.edit(MAIN, typed("late"));
    t.backend.build.mockClear();
    t.session.dispose();
    expect(t.listeners.size).toBe(0);
    // The text typed a moment ago is not lost to the 500 ms wait.
    expect(t.backend.saveSource).toHaveBeenCalledTimes(1);
    expect(t.backend.saveSource.mock.calls[0]![2]).toBe(typed("late"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.backend.build).not.toHaveBeenCalled();
    expect(t.backend.saveSource).toHaveBeenCalledTimes(1);
  });

  it("reports a document that cannot be opened in a sentence", async () => {
    const fake = fakeBackend();
    fake.backend.files.mockRejectedValueOnce("That folder is not a LaTeX document");
    const session = new Session(fake.backend, DOC);
    await session.start();
    expect(session.snapshot().loadProblem).toBe("That folder is not a LaTeX document");
    expect(session.snapshot().loading).toBe(false);
    session.dispose();
  });
});
