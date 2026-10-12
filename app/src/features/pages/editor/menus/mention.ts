// Link autocomplete, as in Notion: `[[` lists pages to link (or creates one),
// and `@` offers dates and times, people, pages, whiteboards, decks and tags
// (mention-sections.ts). The pick replaces what was typed with a `[[link]]`.

import type { Ctx } from "@milkdown/kit/ctx";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

import { isoDay } from "../../../../lib/dates";
import type { TagViewKind } from "../../../../lib/vault/types";
import { linksOf, retarget } from "../links";
import { databaseLabel, databaseSections } from "./database-menu";
import { markSpot, takeSpot } from "./embed-spot";
import { boardSections, headingSections, sections, type Trigger } from "./mention-sections";
import type { Rect } from "../ui/dom";
import { Popover } from "../ui/popover";

// A trigger is `[[` (link a page), `@` (a date, person, page, whiteboard,
// deck or tag: `mention`), or one of the slash menu's: `page` names a new
// sub-page (/page), `embed` picks a page to show in place (/embed), `board` a
// whiteboard to embed (/whiteboard) and `database` a tag database (/database,
// or /table view and the other views).

interface MentionState {
  /** Where the typed `[[` or `@` starts while the menu is open. */
  from: number | null;
  trigger: Trigger;
  /** Opened from the slash menu or a handle, as a block of its own: a link
   * that fills its line stays alone there, a page block (wikilink-view.ts). */
  block?: boolean;
  /** A database picked here opens on a view of this kind. */
  view?: TagViewKind;
}

type MentionMeta = { open: number; trigger: Trigger; block?: boolean; view?: TagViewKind } | { close: true };

export const mentionKey = new PluginKey<MentionState>("KASTEN_MENTION");
const CLOSED: MentionState = { from: null, trigger: "link" };
const MAX_QUERY = 60;

export { isoDay };

/** What was typed after the trigger, or null when the menu is closed. */
export function mentionQuery(state: EditorState): string | null {
  const { from, trigger } = mentionKey.getState(state) ?? CLOSED;
  if (from == null) return null;
  return state.doc.textBetween(from + (trigger === "mention" ? 1 : 2), state.selection.head, "\n", "￼");
}

function nextState(tr: Transaction, prev: MentionState, state: EditorState): MentionState {
  const meta = tr.getMeta(mentionKey) as MentionMeta | undefined;
  if (meta && "close" in meta) return CLOSED;
  if (meta && "open" in meta) return { from: meta.open, trigger: meta.trigger, block: meta.block, view: meta.view };
  if (prev.from === null) return prev;
  const mapped = tr.mapping.mapResult(prev.from, 1);
  const { selection, doc } = state;
  const start = prev.trigger === "mention" ? mapped.pos + 1 : mapped.pos + 2;
  if (mapped.deleted || !selection.empty || selection.head < start) return CLOSED;
  const typed = doc.textBetween(mapped.pos, start);
  if (typed !== (prev.trigger === "mention" ? "@" : "[[") || doc.resolve(mapped.pos).parent !== selection.$head.parent) return CLOSED;
  const query = doc.textBetween(start, selection.head, "\n", "￼");
  if (query.length > MAX_QUERY || /[\]\n]/.test(query) || (prev.trigger === "mention" && /^\s|\s\s/.test(query))) return CLOSED;
  return { from: mapped.pos, trigger: prev.trigger, block: prev.block, view: prev.view };
}

class MentionMenuView {
  private popover: Popover | null = null;
  private query: string | null = null;

  constructor(
    private readonly ctx: Ctx,
    private readonly view: EditorView,
  ) {}

