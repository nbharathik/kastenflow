// Sections from dividers: the page splits at its top-level `---` lines, and a
// section folds to one row. Folding is what the reader sees, not the page:
// the Markdown never changes, and what is folded is kept in this browser
// (folds.ts), per page. The same sections can be drawn as slide-like cards
// (the sections layout) and presented one at a time (smart.ts).

import "./sections.css";

import { Plugin } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";

import { foldAll, presentingAt, showSlide, startPresenting, stopPresenting } from "./api";
import { writeFolds } from "./folds";
import { refreshHeads } from "./heads";
import { opened, touched, visibleSelection } from "./guards";
import { foldKeyCtx, sectionsKey, smartCtx, type SectionsMeta, type SectionsState } from "./key";
import { keyOf, sectionNames, sectionsOf } from "./model";
import { setPresenting } from "./presenting";
import { registerSections } from "./registry";
import { EMPTY_SMART } from "./smart";
import { EMPTY, nextState } from "./state";
import { slideTexts } from "./texts";

const pageKeyOf = (get: () => string | null): string | null => {
  try {
    return get();
  } catch {
    // The editor is going away.
    return null;
  }
};

export const sectionsPlugin = $prose((ctx) => {
  const page = () => pageKeyOf(() => ctx.get(foldKeyCtx.key));
  /** Whether the page was opened in the sections layout. */
  const smartOn = () => {
    try {
      return ctx.get(smartCtx.key);
    } catch {
      return false;
    }
  };
  return new Plugin<SectionsState>({
    key: sectionsKey,
    state: {
      init: () => ({ ...EMPTY, smart: { ...EMPTY_SMART, on: smartOn() } }),
      apply: (tr, prev) => nextState(prev, tr, page),
    },
    props: {
      // While presenting, only the slide shows: folds and cards are left out.
      decorations: (state) => (presentingAt(state) === null ? sectionsKey.getState(state)?.decorations : undefined),
      // A page being presented is read, not written.
      editable: (state) => presentingAt(state) === null,
      attributes: (state) => {
        const { on, present, whole } = sectionsKey.getState(state)?.smart ?? EMPTY_SMART;
        const classes = [on ? "kasten-sections-layout" : "", present === null ? "" : "kasten-is-presenting", present !== null && whole ? "kasten-slide-whole" : ""].filter(Boolean).join(" ");
        const attrs: Record<string, string> = {};
        if (classes) attrs.class = classes;
        return attrs;
      },
    },
    appendTransaction(trs, oldState, state) {
      const mine = sectionsKey.getState(state);
      if (!mine || mine.hidden.length === 0) return null;
      // An edit that reaches a folded section shows it first (a page being opened restores its folds instead).
      if (!opened(trs)) {
        const reached = touched(trs, mine.hidden);
        if (reached.length > 0) return state.tr.setMeta(sectionsKey, { set: reached, folded: false } satisfies SectionsMeta).setMeta("addToHistory", false);
      }
      // The caret never rests where nothing is shown.
      const away = visibleSelection(oldState, state, mine.hidden);
      return away ? state.tr.setSelection(away).setMeta("addToHistory", false) : null;
    },
    view: (view) => {
      const unregister = registerSections({
        dom: view.dom,
        page,
        foldAll: (folded) => foldAll(view, folded),
        present: (pos) => startPresenting(view, pos),
        step: (to) => {
          const at = presentingAt(view.state);
          if (at !== null) showSlide(view, to === "next" ? at + 1 : to === "previous" ? at - 1 : to === "first" ? 0 : Number.MAX_SAFE_INTEGER);
        },
        stop: () => stopPresenting(view),
        texts: () => slideTexts(ctx, view.state.doc),
      });
      return {
        update(editor, before) {
          const now = sectionsKey.getState(editor.state);
          const was = sectionsKey.getState(before);
          if (!now) return;
          // The page around the editor draws its presenting frame from this.
          if (now.smart.present !== was?.smart.present || now.smart.slides !== was?.smart.slides || now.smart.title !== was?.smart.title) {
            setPresenting(editor.dom, now.smart.present === null ? null : { index: now.smart.present, count: now.smart.slides, title: now.smart.title, dom: editor.dom });
          }
          // Typing in a section's heading changes the title its bar shows.
          if (now.smart.typed !== was?.smart.typed) refreshHeads(editor, now.smart.typedAt);
          if (now.rev === was?.rev) return;
          // What is folded changed: keep it for the page.
          const { doc } = editor.state;
          const sections = sectionsOf(doc);
          const names = sectionNames(doc, sections);
          writeFolds(
            page(),
            sections.filter((section) => now.folded.has(keyOf(section))).map((section) => names[section.index]!),
          );
        },
        destroy: () => {
          unregister();
          setPresenting(view.dom, null);
        },
      };
    },
  });
});

/** The cards of the sections layout, or the one slide being shown: drawn beside the folds, from the same state. */
export const smartDecorations = $prose(() => new Plugin({ props: { decorations: (state) => sectionsKey.getState(state)?.smart.decorations } }));
