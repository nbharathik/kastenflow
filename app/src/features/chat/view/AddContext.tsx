// "+ Context": what a chat can be grounded in. This page (when there is
// one), any page or card, a board, a tag's view or search results. Each
// step opens above the message box and closes on Escape or a click outside.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";

import type { NoteMeta } from "../../../lib/vault/types";
import { useBoards } from "../../boards/store";
import { useOccludesElement } from "../../browser/occlusion";
import { useDiagrams } from "../../diagrams/store";
import { Picker } from "../../library/Picker";
import { schemaOf } from "../../panel/properties/schemas";
import { KIND_NAMES, vaultTags, viewsOf } from "../../tags/model";
import { useTags } from "../../tags/store";
import { iconOf, titleOf } from "../../workspace/names";
import { byModified, matchTitles } from "../../workspace/overlays/match";
import { useWorkspace } from "../../workspace/store";
import { tagCounts } from "../../workspace/tree";
import { useAttachments } from "../attach-store";
import { boardChip, cardsChip, diagramChip, noteChip, searchChip, tagChip } from "../context";
import { useOpenNotes } from "../open-pages";
import { pickFiles } from "../pick-files";
import { useChat } from "../store";
import { chipKey, type Chip, type Thread } from "../thread";
import { IconOrEmoji } from "../../../ui/IconOrEmoji";
import { lineIcon } from "../../../ui/glyph";
import { Icon } from "../../../ui/Icon";

type Step = "menu" | "page" | "board" | "diagram" | "tag" | "view" | "search";

/** Closes a popup on Escape or a press outside `within`. */
function useDismiss(within: RefObject<HTMLElement | null>, onClose: () => void): void {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const onDown = (event: PointerEvent) => !within.current?.contains(event.target as Node) && close.current();
    const onKey = (event: globalThis.KeyboardEvent) => event.key === "Escape" && close.current();
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [within]);
}

/** ↑ and ↓ move between a popup's buttons. */
function arrows(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  buttons[(at + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
  event.preventDefault();
}

export function AddContext({ thread, page }: { thread: Thread; page: NoteMeta | null }) {
  const [step, setStep] = useState<Step | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const within = useRef<HTMLSpanElement>(null);
  const notes = useWorkspace((s) => s.notes);
  const boards = useBoards((s) => s.list);
  const diagrams = useDiagrams((s) => s.list);
  const schemas = useTags((s) => s.schemas);
  const close = () => {
    setStep(null);
    setTag(null);
  };
  const add = (chip: Chip) => {
    useChat.getState().addChip(thread.id, chip);
    close();
  };
  const go = (next: Step) => {
    if (next === "board") void useBoards.getState().load();
    if (next === "diagram") void useDiagrams.getState().load();
    if (next === "tag") void useTags.getState().load();
    setStep(next);
  };
  const tags = useMemo(() => (step === "tag" ? vaultTags(tagCounts(notes), schemas ?? []) : []), [step, notes, schemas]);
  const schema = tag ? (schemaOf(schemas, tag) ?? null) : null;
  const addTag = (name: string, viewName?: string) => {
    const found = schemaOf(schemas, name) ?? null;
    const views = viewsOf(found);
    // One view (or none saved) needs no second step.
    if (viewName === undefined && views.length > 1) {
      setTag(name);
      setStep("view");
      return;
    }
    add(tagChip(name, views.find((v) => v.name === viewName) ?? (found?.views.length ? views[0]! : null)));
  };
  const hasPage = page ? thread.context.some((c) => chipKey(c) === `note:${page.path}`) : false;
  // Every page open in the panes, the side stack and a peek, as one chip.
  const open = useOpenNotes();
  const everyOpen = open.length > 1 ? { ...cardsChip(open), label: `${open.length} open pages` } : null;

  return (
    <span ref={within} className="kasten-chat-add">
      <button type="button" className="kasten-chat-add-button" aria-expanded={step !== null} aria-haspopup="menu" onClick={() => (step ? close() : setStep("menu"))}>
        + Context
      </button>
      {step === "menu" && (
        <ContextMenu within={within} onClose={close}>
          {page && (
            <button type="button" role="menuitem" disabled={hasPage} onClick={() => add(noteChip(page))}>
              <IconOrEmoji icon={iconOf(page)} />
              <span className="kasten-chat-menu-label">This page</span>
              <small>{hasPage ? "added" : titleOf(page)}</small>
            </button>
          )}
          {everyOpen && (
            <button type="button" role="menuitem" disabled={thread.context.some((c) => chipKey(c) === chipKey(everyOpen))} onClick={() => add(everyOpen)}>
              <Icon name="cards" className="size-4" />
              <span className="kasten-chat-menu-label">Every open page</span>
              <small>{open.length}</small>
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => go("page")}>
            <Icon name="page" className="size-4" />
            <span className="kasten-chat-menu-label">A page or card…</span>
          </button>
          <button type="button" role="menuitem" onClick={() => go("board")}>
            <Icon name="board" className="size-4" />
            <span className="kasten-chat-menu-label">A board…</span>
          </button>
          <button type="button" role="menuitem" onClick={() => go("diagram")}>
            <Icon name="diagram" className="size-4" />
            <span className="kasten-chat-menu-label">A diagram…</span>
          </button>
          <button type="button" role="menuitem" onClick={() => go("tag")}>
            <Icon name="tag" className="size-4" />
            <span className="kasten-chat-menu-label">A tag view…</span>
          </button>
          <button type="button" role="menuitem" onClick={() => go("search")}>
            <Icon name="search" className="size-4" />
            <span className="kasten-chat-menu-label">Search results…</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              pickFiles((files) => void useAttachments.getState().add(thread.id, files));
            }}
          >
            <Icon name="attach" className="size-4" />
            <span className="kasten-chat-menu-label">Attach a file…</span>
            <small>text, PDF, picture</small>
          </button>
        </ContextMenu>
      )}
      {step === "page" && <NotePick notes={notes} within={within} onClose={close} onPick={(note) => add(noteChip(note))} />}
      {step === "board" && (
        <Picker
          label="Add a board"
          placeholder="Find a board…"
          options={boards.map((b) => ({ key: b.path, label: b.title, icon: lineIcon("board"), detail: b.project ?? undefined }))}
          empty="No boards yet"
          within={within}
          onClose={close}
          onPick={(path) => add(boardChip(boards.find((b) => b.path === path) ?? { path, title: path }))}
        />
      )}
      {step === "diagram" && (
        <Picker
          label="Add a diagram"
          placeholder="Find a diagram…"
          options={diagrams.filter((d) => !d.problem).map((d) => ({ key: d.path, label: d.title, icon: lineIcon("diagram"), detail: d.project ?? undefined }))}
          empty="No diagrams yet"
          within={within}
          onClose={close}
          onPick={(path) => add(diagramChip(diagrams.find((d) => d.path === path) ?? { path, title: path }))}
        />
      )}
      {step === "tag" && (
        <Picker
          label="Add a tag view"
          placeholder="Find a tag…"
          options={schemas === null ? null : tags.map((t) => ({ key: t.tag, label: `#${t.tag}`, detail: `${t.count} ${t.count === 1 ? "note" : "notes"}` }))}
          empty="No tags yet"
          within={within}
          onClose={close}
          onPick={(name) => addTag(name)}
        />
      )}
      {step === "view" && tag && (
        <Picker
          label={`Add a view of #${tag}`}
          placeholder="Find a view…"
          options={viewsOf(schema).map((v) => ({ key: v.name, label: v.name, detail: KIND_NAMES[v.type] }))}
          within={within}
          onClose={close}
          onPick={(name) => addTag(tag, name)}
        />
      )}
      {step === "search" && <SearchPick within={within} onClose={close} onPick={(query) => add(searchChip(query))} />}
    </span>
  );
}

function ContextMenu({ within, onClose, children }: { within: RefObject<HTMLElement | null>; onClose: () => void; children: ReactNode }) {
  const menu = useRef<HTMLDivElement>(null);
  useDismiss(within, onClose);
  useOccludesElement(menu);
  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, []);
  return (
    <div ref={menu} role="menu" aria-label="Add context" className="kasten-chat-menu" onKeyDown={arrows}>
      <p className="kasten-chat-menu-title">Add context</p>
      {children}
    </div>
  );
}

