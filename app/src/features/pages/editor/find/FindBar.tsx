// The find bar over a page: Mod+F finds, Mod+Alt+F also replaces. Enter
// goes to the next match and Shift+Enter back; Escape closes it and puts
// the caret on the match. "Aa" (Alt+C) matches case and "ab" (Alt+W) whole
// words, kept between pages. The page's own text stays as it is until a
// replace, which Mod+Z takes back. With "+ sub-pages" the bar looks through
// the page and its sub-pages, lists them (FindResults.tsx) and replaces in
// all of them at once, as one change the workspace's Undo takes back.

import "./find.css";

import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { Crepe } from "@milkdown/crepe";
import { useEffect, useReducer, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

import { IconButton } from "../../../../ui/Button";
import { Segmented } from "../../../../ui/Segmented";
import { firstVisible } from "../../../../shell/visible-dom";
import { clearFind, findState, onFindChange, replaceAll, replaceCurrent, setOptions, setQuery, step, type FindOptions } from "./find";
import { FindResults } from "./FindResults";
import { readFindOptions, writeFindOptions } from "./options";
import type { SubPageFind } from "./sub-pages";
import { replaceable, summary, useSubPageReplace, useSubPageResults } from "./use-sub-page-find";

export interface FindOpen {
  replace: boolean;
  /** The selected text, to look for at once. */
  seed: string;
  /** Counts each Mod+F, so a second one takes focus back to the bar. */
  opened: number;
}

/** Opens the find bar on Mod+F when the keys are meant for this page: focus
 * is in it, or nowhere and this is the focused pane's first page. */
export function useFindKeys(root: RefObject<HTMLElement | null>, crepe: RefObject<Crepe | null>, open: (update: (was: FindOpen | null) => FindOpen) => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.code !== "KeyF" || event.defaultPrevented) return;
      const el = root.current;
      const editor = crepe.current;
      if (!el || !editor) return;
      const active = document.activeElement;
      const first = firstVisible(".kasten-pane.is-focused .kasten-page-editor") ?? firstVisible(".kasten-page-editor");
      const here = active && active !== document.body ? (el.closest(".kasten-page") ?? el).contains(active) : first === el;
      if (!here) return;
      event.preventDefault();
      const { state } = editor.editor.ctx.get(editorViewCtx);
      const picked = state.doc.textBetween(state.selection.from, state.selection.to, "\n");
      open((was) => ({
        replace: event.altKey || (was?.replace ?? false),
        seed: picked && !picked.includes("\n") ? picked : (was?.seed ?? ""),
        opened: (was?.opened ?? 0) + 1,
      }));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [root, crepe, open]);
}

type Scope = "page" | "sub";

