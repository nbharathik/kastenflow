// Find and replace in a page: matches ignore case, stay inside a block and
// skip page links; stepping goes round; replacing one moves on, and
// "Replace all" is one change that one undo takes back.

import { undo } from "@milkdown/kit/prose/history";
import { describe, expect, it } from "vitest";

import { useTestEditor } from "../../../../test/editor";
import { foldAll, isHidden } from "../sections/api";
import { clearFind, findMatches, findState, replaceAll, replaceCurrent, setOptions, setQuery, step } from "./find";

const editor = useTestEditor();

const BODY = "Plan the trip. The **plan** has a plan B.\n\nA [[Plan]] link, and plan-\nning across lines.\n";

const texts = () => findState(editor.view.state).matches.map((m) => editor.doc.textBetween(m.from, m.to));

describe("finding in a page", () => {
  it("finds every place, ignoring case, across marks but not across links or blocks", () => {
    editor.open(BODY);
    setQuery(editor.view, "plan");
    expect(texts()).toEqual(["Plan", "plan", "plan", "plan"]);
    expect(editor.view.dom.querySelectorAll(".kasten-find-match")).toHaveLength(4);
    expect(editor.view.dom.querySelectorAll(".kasten-find-match.is-current")).toHaveLength(1);
    setQuery(editor.view, "trip. the");
    expect(texts()).toEqual(["trip. The"]);
    setQuery(editor.view, "");
    expect(texts()).toEqual([]);
  });

  it("steps through the matches and goes round at the ends", () => {
    editor.open(BODY);
    editor.caret("has");
    setQuery(editor.view, "plan");
    // From the caret: the next match after it.
    expect(findState(editor.view.state).index).toBe(2);
    step(editor.view, 1);
    expect(findState(editor.view.state).index).toBe(3);
    step(editor.view, 1);
    expect(findState(editor.view.state).index).toBe(0);
    step(editor.view, -1);
    expect(findState(editor.view.state).index).toBe(3);
    const { from, to } = editor.view.state.selection;
    expect(editor.doc.textBetween(from, to)).toBe("plan");
  });

  it("replaces one and moves on, even when the new text holds the query", () => {
    editor.open("A plan, a plan.\n");
    editor.caret("A");
    setQuery(editor.view, "plan");
    replaceCurrent(editor.view, "better plan");
    expect(editor.save()).toBe("A better plan, a plan.\n");
    expect(findState(editor.view.state).index).toBe(1);
    replaceCurrent(editor.view, "map");
    expect(editor.save()).toBe("A better plan, a map.\n");
  });

  it("replaces all in one change, keeping marks and the other blocks as written", () => {
    editor.open(BODY);
    setQuery(editor.view, "plan");
    expect(replaceAll(editor.view, "route")).toBe(4);
    expect(editor.save()).toBe("route the trip. The **route** has a route B.\n\nA [[Plan]] link, and route-\nning across lines.\n");
    expect(findState(editor.view.state).matches).toEqual([]);
    undo(editor.view.state, editor.view.dispatch);
    expect(editor.save()).toBe(BODY);
    clearFind(editor.view);
    expect(editor.view.dom.querySelectorAll(".kasten-find-match")).toHaveLength(0);
  });
});

describe("match case and whole word", () => {
  const WORDS = "Plan planned plans plan_x plan2 (plan) xplan plan.\n";
  const found = (query: string, options: Parameters<typeof findMatches>[2]) => findMatches(editor.doc, query, options).map((m) => editor.doc.textBetween(m.from, m.to));

  it("match case finds only the capitals typed", () => {
    editor.open(BODY);
    expect(found("Plan", { matchCase: true })).toEqual(["Plan"]);
    expect(found("plan", { matchCase: true })).toEqual(["plan", "plan", "plan"]);
    expect(found("PLAN", { matchCase: false })).toHaveLength(4);
  });

  it("whole word leaves out a match with a letter, digit or underscore beside it", () => {
    editor.open(WORDS);
    expect(findMatches(editor.doc, "plan", {})).toHaveLength(8);
    const whole = findMatches(editor.doc, "plan", { wholeWord: true });
    // "Plan", "(plan)" and "plan." stand alone.
    expect(whole.map((m) => editor.doc.textBetween(m.from - 1, m.to + 1))).toEqual(["Plan ", "(plan)", " plan."]);
  });

  it("whole word and match case work together", () => {
    editor.open(WORDS);
    expect(found("Plan", { matchCase: true, wholeWord: true })).toEqual(["Plan"]);
    expect(found("plan", { matchCase: true, wholeWord: true })).toEqual(["plan", "plan"]);
  });

  it("whole word treats a page link as a boundary, and other languages' letters as letters", () => {
    editor.open("A [[Plan]] plan and plänen and plan\n");
    expect(found("plan", { wholeWord: true })).toEqual(["plan", "plan"]);
    expect(found("plä", { wholeWord: true })).toEqual([]);
  });

  it("keeps the options in the find state, searching again as they change", () => {
    editor.open(BODY);
    setQuery(editor.view, "plan");
    expect(findState(editor.view.state).matches).toHaveLength(4);
    setOptions(editor.view, { matchCase: true, wholeWord: false });
    expect(findState(editor.view.state).options).toEqual({ matchCase: true, wholeWord: false });
    expect(texts()).toEqual(["plan", "plan", "plan"]);
    // Cleared, the options stay for the next query.
    clearFind(editor.view);
    expect(findState(editor.view.state).options.matchCase).toBe(true);
    setQuery(editor.view, "Plan");
    expect(texts()).toEqual(["Plan"]);
    setOptions(editor.view, { matchCase: false, wholeWord: false });
    clearFind(editor.view);
  });
});

