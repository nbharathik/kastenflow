// A look at an attachment: the picture, or the start of its text, in a small
// popover beside the chip that was pressed. Escape closes it and the focus
// goes back to the chip. The popover is placed from the chip's position and
// drawn over everything (it is not cut off by the row of chips, which scrolls).

import "../attachments.css";

import { useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode, type RefObject } from "react";

import { Icon } from "../../../ui/Icon";
import { Popup } from "../../pages/page/Popup";
import type { AttachKind } from "../agent-types";
import { useChat } from "../store";

/** What the viewer needs of an attachment, pending or sent. */
export interface Viewed {
  id?: string;
  name: string;
  kind: AttachKind;
  /** What its chip says: name and size. */
  label: string;
  /** Something done to it: cut, scaled. */
  note?: string;
  /** A small copy of a picture the window holds. */
  thumb?: string;
  /** For a long paste: the text as it was pasted. */
  pasted?: string;
}

/** The most characters of a text shown. */
const SHOWN = 20_000;
const WIDTH = 380;
const MARGIN = 8;

/** Where a popover of `WIDTH` goes for the chip at `rect`: under it when there is room, else above. */
export function placeBeside(rect: DOMRect, viewport: { width: number; height: number }, tall = 300): CSSProperties {
  const width = Math.min(WIDTH, viewport.width - 2 * MARGIN);
  const left = Math.max(MARGIN, Math.min(rect.left, viewport.width - width - MARGIN));
  if (viewport.height - rect.bottom > tall + MARGIN * 2) return { left, top: rect.bottom + 6, width };
  return { left, bottom: viewport.height - rect.top + 6, width };
}

export function AttachmentViewer({ item, anchor, onClose, children }: { item: Viewed; anchor: RefObject<HTMLElement | null>; onClose(): void; children?: ReactNode }) {
  const [style, setStyle] = useState<CSSProperties>({ left: MARGIN, bottom: MARGIN, width: WIDTH });
  const [content, setContent] = useState<{ text?: string; url?: string; failed?: boolean } | null>(item.pasted !== undefined ? { text: item.pasted } : item.thumb ? { url: item.thumb } : null);

  useLayoutEffect(() => {
    const rect = anchor.current?.getBoundingClientRect();
    if (rect) setStyle(placeBeside(rect, { width: window.innerWidth, height: window.innerHeight }));
  }, [anchor]);

  useEffect(() => {
    if (content || !item.id) return;
    let live = true;
    let url: string | undefined;
    useChat
      .getState()
      .ensure()
      .attachment(item.id)
      .then(
        (bytes) => {
          if (!live) return;
          if (item.kind === "text") return setContent({ text: new TextDecoder().decode(bytes) });
          try {
            url = URL.createObjectURL(new Blob([bytes.slice()]));
            setContent({ url });
          } catch {
            setContent({ failed: true });
          }
        },
        () => live && setContent({ failed: true }),
      );
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [content, item.id, item.kind]);

  const text = content?.text;
  return (
    <div className="kasten-chat-viewer-place" style={style}>
      <Popup label={`Attachment: ${item.name}`} anchor={anchor} onClose={onClose} className="kasten-chat-viewer">
        <header className="kasten-chat-viewer-head">
          <Icon name={item.kind === "image" ? "image" : "text"} className="size-3.5" />
          <span className="kasten-chat-viewer-name" title={item.label}>
            {item.label}
          </span>
          <button type="button" className="kasten-chat-viewer-close" aria-label="Close" title="Close" onClick={onClose}>
            <Icon name="close" className="size-3.5" />
          </button>
        </header>
        <div className="kasten-chat-viewer-body">
          {content?.url && <img src={content.url} alt={item.name} />}
          {text !== undefined && <pre>{text.length > SHOWN ? `${text.slice(0, SHOWN)}\n…` : text}</pre>}
          {content?.failed && <p className="kasten-chat-viewer-note">It could not be opened.</p>}
          {!content && <p className="kasten-chat-viewer-note">Opening…</p>}
        </div>
        {text !== undefined && text.length > SHOWN && <p className="kasten-chat-viewer-note">Showing the first {SHOWN.toLocaleString("en-US")} of {text.length.toLocaleString("en-US")} characters; the assistant gets all that was kept.</p>}
        {item.note && <p className="kasten-chat-viewer-note">{item.note}</p>}
        {children}
      </Popup>
    </div>
  );
}
