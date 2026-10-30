// The slash menu, as in Notion: type "/" at the start of a block or after a
// space, keep typing to filter, pick with Enter or a click. Picking removes
// the "/query" text and changes the block; Escape keeps the text as typed.

import type { Ctx } from "@milkdown/kit/ctx";
import { Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

import { openAi } from "../ai/ai";
import type { Rect } from "../ui/dom";
import { Popover, type MenuSection } from "../ui/popover";
import { filesOf } from "../files";
import { insertFiles, pickFiles } from "../paste-files";
import { inColumn, insertColumns } from "../columns/ops";
import { smartPage } from "../sections/smart-page";
import { onlySlash, templatePickerOf } from "../template-pick";
import { colorBlocks, insertBlock } from "./block-ops";
import { matchChoices, slashChoices, type Choice } from "./catalog";
import { startCitePick } from "../cite/cite-pick";
import { startDeckPick } from "./deck-pick";
import { startLink } from "./mention";
import { turnInto } from "./transform";

interface SlashState {
  /** Where the "/" is while the menu is open. */
  from: number | null;
}

type SlashMeta = { open: number } | { close: true };

export const slashKey = new PluginKey<SlashState>("KASTEN_SLASH");

const CLOSED: SlashState = { from: null };
const MAX_QUERY = 40;

/** The text typed after the "/", or null when the menu is closed. */
export function slashQuery(state: EditorState): string | null {
  const from = slashKey.getState(state)?.from;
  if (from == null) return null;
  return state.doc.textBetween(from + 1, state.selection.head, "\n", "￼");
}

/** Whether a "/" typed at `pos` opens the menu: in a text block that is not
 * code or a table cell, at its start or after a space. */
export function slashAllowed(state: EditorState, pos: number): boolean {
  const $pos = state.doc.resolve(pos);
  if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) return false;
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.spec.tableRole) return false;
  }
  const before = $pos.parent.textBetween(Math.max(0, $pos.parentOffset - 1), $pos.parentOffset, "\n", "￼");
  return before === "" || /\s/.test(before);
}

function nextState(tr: Transaction, prev: SlashState, state: EditorState): SlashState {
  const meta = tr.getMeta(slashKey) as SlashMeta | undefined;
  if (meta && "close" in meta) return CLOSED;
  if (meta && "open" in meta) return { from: meta.open };
  if (prev.from === null) return prev;
  const mapped = tr.mapping.mapResult(prev.from, 1);
  const from = mapped.pos;
  const { selection, doc } = state;
  if (mapped.deleted || !selection.empty || selection.head <= from) return CLOSED;
  if (doc.textBetween(from, from + 1) !== "/" || doc.resolve(from).parent !== selection.$head.parent) return CLOSED;
  const query = doc.textBetween(from + 1, selection.head, "\n", "￼");
  // A space right after "/", or one after a query that finds nothing, means plain text.
  if (/^\s/.test(query) || query.length > MAX_QUERY) return CLOSED;
  if (/\s$/.test(query) && matchChoices(slashChoices(), query).length === 0) return CLOSED;
  return { from };
}

