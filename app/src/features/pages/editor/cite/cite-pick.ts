// "Citation…": a menu of the papers in the vault's bibliography. Typing narrows
// it by key, author, year or title; a comma adds a locator ("vaswani, p. 4").
// The pick writes `[@key]` or `[@key, p. 4]` into the page as plain text. The
// citation chip is only how the editor draws it. Inside a citation that is
// already there, the pick adds another work to it: `[@a; @b]`.

import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

import { openAddPaper } from "../../../references/add-state";
import { shortAuthors, workOf } from "../../../references/labels";
import { matchWorks } from "../../../sources/reader/clip/bib";
import { closesWith } from "../ui/close-with-editor";
import type { Rect } from "../ui/dom";
import { Popover, type MenuItem, type MenuSection } from "../ui/popover";
import { allWorks, ensureBook, onBook } from "./book";
import { groupAt, scanDoc, type DocGroup } from "./doc-groups";

const MOST = 8;

/** The words that find a paper and the locator after a comma. */
export function splitQuery(query: string): { words: string; locator: string } {
  const comma = query.indexOf(",");
  return comma < 0 ? { words: query.trim(), locator: "" } : { words: query.slice(0, comma).trim(), locator: query.slice(comma + 1).trim() };
}

/** `[@key]`, or `[@key, p. 4]`. */
export const citationText = (key: string, locator: string): string => `[@${key}${locator ? `, ${locator}` : ""}]`;

/** What to write, and where, to cite `key` with a locator over `from`..`to`. Inside a group already, the work is added to it. */
export function citationInsertion(group: DocGroup | undefined, from: number, to: number, key: string, locator: string): { from: number; to: number; text: string } {
  if (group && from > group.from && from < group.to) {
    const at = group.to - 1;
    return { from: at, to: at, text: `; @${key}${locator ? `, ${locator}` : ""}` };
  }
  return { from, to, text: citationText(key, locator) };
}

/** Writes the citation into the page and puts the caret after it. */
export function putCitation(view: EditorView, from: number, to: number, key: string, locator: string): void {
  const { state } = view;
  const size = state.doc.content.size;
  const start = Math.min(from, size);
  const end = Math.min(Math.max(to, start), size);
  const plan = citationInsertion(groupAt(scanDoc(state.doc), start), start, end, key, locator);
  const tr = state.tr.insertText(plan.text, plan.from, plan.to);
  tr.setSelection(TextSelection.create(tr.doc, plan.from + plan.text.length));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** Opens the citation menu over the selection (or the caret). */
export function startCitePick(view: EditorView): Popover {
  const { from, to } = view.state.selection;
  ensureBook();
  let query = "";
  const caret = (): Rect => {
    try {
      return view.coordsAtPos(from);
    } catch {
      // No layout (tests) or a stale position.
      return view.dom.getBoundingClientRect();
    }
  };

  const sections = (): MenuSection[] => {
    const { words, locator } = splitQuery(query);
    const found = matchWorks(
      allWorks().map((w) => workOf(w.entry)),
      words,
    ).slice(0, MOST);
    const items: MenuItem[] = found.map((work, i) => ({
      key: `cite:${i}:${work.key}`,
      label: work.title || work.key,
      icon: "icon:book",
      hint: [shortAuthors(work), work.year].filter(Boolean).join(" "),
      description: work.key,
      onPick: () => putCitation(view, from, to, work.key, locator),
    }));
    const add: MenuItem = { key: "add", label: "Add a paper…", icon: "icon:plus", onPick: () => openAddPaper({ then: (key) => putCitation(view, from, to, key, locator) }) };
    const title = words ? `Cite: ${words}${locator ? `, ${locator}` : ""}` : "Cite a paper";
    return [{ title, items }, { items: [add] }];
  };

  const menu = new Popover(sections(), {
    anchor: caret,
    ownKeys: true,
    label: "Cite a paper",
    emptyText: "No paper matches",
    onClose: () => {
      window.removeEventListener("keydown", typed, true);
      stop();
    },
  });
  const stop = onBook(() => menu.isOpen && menu.setSections(sections()));
  // The menu keeps typing from the page; the words are for narrowing it.
  function typed(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const next = event.key === "Backspace" ? query.slice(0, -1) : event.key.length === 1 ? query + event.key : query;
    if (next === query) return;
    query = next;
    menu.setSections(sections());
  }
  window.addEventListener("keydown", typed, true);
  return closesWith(view, menu);
}