const TITLED =
  "<details>\n<summary>Plan the trip</summary>\n\nPack the plan.\n\n</details>\n\n> [!note] Plan B\n> Body plan.\n\nThe last plan.\n";

describe("title fields", () => {
  const kinds = () => findState(editor.view.state).matches.map((m) => (m.field ? m.field.attr : "text"));

  it("finds the text in a toggle's and a callout's title, in page order", () => {
    editor.open(TITLED);
    setQuery(editor.view, "plan");
    expect(kinds()).toEqual(["summary", "text", "title", "text", "text"]);
    const [summary, , title] = findState(editor.view.state).matches;
    expect(summary!.field).toMatchObject({ attr: "summary", start: 0, end: 4 });
    expect(title!.field).toMatchObject({ attr: "title", start: 0, end: 4 });
  });

  it("marks the whole field, and the current one more strongly", () => {
    editor.open(TITLED);
    setQuery(editor.view, "plan");
    const fields = [...editor.view.dom.querySelectorAll(".kasten-find-field")];
    expect(fields).toHaveLength(2);
    expect(fields[0]!.classList.contains("kasten-toggle")).toBe(true);
    expect(fields[0]!.classList.contains("is-current")).toBe(true);
    expect(fields[1]!.classList.contains("kasten-callout")).toBe(true);
    expect(fields[1]!.classList.contains("is-current")).toBe(false);
    step(editor.view, 1);
    step(editor.view, 1);
    expect(editor.view.dom.querySelector(".kasten-callout")!.classList.contains("is-current")).toBe(true);
    // Stepping to a field leaves the selection where it was.
    expect(editor.view.state.selection.empty).toBe(false);
    clearFind(editor.view);
    expect(editor.view.dom.querySelectorAll(".kasten-find-field")).toHaveLength(0);
  });

  it("replaces all in one transaction, titles included, and one undo takes it back", () => {
    editor.open(TITLED);
    setQuery(editor.view, "plan");
    let dispatched = 0;
    const dispatch = editor.view.dispatch.bind(editor.view);
    editor.view.dispatch = (tr) => {
      dispatched++;
      dispatch(tr);
    };
    expect(replaceAll(editor.view, "route")).toBe(5);
    editor.view.dispatch = dispatch;
    expect(dispatched).toBe(1);
    const saved = editor.save();
    expect(saved).toContain("<summary>route the trip</summary>");
    expect(saved).toContain("Pack the route.");
    expect(saved).toContain("> [!note] route B\n> Body route.");
    expect(saved).toContain("The last route.");
    undo(editor.view.state, editor.view.dispatch);
    expect(editor.save()).toBe(TITLED);
    clearFind(editor.view);
  });

  it("replaces one field match and moves on, even when the new text holds the query", () => {
    editor.open("<details>\n<summary>plan the plan</summary>\n\nBody.\n\n</details>\n");
    setQuery(editor.view, "plan");
    expect(kinds()).toEqual(["summary", "summary"]);
    replaceCurrent(editor.view, "better plan");
    expect(editor.save()).toContain("<summary>better plan the plan</summary>");
    // The original second "plan" (the second of two now), not the one in the new text.
    expect(findState(editor.view.state).index).toBe(1);
    replaceCurrent(editor.view, "map");
    expect(editor.save()).toContain("<summary>better plan the map</summary>");
    clearFind(editor.view);
  });

  it("keeps a replacement from ending the toggle in the file", () => {
    editor.open("<details>\n<summary>old</summary>\n\nBody.\n\n</details>\n");
    setQuery(editor.view, "old");
    replaceAll(editor.view, "new</summary></details>");
    const saved = editor.save();
    expect(saved).toContain("<summary>new&lt;/summary&gt;&lt;/details&gt;</summary>");
    expect(saved.match(/<\/details>/g)).toHaveLength(1);
    clearFind(editor.view);
  });
});

describe("showing a match that is hidden", () => {
  const toggle = () => editor.view.dom.querySelector(".kasten-toggle")!;
  /** The editor keeps a toggle's view from one page to the next, with its fold: close it as a click would. */
  const close = () => {
    if (toggle().classList.contains("is-open")) toggle().querySelector(".kasten-toggle-arrow")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  };

  it("opens a closed toggle holding the match", () => {
    editor.open("<details>\n<summary>Trip</summary>\n\nPack the tent.\n\n</details>\n\nOutside.\n");
    close();
    expect(toggle().classList.contains("is-open")).toBe(false);
    setQuery(editor.view, "tent");
    expect(toggle().classList.contains("is-open")).toBe(true);
    expect(editor.view.state.doc.textBetween(editor.view.state.selection.from, editor.view.state.selection.to)).toBe("tent");
    clearFind(editor.view);
  });

  it("leaves a toggle closed when only its title matches", () => {
    editor.open("<details>\n<summary>Tent trip</summary>\n\nBody.\n\n</details>\n");
    close();
    setQuery(editor.view, "tent");
    expect(toggle().classList.contains("is-open")).toBe(false);
    clearFind(editor.view);
  });

  it("unfolds the folded section holding the match", () => {
    editor.open("Intro.\n\n---\n\nSecond section has a plan.\n\n---\n\nThird section.\n");
    foldAll(editor.view, true);
    const at = findMatches(editor.doc, "plan")[0]!.from;
    expect(isHidden(editor.view.state, at)).toBe(true);
    setQuery(editor.view, "plan");
    expect(isHidden(editor.view.state, at)).toBe(false);
    clearFind(editor.view);
  });
});