  update(): void {
    const query = mentionQuery(this.view.state);
    if (query === null) return this.hide();
    const { trigger, view: kind } = mentionKey.getState(this.view.state)!;
    const links = linksOf(this.ctx);
    const build = () =>
      trigger === "board"
        ? boardSections(query, links, (path, title) => this.embedBoard(path, title))
        : trigger === "database"
          ? databaseSections(query, links, kind, (link) => this.embedLater(link, "Adding the database…"))
          : trigger === "embed"
            ? sections(trigger, query, links, (value) => this.embedLater(value, ""))
            : ((trigger === "link" || trigger === "mention") && headingSections(query, links, (value) => this.insert(value), () => this.redraw())) ||
              sections(trigger, query, links, (value, create, after) => this.insert(value, create, after));
    if (!this.popover) {
      this.popover = new Popover(build(), {
        anchor: () => this.caretRect(),
        label: trigger === "mention" ? "Mention" : trigger === "page" ? "New page" : trigger === "embed" ? "Embed a page" : trigger === "board" ? "Embed a whiteboard" : trigger === "database" ? databaseLabel(kind) : "Link to page",
        emptyText:
          trigger === "page"
            ? "Type the new page's name"
            : trigger === "board"
              ? "No whiteboards match"
              : trigger === "database"
                ? kind
                  ? "Type a name for a new database"
                  : "No tag has a database yet: give one properties in the Tag Database"
                : trigger === "mention"
                  ? "No dates or pages match"
                  : "No pages match",
        onClose: () => this.onPopoverClosed(),
      });
    } else if (query !== this.query) this.popover.setSections(build());
    else this.popover.position();
    this.query = query;
  }

  /** Builds the menu again for what is typed now, as when headings come in. */
  private redraw(): void {
    this.query = null;
    this.update();
  }

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

  /** Puts a link with `value` where `[[` or `@` was typed, then `after` (a
   * time, as plain text); with `create`, makes that page first, and names it
   * once it is made. */
  private insert(value: string, create?: string, after = ""): void {
    const { state } = this.view;
    const from = mentionKey.getState(state)?.from;
    const type = state.schema.nodes.wiki_link;
    if (from == null || !type) return;
    if (create) {
      const links = linksOf(this.ctx);
      void Promise.resolve(links.create?.(create)).then((page) => {
        const text = page ? links.linkText?.(page) : undefined;
        if (text && text !== value) nameMade(this.view, from, value, text, create);
      });
    }
    const link = type.create({ value, embed: false });
    const $from = state.doc.resolve(from);
    // From the slash menu, a link that fills its line is a page block: it
    // stays alone there, and writing goes on in a new line below.
    const whole = mentionKey.getState(state)?.block && $from.parent.type.name === "paragraph" && $from.parentOffset === 0 && state.selection.head === $from.end();
    const tr = state.tr.replaceWith(from, state.selection.head, link).setMeta(mentionKey, { close: true } satisfies MentionMeta);
    if (whole) {
      const below = tr.mapping.map($from.after());
      tr.insert(below, state.schema.nodes.paragraph!.create()).setSelection(TextSelection.create(tr.doc, below + 1));
    } else tr.insertText(`${after} `);
    this.view.dispatch(tr.scrollIntoView());
    this.view.focus();
  }

  /** Replaces what was typed with an embed of the whiteboard at `path`, on
   * a line of its own; with no path a new board is made. */
  private embedBoard(path: string | null, title: string): void {
    this.embedLater(path ?? linksOf(this.ctx).createBoard?.(title || "Whiteboard") ?? Promise.resolve(null), "Making the whiteboard…");
  }

  /** Closes the menu, taking what was typed away, and places `![[link]]`
   * there on a line of its own once the link is known. A spot marks the
   * place meanwhile and moves with the edits made around it. */
  private embedLater(link: string | Promise<string | null>, waiting: string): void {
    const { view } = this;
    const { state } = view;
    const from = mentionKey.getState(state)?.from;
    if (from == null) return;
    view.dispatch(state.tr.delete(from, state.selection.head).setMeta(mentionKey, { close: true } satisfies MentionMeta));
    if (typeof link === "string") return placeEmbed(view, from, link);
    const spot = markSpot(view, from, waiting);
    void link.then(
      (value) => {
        const at = takeSpot(view, spot);
        if (!value || at < 0) return;
        // The caret follows only if it is still where the embed was asked for.
        const { selection } = view.state;
        placeEmbed(view, at, value, selection.empty && selection.from === at);
      },
      () => takeSpot(view, spot),
    );
  }

  private close(): void {
    this.view.dispatch(this.view.state.tr.setMeta(mentionKey, { close: true } satisfies MentionMeta));
  }

  private onPopoverClosed(): void {
    if (!this.popover) return;
    this.popover = null;
    this.query = null;
    if (mentionQuery(this.view.state) !== null) this.close();
  }