export function FindBar({ view, find, onClose, subPages }: { view: EditorView; find: FindOpen; onClose(): void; subPages?: SubPageFind }) {
  const [query, setText] = useState(find.seed);
  const [replacement, setReplacement] = useState("");
  const [replacing, setReplacing] = useState(find.replace);
  const [options, setOptionsState] = useState(readFindOptions);
  const [scope, setScope] = useState<Scope>("page");
  const [, changed] = useReducer((n: number) => n + 1, 0);
  const input = useRef<HTMLInputElement>(null);
  const under = scope === "sub" && subPages !== undefined;
  const results = useSubPageResults(subPages, under, query, options.matchCase, options.wholeWord);
  const sub = useSubPageReplace(subPages, query, options.matchCase, options.wholeWord, results);

  // The count follows typing in the page.
  useEffect(() => {
    const stop = onFindChange(view, changed);
    return stop;
  }, [view]);
  // What was chosen last time applies to this page too, before anything is
  // looked for; once per page, as later changes go through `choose`.
  useEffect(() => {
    setOptions(view, readFindOptions());
  }, [view]);
  // Each Mod+F: the selected text, if any, and the field ready to type in.
  useEffect(() => {
    if (find.seed) {
      setText(find.seed);
      setQuery(view, find.seed);
    }
    if (find.replace) setReplacing(true);
    input.current?.focus();
    input.current?.select();
  }, [view, find]);

  const { matches, index } = findState(view.state);
  const here = !query ? "" : matches.length === 0 ? "No results" : `${index + 1} of ${matches.length}`;
  const overall = !under || !query ? "" : results.searching ? "Searching…" : results.error ? "" : summary(results.pages);
  // The marks go with the bar. (A page closing takes its editor, marks and
  // all, so nothing is dispatched to it then.)
  const close = () => {
    clearFind(view);
    onClose();
    view.focus();
  };
  const choose = (next: FindOptions) => {
    setOptionsState(next);
    writeFindOptions(next);
    setOptions(view, next);
  };
  const keys = (event: ReactKeyboardEvent, enter: () => void) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      enter();
    } else if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === "KeyC") {
      event.preventDefault();
      choose({ ...options, matchCase: !options.matchCase });
    } else if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === "KeyW") {
      event.preventDefault();
      choose({ ...options, wholeWord: !options.wholeWord });
    }
  };
  const going = replaceable(results.pages);

  return (
    <div className="kasten-find-bar" role="search" aria-label="Find in page">
      <div className="kasten-find-row">
        <IconButton icon={replacing ? "chevron-down" : "chevron"} size="sm" label={replacing ? "Hide replace" : "Replace"} onClick={() => setReplacing(!replacing)} />
        <input
          ref={input}
          className="kasten-find-input"
          aria-label="Find in page"
          placeholder="Find in page"
          value={query}
          onChange={(e) => {
            setText(e.target.value);
            setQuery(view, e.target.value);
          }}
          onKeyDown={(e) => keys(e, () => step(view, e.shiftKey ? -1 : 1))}
        />
        <span className="kasten-find-count" aria-live="polite">
          {here}
        </span>
        <button type="button" className="ui-icon-btn is-sm kasten-find-option" aria-pressed={options.matchCase} aria-label="Match case" title="Match case (Alt+C)" onClick={() => choose({ ...options, matchCase: !options.matchCase })}>
          <span aria-hidden="true">Aa</span>
        </button>
        <button type="button" className="ui-icon-btn is-sm kasten-find-option" aria-pressed={options.wholeWord} aria-label="Whole word" title="Whole word (Alt+W)" onClick={() => choose({ ...options, wholeWord: !options.wholeWord })}>
          <span aria-hidden="true" className="kasten-find-word">
            ab
          </span>
        </button>
        <IconButton icon="chevron-up" size="sm" label="Previous match" disabled={matches.length === 0} onClick={() => step(view, -1)} />
        <IconButton icon="chevron-down" size="sm" label="Next match" disabled={matches.length === 0} onClick={() => step(view, 1)} />
        <IconButton icon="close" size="sm" label="Close find" onClick={close} />
      </div>
      {subPages && (
        <div className="kasten-find-row is-scope">
          <Segmented
            label="Look in"
            value={scope}
            choices={[
              { value: "page", label: "This page" },
              { value: "sub", label: "+ sub-pages" },
            ]}
            onChange={setScope}
          />
          <span className="kasten-find-overall" aria-live="polite">
            {overall}
          </span>
        </div>
      )}
      {replacing && (
        <div className="kasten-find-row is-replace">
          <input
            className="kasten-find-input"
            aria-label="Replace with"
            placeholder="Replace with"
            value={replacement}
            onChange={(e) => {
              setReplacement(e.target.value);
              sub.clearNote();
            }}
            onKeyDown={(e) => keys(e, () => (under ? void sub.replaceAll(replacement) : replaceCurrent(view, replacement)))}
          />
          {under ? (
            <button
              type="button"
              className="ui-btn is-sm"
              disabled={going.length === 0 || results.more || results.searching || sub.busy}
              title="Replaces in every page listed with a count; titles are left alone"
              onClick={() => void sub.replaceAll(replacement)}
            >
              {sub.busy ? "Replacing…" : going.length > 0 ? `Replace all in ${going.length} ${going.length === 1 ? "page" : "pages"}` : "Replace all"}
            </button>
          ) : (
            <>
              <button type="button" className="ui-btn is-sm" disabled={matches.length === 0} onClick={() => replaceCurrent(view, replacement)}>
                Replace
              </button>
              <button type="button" className="ui-btn is-sm" disabled={matches.length === 0} onClick={() => replaceAll(view, replacement)}>
                Replace all
              </button>
            </>
          )}
        </div>
      )}
      {under && sub.note && (
        <p className="kasten-find-note" role="status">
          {sub.note}
        </p>
      )}
      {under && subPages && <FindResults results={results} query={query} scope={subPages} />}
    </div>
  );
}
