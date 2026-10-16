// "Add to board": the whiteboards, found as you type, or a new one. The notes
// land on the board as cards (the Library's own action); a note already on it
// stays where it is.

import { useEffect, useId, useState } from "react";

import type { BoardInfo, NoteMeta } from "../../lib/vault/types";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { Modal } from "../../ui/Modal";
import { useWorkspace } from "../workspace/store";
import { addNotesToBoard } from "./actions";

export function BoardDialog({ notes, onClose, onDone }: { notes: readonly NoteMeta[]; onClose(): void; onDone?(): void }) {
  const id = useId();
  const [boards, setBoards] = useState<BoardInfo[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    useWorkspace
      .getState()
      .client?.boards()
      .then(
        (list) => !cancelled && setBoards(list),
        () => !cancelled && setBoards([]),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  const q = text.trim().toLowerCase();
  const shown = (boards ?? []).filter((b) => !q || b.title.toLowerCase().includes(q));
  const paths = notes.map((n) => n.path);
  const go = async (board: { path: string; title: string } | { title: string }) => {
    if (busy) return;
    setBusy(true);
    await addNotesToBoard(paths, board, notes);
    onDone?.();
    onClose();
  };

  return (
    <Modal labelledBy={`${id}-title`} onClose={onClose} className="ui-dialog">
      <h2 id={`${id}-title`} className="ui-dialog-title">
        Add {notes.length === 1 ? "the note" : `${notes.length} notes`} to a board
      </h2>
      <div className="ui-dialog-body space-y-2">
        <input
          autoFocus
          className="ui-field w-full"
          aria-label="Find a board or name a new one"
          placeholder="Find a board, or name a new one"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            if (shown[0]) void go(shown[0]);
            else if (q) void go({ title: text.trim() });
          }}
        />
        <ul className="max-h-64 overflow-y-auto" aria-label="Boards">
          {boards === null && <li className="py-2 text-13 text-muted">Loading the boards…</li>}
          {boards !== null && shown.length === 0 && <li className="py-2 text-13 text-muted">{q ? "No board has that name." : "No boards yet."}</li>}
          {shown.map((board) => (
            <li key={board.path}>
              <button type="button" disabled={busy} onClick={() => void go(board)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-14 hover:bg-hover">
                <Icon name="board" className="size-4 text-muted" />
                <span className="truncate">{board.title}</span>
              </button>
            </li>
          ))}
          {q && (
            <li>
              <button type="button" disabled={busy} onClick={() => void go({ title: text.trim() })} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-14 text-accent hover:bg-hover">
                <Icon name="plus" className="size-4" />
                <span className="truncate">New board “{text.trim()}”</span>
              </button>
            </li>
          )}
        </ul>
      </div>
      <footer className="ui-dialog-foot">
        <Button onClick={onClose}>Cancel</Button>
      </footer>
    </Modal>
  );
}
