// The "+" at the foot of the tool strip: what else goes on a board. A new
// card, a link, a note that already exists, a board inside this one, and what
// a double-click on empty space makes (a card or a sticky, remembered).

import { useCallback, useRef, useState } from "react";

import { Segmented } from "../../../../ui/Segmented";
import { NoteFinder } from "../../../stack/NoteFinder";
import { useBoardPrefs, type DoubleClickMakes } from "../../board-prefs";
import { useBoard } from "../context";
import { centredAt, type Point } from "../model/placement";
import { EXPANDED } from "../state/gestures";
import { addLink, addNotes, newCard } from "../state/making";
import { BoardPicker } from "./BoardPicker";
import { closeOnEscape, focusBoard, focusFirst, moveAlong, useDismiss } from "./dismiss";
import { ToolIcon, type ToolIconName } from "./icons";

type View = "list" | "link" | "note" | "board";

const CHOICES: { value: DoubleClickMakes; label: string }[] = [
  { value: "card", label: "Card" },
  { value: "sticky", label: "Sticky" },
];

function Row({ icon, label, hint, onClick }: { icon: ToolIconName; label: string; hint?: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" className="kasten-board-menu-item" onClick={onClick}>
      <ToolIcon name={icon} className="size-4" />
      <span className="flex-1">{label}</span>
      {hint && <span className="kasten-board-menu-hint">{hint}</span>}
    </button>
  );
}

export function AddMenu({ centre }: { centre: () => Point }) {
  const board = useBoard();
  const doubleClick = useBoardPrefs((s) => s.doubleClick);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("list");
  const root = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setView("list");
  }, []);
  useDismiss(open, root, close);
  const done = () => {
    close();
    focusBoard(root.current);
  };
  return (
    <span ref={root} className="relative inline-flex" onKeyDown={closeOnEscape(open, close)}>
      <button type="button" className="kasten-tool" aria-label="Add" aria-haspopup="menu" aria-expanded={open} title="Add a card, link, note or board" onClick={() => (open ? close() : setOpen(true))}>
        <ToolIcon name="plus" />
      </button>
      {open && view === "list" && (
        <div ref={focusFirst} className="kasten-pop kasten-beside kasten-add" role="menu" aria-label="Add to the board" onKeyDown={moveAlong}>
          <Row
            icon="card"
            label="New card"
            hint="C"
            onClick={() => {
              done();
              void newCard(board, centredAt(centre(), EXPANDED));
            }}
          />
          <Row icon="link" label="Link…" onClick={() => setView("link")} />
          <Row icon="note" label="Note…" hint="or drag notes in" onClick={() => setView("note")} />
          <Row icon="board" label="Board inside this board…" onClick={() => setView("board")} />
          <hr className="kasten-board-menu-divider" />
          <div className="kasten-add-choice">
            <span>Double-click makes</span>
            <Segmented label="Double-click makes" value={doubleClick} choices={CHOICES} onChange={(value) => useBoardPrefs.getState().set({ doubleClick: value })} />
          </div>
        </div>
      )}
      {open && view === "link" && (
        <div role="dialog" aria-label="Add a link" className="kasten-pop kasten-beside kasten-add">
          <LinkForm
            onDone={(url) => {
              done();
              if (url) void addLink(board, url, centre());
            }}
          />
        </div>
      )}
      {open && view === "note" && (
        <div role="dialog" aria-label="Add a note" className="kasten-pop kasten-beside kasten-add">
          <NoteFinder
            autoFocus
            placeholder="Find a note to add…"
            onPick={(path) => {
              done();
              void addNotes(board, [path], centre());
            }}
          />
        </div>
      )}
      {open && view === "board" && (
        <div className="kasten-beside">
          <BoardPicker within={root} centre={centre} onClose={done} />
        </div>
      )}
    </span>
  );
}

function LinkForm({ onDone }: { onDone: (url: string | null) => void }) {
  const [url, setUrl] = useState("");
  return (
    <form
      className="flex items-center gap-2 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        onDone(url.trim() || null);
      }}
    >
      <input
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone(null)}
        placeholder="https://"
        aria-label="Web address"
        className="h-8 w-64 rounded-md border border-line bg-canvas px-2 text-13 outline-none focus:border-accent/60"
      />
      <button type="submit" className="h-8 rounded-md bg-accent px-3 text-13 font-medium text-on-accent disabled:opacity-40" disabled={!url.trim()}>
        Add
      </button>
    </form>
  );
}