/** Types a "/" at `pos` (inside an empty or new block) and opens the menu, as the "+" handle does. */
export function startSlash(view: EditorView, pos: number): void {
  const tr = view.state.tr.insertText("/", pos);
  tr.setSelection(TextSelection.create(tr.doc, pos + 1)).setMeta(slashKey, { open: pos } satisfies SlashMeta);
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** The command behind a menu choice. */
export function choiceCommand(choice: Choice, ctx: Ctx): Command {
  const { action } = choice;
  if (action.type === "turn") return turnInto(action.kind);
  if (action.type === "insert") return insertBlock(action.kind, ctx);
  if (action.type === "files") {
    return (_state, _dispatch, view) => {
      const provider = filesOf(ctx);
      if (!view || !provider) return false;
      pickFiles((files) => void insertFiles(view, provider, files, view.state.selection.from));
      return true;
    };
  }
  if (action.type === "ai") {
    const { action: asked } = action;
    return (_state, _dispatch, view) => Boolean(view && openAi(view, asked));
  }
  if (action.type === "template") {
    return () => {
      const pick = templatePickerOf(ctx);
      pick?.();
      return Boolean(pick);
    };
  }
  if (action.type === "smart") return smartPage(ctx);
  if (action.type === "columns") return insertColumns(action.count);
  if (action.type === "plugin") {
    const { run } = action;
    return (state, _dispatch, view) => {
      run(view ? { view, ctx, from: state.selection.from } : undefined);
      return true;
    };
  }
  if (action.type === "deck") {
    return (state, _dispatch, view) => {
      if (view) startDeckPick(view, ctx, state.selection.from);
      return Boolean(view);
    };
  }
  if (action.type === "cite") {
    return (_state, _dispatch, view) => {
      if (view) startCitePick(view);
      return Boolean(view);
    };
  }
  if (action.type === "link") {
    const { mode, view: kind } = action;
    return (state, _dispatch, view) => {
      if (view) startLink(view, state.selection.from, mode, kind);
      return Boolean(view);
    };
  }
  return colorBlocks(action.mark, action.color);
}

/** Menu sections for a query: Notion's sections when empty, best matches
 * first otherwise. "Template…" only when the page can offer templates. */
function sections(query: string, pick: (choice: Choice) => void, templates: boolean, nested = false): MenuSection[] {
  // Columns do not nest, so the entries are not offered inside one.
  const found = matchChoices(slashChoices(), query).filter(
    (choice) => (templates || choice.action.type !== "template") && !(nested && choice.action.type === "columns"),
  );
  const toItem = (choice: Choice) => ({ ...choice, boxed: true, onPick: () => pick(choice) });
  if (query.trim() !== "") return [{ items: found.map(toItem) }];
  const bySection = new Map<string, Choice[]>();
  for (const choice of found) bySection.set(choice.section, [...(bySection.get(choice.section) ?? []), choice]);
  return [...bySection].map(([title, choices]) => ({ title, items: choices.map(toItem) }));
}

class SlashMenuView {
  private popover: Popover | null = null;
  private query: string | null = null;

  constructor(
    private readonly ctx: Ctx,
    private readonly view: EditorView,
  ) {}

  update(): void {
    const query = slashQuery(this.view.state);
    if (query === null) {
      this.hide();
      return;
    }
    // Filling from a template needs an empty page: nothing but the "/query".
    const templates = templatePickerOf(this.ctx) !== null && onlySlash(this.view.state);
    const nested = inColumn(this.view.state.doc, this.view.state.selection.from);
    if (!this.popover) {
      this.popover = new Popover(sections(query, this.pick, templates, nested), {
        anchor: () => this.caretRect(),
        label: "Insert block",
        onClose: () => this.onPopoverClosed(),
      });
    } else if (query !== this.query) {
      this.popover.setSections(sections(query, this.pick, templates, nested));
    } else {
      this.popover.position();
    }
    this.query = query;
  }

  /** Keys typed in the editor while the menu is open. */
  handleKey(event: KeyboardEvent): boolean {
    if (!this.popover) return false;
    if (event.key === "Escape") {
      this.close();
      return true;
    }
    if (!["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(event.key)) return false;
    if (event.key === "Enter" && !this.popover.selected) {
      this.close();
      return false;
    }
    return this.popover.handleKey(event);
  }

  destroy(): void {
    this.hide();
  }

  private readonly pick = (choice: Choice) => this.run(choice);

  private run(choice: Choice): void {
    const { state } = this.view;
    const from = slashKey.getState(state)?.from;
    if (from == null) return;
    this.view.dispatch(state.tr.delete(from, state.selection.head).setMeta(slashKey, { close: true } satisfies SlashMeta));
    choiceCommand(choice, this.ctx)(this.view.state, this.view.dispatch, this.view);
    this.view.focus();
  }

  private close(): void {
    this.view.dispatch(this.view.state.tr.setMeta(slashKey, { close: true } satisfies SlashMeta));
  }

  private onPopoverClosed(): void {
    // Closed from outside, e.g. by a click elsewhere: close the menu state too.
    if (!this.popover) return;
    this.popover = null;
    this.query = null;
    if (slashQuery(this.view.state) !== null) this.close();
  }

  private hide(): void {
    const popover = this.popover;
    this.popover = null;
    this.query = null;
    popover?.close();
  }

  private caretRect(): Rect {
    const from = slashKey.getState(this.view.state)?.from;
    try {
      if (from != null) return this.view.coordsAtPos(from);
    } catch {
      // No layout (tests) or a stale position: fall back to the editor's corner.
    }
    return this.view.dom.getBoundingClientRect();
  }
}

export const slashMenu = $prose((ctx) => {
  let menu: SlashMenuView | null = null;
  return new Plugin<SlashState>({
    key: slashKey,
    state: {
      init: () => CLOSED,
      apply: (tr, prev, _old, state) => nextState(tr, prev, state),
    },
    props: {
      handleTextInput(view, from, to, text) {
        if (text !== "/" || !slashAllowed(view.state, from)) return false;
        view.dispatch(view.state.tr.insertText("/", from, to).setMeta(slashKey, { open: from } satisfies SlashMeta));
        return true;
      },
      // DOM keydown runs before every keymap, so Enter picks instead of
      // splitting the block. The browser's own Enter must be stopped too, or
      // it splits the block anyway and ProseMirror replays it as a key press.
      handleDOMEvents: {
        keydown: (_view, event) => {
          const used = menu?.handleKey(event) ?? false;
          if (used) event.preventDefault();
          return used;
        },
      },
    },
    view: (view) => {
      menu = new SlashMenuView(ctx, view);
      return { update: () => menu?.update(), destroy: () => menu?.destroy() };
    },
  });
});