  private hide(): void {
    const popover = this.popover;
    this.popover = null;
    this.query = null;
    popover?.close();
  }

  private caretRect(): Rect {
    const from = mentionKey.getState(this.view.state)?.from;
    try {
      if (from != null) return this.view.coordsAtPos(from);
    } catch {
      // No layout in tests.
    }
    return this.view.dom.getBoundingClientRect();
  }
}

/** Puts `![[board]]` (or a page's `![[Title]]`) at `pos`: in its paragraph when that is empty, else as
 * a paragraph after it, with an empty one to go on writing in after, where
 * the caret goes unless `caret` is false. */
export function placeEmbed(view: EditorView, pos: number, board: string, caret = true): void {
  const { state } = view;
  const link = state.schema.nodes.wiki_link?.create({ value: board, embed: true });
  const paragraph = state.schema.nodes.paragraph;
  if (!link || !paragraph) return;
  const $pos = state.doc.resolve(pos);
  const tr = state.tr;
  let end: number;
  if ($pos.parent.type === paragraph && $pos.parent.content.size === 0) {
    tr.insert(pos, link);
    end = $pos.after() + 1;
  } else {
    const after = $pos.depth > 0 ? $pos.after() : pos;
    tr.insert(after, paragraph.create(null, link));
    end = after + link.nodeSize + 2;
  }
  if (end >= tr.doc.content.size || tr.doc.resolve(end).nodeAfter?.type !== paragraph) tr.insert(Math.min(end, tr.doc.content.size), paragraph.create());
  if (!caret) return view.dispatch(tr);
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(end + 1, tr.doc.content.size))));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** Types `[[` at `pos` and opens the link menu, for the slash menu's
 * "Page" (name a new sub-page), "Link to page", "Embed a page",
 * "Whiteboard", "Database" and the database views (`kind`). */
export function startLink(view: EditorView, pos: number, trigger: "link" | "page" | "embed" | "board" | "database", kind?: TagViewKind): void {
  const tr = view.state.tr.insertText("[[", pos);
  tr.setSelection(TextSelection.create(tr.doc, pos + 2)).setMeta(mentionKey, { open: pos, trigger, block: true, view: kind } satisfies MentionMeta);
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** Whether `text` typed at `pos` starts a menu, and which. */
function triggerAt(state: EditorState, pos: number, text: string): { trigger: Trigger; from: number } | null {
  const $pos = state.doc.resolve(pos);
  if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) return null;
  const before = $pos.parent.textBetween(Math.max(0, $pos.parentOffset - 1), $pos.parentOffset, "\n", "￼");
  if (text === "[" && before === "[") return { trigger: "link", from: pos - 1 };
  if (text === "@" && (before === "" || /\s/.test(before))) return { trigger: "mention", from: pos };
  return null;
}

export const mentionMenu = $prose((ctx) => {
  let menu: MentionMenuView | null = null;
  return new Plugin<MentionState>({
    key: mentionKey,
    state: { init: () => CLOSED, apply: (tr, prev, _old, state) => nextState(tr, prev, state) },
    props: {
      handleTextInput(view, from, to, text) {
        const trigger = triggerAt(view.state, from, text);
        if (!trigger) return false;
        view.dispatch(view.state.tr.insertText(text, from, to).setMeta(mentionKey, { open: trigger.from, trigger: trigger.trigger } satisfies MentionMeta));
        return true;
      },
      handleDOMEvents: {
        keydown: (_view, event) => {
          const used = menu?.handleKey(event) ?? false;
          if (used) event.preventDefault();
          return used;
        },
      },
    },
    view: (view) => {
      menu = new MentionMenuView(ctx, view);
      return { update: () => menu?.update(), destroy: () => menu?.destroy() };
    },
  });
});

/** Once a page made from the menu exists, the link put in for it names it
 * by path when its title alone would find another page: the link with
 * `value` nearest to `near`. */
function nameMade(view: EditorView, near: number, value: string, text: string, title: string): void {
  const found: number[] = [];
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === "wiki_link" && node.attrs.value === value) found.push(pos);
  });
  if (found.length === 0) return;
  const pos = found.reduce((a, b) => (Math.abs(b - near) < Math.abs(a - near) ? b : a));
  const node = view.state.doc.nodeAt(pos)!;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, value: retarget(value, text, title) }));
}
