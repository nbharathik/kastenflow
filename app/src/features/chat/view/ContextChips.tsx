// A thread's context as chips above the message box, so what will be sent is
// in view before it is, in one row that scrolls sideways (the box never grows).
// Each chip has a remove button; the page being followed can be pinned to stay
// (the switch that says whether it follows is in the box's bar). A chip for
// several pages ("3 open pages") opens to list them over the box. "+ Context"
// adds more.

import "../chips.css";

import { useEffect, useRef, useState } from "react";

import type { NoteMeta } from "../../../lib/vault/types";
import { Icon } from "../../../ui/Icon";
import type { IconName } from "../../../ui/icons";
import { titleOf } from "../../workspace/names";
import { useWorkspace } from "../../workspace/store";
import { noteAt } from "../../workspace/tree";
import { useAttachments } from "../attach-store";
import { useSharing } from "../selection/sharing";
import { useChat } from "../store";
import { chipKey, originOf, type Chip, type Thread } from "../thread";
import { AddContext } from "./AddContext";
import { AttachmentChips } from "./AttachmentChips";

const ICONS: Record<Chip["kind"], IconName> = { note: "page", cards: "cards", board: "board", tag: "tag", search: "search", deck: "present", slide: "present", diagram: "diagram", latex: "sigma", pdf: "book", attachment: "attach", selection: "quote" };

/** What a chip stands for, one line per thing, when it stands for several. */
function parts(chip: Chip, notes: readonly NoteMeta[]): string[] {
  if (chip.kind === "cards") return chip.ref.map((path) => (noteAt(notes, path) ? titleOf(noteAt(notes, path)!) : path));
  // A selection lists the words themselves, so what will be sent is in view.
  if (chip.kind === "selection" && chip.selection) return [chip.selection.text];
  if (chip.kind === "pdf") {
    const named = (prefix: string) => chip.ref.find((r) => r.startsWith(prefix))?.slice(prefix.length);
    const pages = named("pages:");
    const highlights = named("highlights:");
    return [pages ? `Pages ${pages}` : "", highlights ? (highlights === "all" ? "All its highlights" : `${highlights.split(",").length} highlights`) : ""].filter(Boolean);
  }
  return [];
}

export function ContextChips({ thread, page }: { thread: Thread; page: NoteMeta | null }) {
  const notes = useWorkspace((s) => s.notes);
  // The chip that is open to list what it stands for.
  const [open, setOpen] = useState<string | null>(null);
  const listed = thread.context.find((chip) => chipKey(chip) === open);
  // The row scrolls, so a file just attached is brought into view at its end, beside + Context.
  const row = useRef<HTMLDivElement>(null);
  const waiting = useAttachments((s) => s.byThread[thread.id]?.length ?? 0);
  // A connected client may be reading the selection (see selection/share.ts).
  const shared = useSharing((s) => s.shared);
  useEffect(() => {
    if (waiting > 0 && row.current) row.current.scrollLeft = row.current.scrollWidth;
  }, [waiting]);
  // Escape puts the list away.
  useEffect(() => {
    if (!listed) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [listed]);
  return (
    <>
      <div className="kasten-chat-chips">
        <div
          ref={row}
          className="kasten-chat-chips-scroll"
          role="group"
          aria-label="Context"
          // The row has no scrollbar: the wheel moves it sideways.
          onWheel={(event) => {
            const scroller = event.currentTarget;
            if (event.deltaX === 0 && scroller.scrollWidth > scroller.clientWidth) scroller.scrollLeft += event.deltaY;
          }}
        >
          {thread.context.map((chip) => {
            const key = chipKey(chip);
            const origin = originOf(chip);
            const inside = parts(chip, notes);
            const label = <span className="kasten-chat-chip-label">{chip.label}</span>;
            return (
              <span key={key} className="kasten-chat-chip" data-kind={chip.kind} data-origin={origin} title={chip.label}>
                <span className="kasten-chat-chip-icon" aria-hidden="true">
                  <Icon name={ICONS[chip.kind]} className="size-3.5" />
                </span>
                {inside.length > 1 || ((chip.kind === "pdf" || chip.kind === "selection") && inside.length > 0) ? (
                  <button type="button" className="kasten-chat-chip-toggle" aria-expanded={open === key} aria-label={`What ${chip.label} holds`} onClick={() => setOpen(open === key ? null : key)}>
                    {label}
                    <Icon name={open === key ? "chevron-up" : "chevron-down"} className="size-3" />
                  </button>
                ) : (
                  label
                )}
                {origin !== "added" && (
                  <button
                    type="button"
                    className="kasten-chat-pin"
                    aria-label={`${origin === "pinned" ? "Unpin" : "Pin"} ${chip.label}`}
                    aria-pressed={origin === "pinned"}
                    title={origin === "pinned" ? "Pinned: it stays when the page changes. Press to let it follow again." : "Pin it, so it stays when the page changes"}
                    onClick={() => useChat.getState().pinChip(thread.id, key, origin !== "pinned")}
                  >
                    <Icon name={origin === "pinned" ? "pin" : "pin-off"} className="size-3" />
                  </button>
                )}
                <button type="button" aria-label={`Remove ${chip.label}`} onClick={() => useChat.getState().removeChip(thread.id, key)}>
                  <Icon name="close" className="size-3" />
                </button>
              </span>
            );
          })}
          <AttachmentChips thread={thread} />
        </div>
        {/* Outside the scrolling chips, so it is always there to press. */}
        <AddContext thread={thread} page={page} />
      </div>
      {shared && (
        <p className="kasten-chat-shared" role="status">
          Shared with a connected client
        </p>
      )}
      {listed && (
        <ul className="kasten-chat-chip-list" aria-label={`What ${listed.label} holds`}>
          {parts(listed, notes).map((line) => (
            <li key={line} title={line}>
              {line}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
