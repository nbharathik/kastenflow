// The chats that work or paused, from the Chat button: each row is the chat's name, what it is doing and the document it is tied to.
// A click opens the document and the chat (a deck opens with its assistant panel). Loaded when the popover first opens.

import "../features/pages/editor/styles/tokens.css";
import "../features/pages/page/popups.css";

import { type RefObject, useMemo } from "react";

import { useChat } from "../features/chat/store";
import { threadStatus, threadTitle } from "../features/chat/thread";
import { STATUS_WORDS } from "../features/chat/unread";
import { Popup } from "../features/pages/page/Popup";
import { wantAssistant } from "../features/slides/deck-ui";
import { deckTitle, useDecks } from "../features/slides/store";
import { useShell } from "../lib/store";
import { useWorkspace } from "../features/workspace/store";
import { noteAt } from "../features/workspace/tree";
import { Icon } from "../ui/Icon";
import { type RunningRow, runningRows, useRunningChats } from "./running-chats";

/** The open tab showing this document, if any. */
function tabOfPath(path: string): { paneId: string; tabId: string } | undefined {
  for (const pane of useWorkspace.getState().layout.panes) {
    const tab = pane.tabs.find((t) => t.place.path === path);
    if (tab) return { paneId: pane.id, tabId: tab.id };
  }
  return undefined;
}

/** Opens the chat's document (its tab comes forward, or it opens in a tab) and the chat itself. */
export function openRunning(row: RunningRow): void {
  const ws = useWorkspace.getState();
  if (row.bound) {
    // A deck shows its chat in its assistant panel.
    if (row.bound.kind === "deck") wantAssistant(row.bound.path);
    const open = tabOfPath(row.bound.path);
    if (open) ws.selectTab(open.paneId, open.tabId);
    else ws.openPath(row.bound.path, "tab");
  }
  if (row.bound?.kind !== "deck") {
    useChat.getState().open(row.id);
    useShell.getState().toggleChat(true);
  }
  useRunningChats.getState().show(false);
}

function Row({ row }: { row: RunningRow }) {
  const decks = useDecks((s) => s.list);
  const notes = useWorkspace((s) => s.notes);
  const doc = row.bound ? (row.bound.kind === "deck" ? deckTitle(decks, row.bound.path) : (noteAt(notes, row.bound.path)?.title ?? row.bound.path.slice(row.bound.path.lastIndexOf("/") + 1))) : null;
  const word = STATUS_WORDS[row.status];
  return (
    <li>
      <button type="button" className="kasten-running-row flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" onClick={() => openRunning(row)}>
        <span className={`size-2 shrink-0 rounded-full ${row.status === "working" ? "bg-accent motion-safe:animate-pulse" : "bg-warning"}`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-13 font-medium">{doc ?? row.title}</span>
          <span className="block truncate text-12 text-muted">
            {word}
            {doc ? ` · ${row.title}` : ""}
          </span>
        </span>
        <Icon name="chevron" className="size-4 shrink-0 text-muted" />
      </button>
    </li>
  );
}

/** The popover itself. `anchor` is the button that opened it, which keeps its own clicks. */
export default function RunningChats({ anchor }: { anchor: RefObject<HTMLElement | null> }) {
  const threads = useChat((s) => s.threads);
  const rows = useMemo(() => runningRows(threads, threadStatus, threadTitle), [threads]);
  return (
    <Popup label="Running chats" anchor={anchor} onClose={() => useRunningChats.getState().show(false)} className="top-full right-0 mt-1 w-80 max-w-[calc(100vw-1rem)] p-1">
      <h2 className="px-2 pb-1 pt-1.5 text-12 font-medium text-muted">Running chats</h2>
      {rows.length === 0 ? (
        <div className="px-2 pb-2 pt-1 text-13 text-muted">
          <p>No chat is working right now.</p>
          <button type="button" className="mt-2 rounded-md px-2 py-1 text-13 text-ink hover:bg-hover" onClick={() => {
              useShell.getState().toggleChat(true);
              useRunningChats.getState().show(false);
            }}>
            Open Chat
          </button>
        </div>
      ) : (
        <ul className="max-h-[60vh] overflow-auto">
          {rows.map((row) => (
            <Row key={row.id} row={row} />
          ))}
        </ul>
      )}
    </Popup>
  );
}
