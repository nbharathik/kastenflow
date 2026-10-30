// LaTeX and the chat: the editor's selection becomes a chip, a LaTeX file is a
// chip of its own, and "Fix with AI" starts a chat about the open file with
// the passage selected, whose changes the person looks at before they land.

import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useShell } from "../../lib/store";
import { BUILT_IN_ACTIONS } from "../../features/chat/preview/actions";
import { currentSelection } from "../../features/chat/selection/sources";
import { useChat } from "../../features/chat/store";
import { resetChat, scriptedChat, type Scripted } from "../../features/chat/test-kit";
import { useWorkspace } from "../../features/workspace/store";
import { addSelectionReader, fixWithAi, latexSelection } from "./chat";
import { useDiagnostics } from "./diagnostics";
import { ErrorList } from "./ErrorList";
import type { Diagnostic } from "./types";
import { useLatexChat } from "./useLatexChat";

const FOLDER = "projects/p/latex/paper";
const PATH = `${FOLDER}/main.tex`;
const TEXT = "\\section{Intro}\nWe use \\textbf{bold} words here.\n\\section{Method}\nMore text.\n";
const BOLD = { from: TEXT.indexOf("bold"), to: TEXT.indexOf("bold") + 4 };
const MORE = { from: TEXT.indexOf("More"), to: TEXT.indexOf("More") + 4 };
const d = (over: Partial<Diagnostic>): Diagnostic => ({ file: "main.tex", line: 2, severity: "error", message: "Undefined control sequence.", ...over });

let chat: Scripted;
let view: EditorView | null = null;

/** An editor holding TEXT with `range` selected, in a pane that is (or is not) the focused one. */
function mount(range: { from: number; to: number }, pane = "kasten-pane is-focused"): EditorView {
  document.body.innerHTML = `<div class="${pane}"><div id="host"></div></div>`;
  view = new EditorView({ state: EditorState.create({ doc: TEXT, selection: EditorSelection.single(range.from, range.to) }), parent: document.getElementById("host")! });
  return view;
}

beforeEach(() => {
  localStorage.clear();
  chat = scriptedChat();
  resetChat(chat);
  useShell.setState({ chatOpen: false });
  useDiagnostics.setState({ byDoc: {} });
});
afterEach(() => {
  cleanup();
  view?.destroy();
  view = null;
  document.body.innerHTML = "";
});

describe("the editor's selection", () => {
  it("is the words, their place in the file and the heading above them", () => {
    expect(latexSelection(mount(BOLD), PATH)).toEqual({ source: { kind: "latex", path: PATH }, text: "bold", range: BOLD, heading: "Intro", title: "main.tex" });
    expect(latexSelection(mount(MORE), PATH)).toMatchObject({ text: "More", heading: "Method" });
  });

  it("is nothing when nothing is selected, in a pane that is not in focus, or out of sight", () => {
    expect(latexSelection(mount({ from: 3, to: 3 }), PATH)).toBeNull();
    // With a second pane in focus, this one is not; alone, it is the pane keys act on.
    const other = mount(BOLD, "kasten-pane");
    document.body.insertAdjacentHTML("beforeend", '<div class="kasten-pane is-focused"></div>');
    expect(latexSelection(other, PATH)).toBeNull();
    expect(latexSelection(mount(BOLD, "kasten-pane"), PATH)).not.toBeNull();
    expect(latexSelection(mount(BOLD, "kasten-pane is-focused"), PATH)).not.toBeNull();
    (document.querySelector(".kasten-pane") as HTMLElement).style.display = "none";
    expect(latexSelection(view, PATH)).toBeNull();
    expect(latexSelection(null, PATH)).toBeNull();
  });

  it("is what the chat takes while a document is open, and not after it closes", () => {
    const open = mount(BOLD);
    expect(currentSelection()).toBeNull();
    const stop = addSelectionReader(() => latexSelection(open, PATH));
    expect(currentSelection()).toMatchObject({ source: { kind: "latex", path: PATH }, text: "bold", range: BOLD });
    stop();
    expect(currentSelection()).toBeNull();
  });

  it("comes from whichever of two open documents has one", () => {
    const first = mount({ from: 3, to: 3 });
    const none = addSelectionReader(() => latexSelection(first, `${FOLDER}/a.tex`));
    const second = new EditorView({ state: EditorState.create({ doc: TEXT, selection: EditorSelection.single(BOLD.from, BOLD.to) }), parent: document.getElementById("host")! });
    const some = addSelectionReader(() => latexSelection(second, `${FOLDER}/b.tex`));
    expect(currentSelection()).toMatchObject({ source: { path: `${FOLDER}/b.tex` } });
    some();
    expect(currentSelection()).toBeNull();
    none();
    second.destroy();
  });
});

