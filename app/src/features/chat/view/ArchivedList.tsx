// The Archived section of the Chat view's list. A chat the list's size pushed
// out is archived, not deleted: it is saved and opens when pressed, and a
// message sent in it brings it back to the list. The section is searchable.
// "Delete archived chats…" removes them for good, after saying how many: it is
// the only thing here that asks first.

import "../history.css";

import { useState } from "react";

import { Menu, openRowMenu } from "../../../shell/Menu";
import { Icon } from "../../../ui/Icon";
import { useWorkspace } from "../../workspace/store";
import { useChat } from "../store";

export interface ArchivedRow {
  id: string;
  title: string;
}

/** The words of a refusal for one chat, in one sentence for a toast. */
function skippedSentence(skipped: { id: string; reason: string }[]): string {
  const first = skipped[0]?.reason ?? "";
  return skipped.length === 1 ? `1 chat was kept: ${first}` : `${skipped.length} chats were kept. ${first}`;
}

export function ArchivedList({ rows, active, matches }: { rows: ArchivedRow[]; active: string; matches: (id: string, query: string) => boolean }) {
  const [query, setQuery] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (rows.length === 0) return null;
  const shown = query.trim() ? rows.filter((row) => matches(row.id, query)) : rows;

  const remove = async () => {
    setBusy(true);
    try {
      const result = await useChat.getState().deleteArchived(rows.map((row) => row.id));
      if (result.skipped.length > 0) useWorkspace.getState().toast(skippedSentence(result.skipped));
    } catch (err) {
      useWorkspace.getState().toast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setAsking(false);
    }
  };

  return (
    <details className="kasten-chat-archived">
      <summary>
        <Icon name="archive" className="size-3.5" />
        Archived ({rows.length})
      </summary>
      <div className="kasten-chat-archived-tools">
        <input type="search" className="kasten-chat-threads-search" aria-label="Search archived chats" placeholder="Search archived chats" value={query} onChange={(event) => setQuery(event.target.value)} />
        {asking ? (
          <div className="kasten-chat-confirm" role="alertdialog" aria-label="Delete archived chats?" onKeyDown={(event) => event.key === "Escape" && setAsking(false)}>
            <span>
              Delete {rows.length} archived {rows.length === 1 ? "chat" : "chats"} for good? They cannot be brought back.
            </span>
            <span className="kasten-chat-confirm-actions">
              <button type="button" className="ui-btn is-danger is-sm" autoFocus disabled={busy} onClick={() => void remove()}>
                {busy ? "Deleting…" : `Delete ${rows.length}`}
              </button>
              <button type="button" className="ui-btn is-sm" onClick={() => setAsking(false)}>
                Cancel
              </button>
            </span>
          </div>
        ) : (
          <button type="button" className="kasten-chat-archived-delete" onClick={() => setAsking(true)}>
            Delete archived chats…
          </button>
        )}
      </div>
      {shown.length === 0 && <p className="kasten-chat-archived-empty">No archived chat has those words.</p>}
      <ul>
        {shown.map((row) => (
          <li key={row.id} onContextMenu={openRowMenu}>
            <button type="button" aria-label={row.title} aria-current={row.id === active ? "true" : undefined} onClick={() => useChat.getState().open(row.id)}>
              <span className="kasten-chat-thread-title">{row.title}</span>
            </button>
            <Menu label={`More for ${row.title}`} float buttonClass="kasten-chat-thread-more" items={[{ label: "Move back to the list", onSelect: () => void useChat.getState().unarchive(row.id) }]}>
              <Icon name="more" className="size-4" />
            </Menu>
          </li>
        ))}
      </ul>
    </details>
  );
}