/** Any page or card by title; the latest changed first before you type. */
export function NotePick({ notes, within, onClose, onPick }: { notes: NoteMeta[]; within: RefObject<HTMLElement | null>; onClose: () => void; onPick: (note: NoteMeta) => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(within, onClose);
  useOccludesElement(box);
  const found = useMemo(() => (query.trim() ? matchTitles(notes, query, 8) : byModified(notes).slice(0, 8)), [notes, query]);
  const current = Math.min(active, Math.max(0, found.length - 1));
  return (
    <div ref={box} role="dialog" aria-label="Add a page or card" className="kasten-chat-menu is-search">
      <input
        autoFocus
        value={query}
        aria-label="Find a page or card"
        placeholder="Find a page or card…"
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive(Math.min(current + 1, found.length - 1));
          else if (e.key === "ArrowUp") setActive(Math.max(current - 1, 0));
          else if (e.key === "Enter" && found[current]) onPick(found[current]!);
          else return;
          e.preventDefault();
        }}
      />
      <div role="listbox" aria-label="Pages and cards">
        {found.length === 0 && <p className="kasten-chat-menu-empty">Nothing matches</p>}
        {found.map((note, i) => (
          <button key={note.path} type="button" role="option" aria-selected={i === current} tabIndex={-1} onMouseMove={() => setActive(i)} onClick={() => onPick(note)}>
            <IconOrEmoji icon={iconOf(note)} />
            <span className="kasten-chat-menu-label">{titleOf(note)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A search whose top results go along, such as `diff metric` or `tag:paper`. */
function SearchPick({ within, onClose, onPick }: { within: RefObject<HTMLElement | null>; onClose: () => void; onPick: (query: string) => void }) {
  const [query, setQuery] = useState("");
  const box = useRef<HTMLFormElement>(null);
  useDismiss(within, onClose);
  useOccludesElement(box);
  return (
    <form
      ref={box}
      role="dialog"
      aria-label="Add search results"
      className="kasten-chat-menu is-search"
      onSubmit={(e) => {
        e.preventDefault();
        if (query.trim()) onPick(query);
      }}
    >
      <input autoFocus value={query} aria-label="Search for" placeholder="Search for…" onChange={(e) => setQuery(e.target.value)} />
      <p className="kasten-chat-menu-hint">The top eight results go with each message.</p>
      <button type="submit" className="kasten-chat-menu-add" disabled={!query.trim()}>
        Add results
      </button>
    </form>
  );
}
