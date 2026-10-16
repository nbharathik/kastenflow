// What waits to go with the next message, as chips in the box's one row of
// context: a picture drawn small, or an icon and "name · size", or "Pasted text
// · 4,210 chars". Pressing a chip looks at it; a long paste can go back into the
// box as text. A file that could not be used stays as a chip that says why until
// it is dismissed. A picture for a model that may not see it says so.

import "../attachments.css";

import { useEffect, useRef, useState } from "react";

import { Icon } from "../../../ui/Icon";
import { useAttachments, type Attached } from "../attach-store";
import { capabilitiesOf, pictures } from "../capabilities";
import { modelFor } from "../prefs";
import { useChat } from "../store";
import type { Thread } from "../thread";
import { AttachmentViewer } from "./AttachmentViewer";

type Sight = "reads" | "unsure" | "blind";

/** The box listens for this: a pasted text given back goes where the caret is. */
export const INSERT_TEXT = "kasten:chat-insert-text";

/** Whether the thread's model can see pictures; it reads them when that is not known to be otherwise. */
function useSight(thread: Thread): Sight {
  const providers = useChat((s) => s.providers);
  const choice = modelFor(thread, providers);
  const provider = choice?.provider;
  const model = choice?.model;
  const [sight, setSight] = useState<Sight>("reads");
  useEffect(() => {
    if (!provider || !model) return;
    let live = true;
    void capabilitiesOf(useChat.getState().ensure(), provider, model).then((caps) => live && setSight(caps ? pictures(caps) : "reads"));
    return () => {
      live = false;
    };
  }, [provider, model]);
  return sight;
}

const WORDS: Record<Exclude<Sight, "reads">, string> = {
  unsure: "This model may not read pictures.",
  blind: "This model can't read pictures.",
};

/** A long paste put back in the box as text; its chip goes. */
function insertAsText(thread: string, key: string): void {
  const text = useAttachments.getState().asText(thread, key);
  if (text !== null) window.dispatchEvent(new CustomEvent<{ thread: string; text: string }>(INSERT_TEXT, { detail: { thread, text } }));
}

export function AttachmentChips({ thread }: { thread: Thread }) {
  const items = useAttachments((s) => s.byThread[thread.id]);
  const sight = useSight(thread);
  const [looking, setLooking] = useState<string | null>(null);
  // The chip pressed, which the popover is placed by and gives the focus back to.
  const anchor = useRef<HTMLElement | null>(null);
  if (!items?.length) return null;
  const viewed = items.find((a) => a.key === looking && a.state !== "busy");
  return (
    <>
      {items.map((item) => (
        <Chip
          key={item.key}
          item={item}
          thread={thread}
          warn={item.kind === "image" && sight !== "reads" && !(sight === "unsure" && thread.allowImages) ? WORDS[sight] : null}
          open={looking === item.key}
          onLook={(button) => {
            anchor.current = button;
            setLooking(looking === item.key ? null : item.key);
          }}
        />
      ))}
      {viewed && (
        <AttachmentViewer
          // A file that could not be used shows the whole sentence that says why (the chip is too narrow for it).
          item={viewed.state === "error" ? { name: viewed.name, kind: "text", label: viewed.name, pasted: viewed.error } : { id: viewed.id, name: viewed.name, kind: viewed.kind ?? "text", label: viewed.label, note: viewed.note, thumb: viewed.thumb, pasted: viewed.pasted }}
          anchor={anchor}
          onClose={() => setLooking(null)}
        >
          <div className="kasten-chat-viewer-actions">
            {viewed.pasted !== undefined && (
              <button
                type="button"
                onClick={() => {
                  setLooking(null);
                  insertAsText(thread.id, viewed.key);
                }}
              >
                Insert as text instead
              </button>
            )}
            {viewed.kind === "image" && sight !== "reads" && (
              <>
                <p className="kasten-chat-viewer-note">{WORDS[sight]}</p>
                {sight === "unsure" && (
                  <label>
                    <input type="checkbox" checked={Boolean(thread.allowImages)} onChange={(event) => useChat.getState().setAllowImages(thread.id, event.target.checked)} />
                    Send pictures to this model anyway
                  </label>
                )}
              </>
            )}
          </div>
        </AttachmentViewer>
      )}
    </>
  );
}

function Chip({ item, thread, warn, open, onLook }: { item: Attached; thread: Thread; warn: string | null; open: boolean; onLook(button: HTMLButtonElement): void }) {
  const ready = item.state === "ready";
  return (
    <span
      className="kasten-chat-chip kasten-chat-attachment"
      data-kind="attachment"
      data-state={item.state}
      data-warn={warn ? "" : undefined}
      role={item.state === "error" ? "status" : undefined}
      title={item.state === "error" ? item.error : [item.label, item.note, warn].filter(Boolean).join(" · ")}
    >
      {item.state === "busy" && <span className="kasten-chat-spinner" aria-hidden="true" />}
      {item.state === "error" && (
        <span className="kasten-chat-chip-icon" aria-hidden="true">
          <Icon name="alert" className="size-3.5" />
        </span>
      )}
      {ready &&
        (item.thumb ? (
          <img className="kasten-chat-thumb" src={item.thumb} alt="" />
        ) : (
          <span className="kasten-chat-chip-icon" aria-hidden="true">
            <Icon name={item.kind === "image" ? "image" : item.pasted !== undefined ? "text" : "attach"} className="size-3.5" />
          </span>
        ))}
      {ready ? (
        <button type="button" className="kasten-chat-chip-toggle" aria-haspopup="dialog" aria-expanded={open} aria-label={`Look at ${item.name}`} onClick={(event) => onLook(event.currentTarget)}>
          <span className="kasten-chat-chip-label">{item.label}</span>
          {warn && <Icon name="alert" className="size-3 kasten-chat-warn" />}
        </button>
      ) : item.state === "error" ? (
        <button type="button" className="kasten-chat-chip-toggle" aria-haspopup="dialog" aria-expanded={open} onClick={(event) => onLook(event.currentTarget)}>
          <span className="kasten-chat-chip-label">{item.error}</span>
        </button>
      ) : (
        <span className="kasten-chat-chip-label">Reading {item.name}…</span>
      )}
      {ready && item.pasted !== undefined && (
        <button type="button" className="kasten-chat-as-text" aria-label="Insert as text instead" title="Put it in the box as text instead" onClick={() => insertAsText(thread.id, item.key)}>
          As text
        </button>
      )}
      <button type="button" aria-label={item.state === "error" ? `Dismiss: ${item.name}` : `Remove ${item.name}`} onClick={() => useAttachments.getState().remove(thread.id, item.key)}>
        <Icon name="close" className="size-3" />
      </button>
    </span>
  );
}