describe("Fix with AI", () => {
  const instruction = BUILT_IN_ACTIONS.find((a) => a.slug === "fix-latex-errors")!.instruction;

  it("starts a chat about the file, with the passage selected, and asks what the action says", async () => {
    const snapshot = latexSelection(mount(BOLD), PATH);
    expect(await fixWithAi(PATH, snapshot)).toBe(true);
    expect(chat.requests).toHaveLength(1);
    const sent = chat.requests[0]!;
    expect(sent.text).toBe(instruction);
    expect(sent.context[0]).toEqual({ kind: "latex", label: "main.tex", ref: [PATH] });
    expect(sent.context[1]).toMatchObject({ kind: "selection", selection: { source: { kind: "latex", path: PATH }, text: "bold", range: BOLD, heading: "Intro", pinned: true } });
    expect(useShell.getState().chatOpen).toBe(true);
    // About that file and nothing else: it does not follow the page in front.
    const thread = useChat.getState().threads[useChat.getState().active!]!;
    expect(thread.follow).toBe(false);
  });

  it("sends just the file when nothing, or a stray character or two, is selected", async () => {
    await fixWithAi(PATH, null);
    await fixWithAi(PATH, latexSelection(mount({ from: BOLD.from, to: BOLD.from + 2 }), PATH));
    expect(chat.requests.map((r) => r.context)).toEqual([[{ kind: "latex", label: "main.tex", ref: [PATH] }], [{ kind: "latex", label: "main.tex", ref: [PATH] }]]);
  });

  it("leaves the action's words in the message box when there is no provider to ask", async () => {
    resetChat(scriptedChat([]));
    expect(await fixWithAi(PATH, null)).toBe(true);
    const { drafts } = await import("../../features/chat/message-drafts");
    expect(drafts.get(useChat.getState().active!)).toBe(instruction);
  });

  it("is offered in LaTeX views only, and is the file the app ships", () => {
    const BUILT_IN = [join(process.cwd(), "src-tauri"), join(process.cwd(), "app", "src-tauri")].find((dir) => existsSync(dir));
    expect(BUILT_IN).toBeDefined();
    // Every LaTeX action here is the file the app ships, word for word.
    for (const slug of LATEX_ACTIONS) {
      const text = readFileSync(join(BUILT_IN!, `src/chat/actions/builtin/${slug}.md`), "utf8").replace(/\r\n/g, "\n");
      const [, front = "", ...body] = text.split(/^---\s*$/m);
      const field = (key: string) => new RegExp(`^${key}:\\s*(.*)$`, "m").exec(front)?.[1]?.trim() ?? "";
      const list = (key: string) =>
        field(key)
          .replace(/^\[|\]$/g, "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      const mirror = BUILT_IN_ACTIONS.find((a) => a.slug === slug)!;
      expect({ title: mirror.title, icon: mirror.icon, writes: mirror.writes, where: mirror.where, needs: mirror.needs, optional: mirror.optional, instruction: mirror.instruction }, slug).toEqual({
        title: field("title"),
        icon: field("icon"),
        writes: field("writes"),
        where: list("where"),
        needs: list("needs"),
        optional: list("optional"),
        instruction: body.join("---").trim(),
      });
      expect(mirror.where, slug).toEqual(["latex"]);
    }
    expect(BUILT_IN_ACTIONS.find((a) => a.slug === "fix-latex-errors")!.writes).toBe("propose");
    for (const other of BUILT_IN_ACTIONS.filter((a) => !LATEX_ACTIONS.includes(a.slug))) expect(other.where).not.toContain("latex");
  });

  it("checks its work by building and says how the count moved", () => {
    expect(instruction).toContain("latex_build with wait set to true");
    expect(instruction).toContain("3 errors → 0");
    expect(instruction).toContain("may be wrong");
  });
});

const LATEX_ACTIONS = [
  "fix-latex-errors",
  "fix-latex-error",
  "explain-latex-error",
  "fix-overfull-boxes",
  "check-latex-refs",
  "find-missing-citations",
  "draft-latex-section",
  "table-to-booktabs",
  "figure-from-diagram",
  "latex-inline",
];

describe("the open document's part in the chat", () => {
  const editorOf = (v: EditorView) => ({ current: { view: () => v } }) as never;

  it("gives the chat its selection while the file is open", () => {
    const open = mount(BOLD);
    const hook = renderHook(() => useLatexChat(editorOf(open), PATH, FOLDER));
    expect(currentSelection()).toMatchObject({ source: { kind: "latex", path: PATH }, text: "bold" });
    hook.unmount();
    expect(currentSelection()).toBeNull();
  });

  it("says there is nothing to fix when the last build has nothing the assistant can put right", () => {
    const toast = vi.fn();
    useWorkspace.setState({ toast });
    const open = mount(BOLD);
    const hook = renderHook(() => useLatexChat(editorOf(open), PATH, FOLDER));
    useDiagnostics.getState().set(FOLDER, [d({ severity: "warning", message: "Font shape `OT1/cmr/m/n' undefined" })]);
    act(() => hook.result.current.fix());
    expect(toast).toHaveBeenCalledWith("The last build has nothing to fix.");
    expect(chat.requests).toEqual([]);
  });

  it("fixes warnings too: undefined references and citations, and overfull boxes", async () => {
    const open = mount(BOLD);
    const hook = renderHook(() => useLatexChat(editorOf(open), PATH, FOLDER));
    useDiagnostics.getState().set(FOLDER, [d({ severity: "warning", message: "Reference `eq:main' on page 3 undefined" })]);
    act(() => hook.result.current.fix());
    await vi.waitFor(() => expect(chat.requests).toHaveLength(1));
    expect(chat.requests[0]!.text).toBe(BUILT_IN_ACTIONS.find((a) => a.slug === "check-latex-refs")!.instruction);
    useDiagnostics.getState().set(FOLDER, [d({ severity: "info", message: "Overfull \\hbox (12pt too wide) in paragraph" })]);
    act(() => hook.result.current.fix());
    await vi.waitFor(() => expect(chat.requests).toHaveLength(2));
    expect(chat.requests[1]!.text).toBe(BUILT_IN_ACTIONS.find((a) => a.slug === "fix-overfull-boxes")!.instruction);
  });

  it("asks about one problem: the file it is in is the context and the problem is quoted", async () => {
    const open = mount(BOLD);
    const hook = renderHook(() => useLatexChat(editorOf(open), PATH, FOLDER));
    const problem = d({ file: "sections/intro.tex", line: 12, message: "Undefined control sequence.", context: "l.12 \\sectoin\n   {Intro}" });
    act(() => hook.result.current.fixOne(problem));
    await vi.waitFor(() => expect(chat.requests).toHaveLength(1));
    const sent = chat.requests[0]!;
    expect(sent.text.startsWith(BUILT_IN_ACTIONS.find((a) => a.slug === "fix-latex-error")!.instruction)).toBe(true);
    expect(sent.text).toContain("> Error in sections/intro.tex line 12: Undefined control sequence.");
    expect(sent.text).toContain("> l.12 \\sectoin");
    expect(sent.context).toEqual([{ kind: "latex", label: "intro.tex", ref: [`${FOLDER}/sections/intro.tex`] }]);
    act(() => hook.result.current.explain(d({ file: null, line: 2 })));
    await vi.waitFor(() => expect(chat.requests).toHaveLength(2));
    expect(chat.requests[1]!.text.startsWith(BUILT_IN_ACTIONS.find((a) => a.slug === "explain-latex-error")!.instruction)).toBe(true);
    expect(chat.requests[1]!.context[0]).toMatchObject({ label: "main.tex" });
  });

  it("starts the chat about the open file when the build had errors", async () => {
    const open = mount(BOLD);
    const hook = renderHook(() => useLatexChat(editorOf(open), PATH, FOLDER));
    useDiagnostics.getState().set(FOLDER, [d({})]);
    act(() => hook.result.current.fix());
    await vi.waitFor(() => expect(chat.requests).toHaveLength(1));
    expect(chat.requests[0]!.context.map((c) => c.kind)).toEqual(["latex", "selection"]);
  });
});

describe("the problem list's Fix with AI", () => {
  const list = (diagnostics: Diagnostic[], onFix?: () => void) =>
    render(<ErrorList diagnostics={diagnostics} folder={FOLDER} main="main.tex" files={[{ path: PATH, editable: true, size: 1 }]} onJump={vi.fn()} onFix={onFix} />);

  it("is a named button while the build has errors, and asks the chat", () => {
    const onFix = vi.fn();
    list([d({})], onFix);
    fireEvent.click(screen.getByRole("button", { name: "Fix with AI" }));
    expect(onFix).toHaveBeenCalledTimes(1);
  });

  it("is not there for warnings it cannot fix, or where the chat cannot be asked", () => {
    list([d({ severity: "warning" })], vi.fn());
    expect(screen.queryByRole("button", { name: "Fix with AI" })).toBeNull();
    cleanup();
    list([d({})]);
    expect(screen.queryByRole("button", { name: "Fix with AI" })).toBeNull();
    cleanup();
    // An undefined reference is a warning it can fix.
    list([d({ severity: "warning", message: "Citation `smith' on page 2 undefined" })], vi.fn());
    expect(screen.getByRole("button", { name: "Fix with AI" })).toBeTruthy();
  });

  it("shows the note about the engine above the problems when there is one", () => {
    render(<ErrorList diagnostics={[d({})]} folder={FOLDER} main="main.tex" files={[]} onJump={vi.fn()} advice="Switch its engine to XeLaTeX." />);
    expect(screen.getByRole("note").textContent).toBe("Switch its engine to XeLaTeX.");
  });

  it("offers Fix this one and Explain on each problem, reachable with the arrow keys", () => {
    const onFixOne = vi.fn();
    const onExplain = vi.fn();
    const problems = [d({ message: "One", line: 3 }), d({ message: "Two", line: 9 })];
    render(<ErrorList diagnostics={problems} folder={FOLDER} main="main.tex" files={[{ path: PATH, editable: true, size: 1 }]} onJump={vi.fn()} onFixOne={onFixOne} onExplain={onExplain} />);
    fireEvent.click(screen.getByRole("button", { name: "Fix this one, main.tex:9" }));
    expect(onFixOne).toHaveBeenCalledWith(problems[1]);
    fireEvent.click(screen.getByRole("button", { name: "Explain, main.tex:3" }));
    expect(onExplain).toHaveBeenCalledWith(problems[0]);
    // Up and Down move between the problems; Right goes to the row's own buttons and Left comes back.
    const first = screen.getByRole("button", { name: /One/ });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Two/ }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Fix this one, main.tex:9" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Explain, main.tex:9" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(first);
  });
});
