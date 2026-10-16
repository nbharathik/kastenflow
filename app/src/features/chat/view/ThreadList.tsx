// The chat's threads, the latest first: a list beside the conversation, or a
// menu in its header when the pane is narrow. A thread that works pulses a dot;
// one that stopped short, failed, or finished while you were elsewhere says
// so. Threads kept from an earlier run are listed too and open when pressed.

import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { Menu, openRowMenu } from "../../../shell/Menu";
import { Icon } from "../../../ui/Icon";
import { saveChat } from "../actions";
import { useChat } from "../store";
import { matchesThread, threadStatus, threadTitle, type ThreadStatus } from "../thread";
import { STATUS_WORDS, useUnread } from "../unread";

interface Row {
  id: string;
  title: string;
  streaming: boolean;
  /** Nothing asked yet: nothing to save or remove. */
  empty: boolean;
  /** Kept from an earlier run and not opened in this window yet. */
  kept: boolean;
  status: ThreadStatus;
}

const SEP = "\u0001";

/** A summary's status as a thread's. */
const KEPT_STATUS: Record<string, ThreadStatus> = { running: "working", paused: "paused", interrupted: "interrupted", error: "failed", idle: "idle" };

/** Threads worth listing: those with messages, and the open one; then those kept from an earlier run. As
 * strings, so a streaming answer does not redraw the list. */
function useRows(active: string | null): Row[] {
  const keys = useChat(
    useShallow((s) => [
      ...s.order.flatMap((id) => {
        const t = s.threads[id];
        if (!t || (t.messages.length === 0 && id !== active)) return [];
        return [[id, t.streaming ? "1" : "", t.messages.length ? "" : "1", "", threadStatus(t), threadTitle(t)].join(SEP)];
      }),
      ...Object.values(s.saved)
        .filter((k) => !s.threads[k.id])
        .sort((a, b) => b.updated - a.updated)
        .map((k) => [k.id, k.status === "running" ? "1" : "", "", "1", KEPT_STATUS[k.status] ?? "idle", k.title || "Chat"].join(SEP)),
    ]),
  );
  return useMemo(
    () =>
      keys.map((key) => {
        const [id = "", streaming, empty, kept, status = "idle", title = ""] = key.split(SEP);
        return { id, title, streaming: Boolean(streaming), empty: Boolean(empty), kept: Boolean(kept), status: status as ThreadStatus };
      }),
    [keys],
  );
}

export function newChat(): void {
  const chat = useChat.getState();
  const current = chat.active ? chat.threads[chat.active] : undefined;
  // An empty chat is new enough.
  if (current && current.messages.length === 0) return;
  chat.start({ open: true });
}

/** What a row says of its thread, if anything: what it is doing, or what finished since you looked. */
function useStatusWord(id: string, status: ThreadStatus): string {
  const unseen = useUnread((s) => s.unseen[id]);
  if (status === "done") return unseen ? STATUS_WORDS.done : "";
  return STATUS_WORDS[status];
}

export function ThreadList({ active }: { active: string }) {
  const rows = useRows(active);
  const [query, setQuery] = useState("");
  // Read when the query changes or the list does, not as an answer streams.
  const hit = (id: string) => {
    const thread = useChat.getState().threads[id];
    return thread ? matchesThread(thread, query) : useChat.getState().saved[id]?.title.toLowerCase().includes(query.trim().toLowerCase()) === true;
  };
  const shown = query.trim() ? rows.filter((row) => hit(row.id)) : rows;
  return (
    <aside className="kasten-chat-threads" aria-label="Chats">
      <button type="button" className="kasten-chat-new" onClick={newChat}>
        <span aria-hidden="true">+</span> New chat
      </button>
      {rows.length > 1 && (
        <input type="search" className="kasten-chat-threads-search" aria-label="Search chats" placeholder="Search chats" value={query} onChange={(event) => setQuery(event.target.value)} />
      )}
      <p className="kasten-chat-threads-label">{query.trim() ? `${shown.length} found` : "Chats"}</p>
      <ul>
        {shown.map((row) => (
          <Item key={row.id} row={row} active={active} />
        ))}
      </ul>
      <p className="kasten-chat-threads-hint">Chats are kept on this computer, not in your vault. Save one to keep it in chats/.</p>
    </aside>
  );
}

function Item({ row, active }: { row: Row; active: string }) {
  const word = useStatusWord(row.id, row.status);
  const unseen = useUnread((s) => s.unseen[row.id]);
  return (
    <li onContextMenu={openRowMenu} data-status={row.status}>
      <button type="button" aria-label={row.title} aria-description={word || undefined} aria-current={row.id === active ? "true" : undefined} onClick={() => useChat.getState().open(row.id)}>
        <span className="kasten-chat-thread-title">
          {row.streaming && <span className="kasten-chat-live" role="img" aria-label="Answering" />}
          {unseen && !row.streaming && <span className="kasten-chat-unseen" role="img" aria-label="Not seen yet" data-outcome={unseen} />}
          {row.title}
        </span>
        {word && (
          <small className="kasten-chat-thread-status" data-status={row.status} aria-hidden="true">
            {word}
          </small>
        )}
      </button>
      {!row.empty && (
        <Menu
          label={`More for ${row.title}`}
          float
          buttonClass="kasten-chat-thread-more"
          items={[
            // Saving as a note needs the thread in this window.
            ...(row.kept ? [] : [{ label: "Save chat", onSelect: () => void saveChat(row.id) }]),
            // The backend forgets it too; what it changed stays in History.
            { label: "Remove from the list", onSelect: () => void (row.kept ? useChat.getState().removeSaved(row.id) : useChat.getState().discard(row.id)) },
          ]}
        >
          <Icon name="more" className="size-4" />
        </Menu>
      )}
    </li>
  );
}

/** The same threads as a menu, for a narrow pane. */
export function ThreadMenu({ active }: { active: string }) {
  const rows = useRows(active);
  // The menu tells items apart by their words: the same question twice gets a number.
  const seen = new Map<string, number>();
  const items = rows.map((row) => {
    const n = (seen.get(row.title) ?? 0) + 1;
    seen.set(row.title, n);
    const label = n > 1 ? `${row.title} (${n})` : row.title;
    const note = row.status === "working" ? " · working" : row.status === "paused" || row.status === "interrupted" || row.status === "failed" ? ` · ${STATUS_WORDS[row.status].toLowerCase()}` : "";
    return { label: row.id === active ? `${label} ✓` : `${label}${note}`, onSelect: () => useChat.getState().open(row.id) };
  });
  return (
    <span className="kasten-chat-thread-menu">
      <Menu label="Chats" align="left" buttonClass="kasten-chat-head-button" items={[{ label: "New chat", icon: <Icon name="plus" className="size-4" />, onSelect: newChat }, "divider", ...items]}>
        Chats <Icon name="chevron-down" className="size-3.5" />
      </Menu>
    </span>
  );
}
