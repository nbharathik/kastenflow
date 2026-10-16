// What went with a sent question: its pictures drawn small and its files as
// chips, above the question's bubble. Pressing one looks at it.

import "../attachments.css";

import { useRef, useState } from "react";

import { Icon } from "../../../ui/Icon";
import type { SentAttachment } from "../thread";
import { usePicture } from "../thumbs";
import { AttachmentViewer } from "./AttachmentViewer";

function Sent({ item, open, onLook }: { item: SentAttachment; open: boolean; onLook(button: HTMLButtonElement): void }) {
  const picture = usePicture(item);
  return (
    <button type="button" className="kasten-chat-sent" data-kind={item.kind} aria-haspopup="dialog" aria-expanded={open} aria-label={`Look at ${item.name}`} title={item.label} onClick={(event) => onLook(event.currentTarget)}>
      {item.kind === "image" ? picture ? <img src={picture} alt="" /> : <Icon name="image" className="size-4" /> : <Icon name="attach" className="size-3.5" />}
      {item.kind === "text" && <span>{item.label}</span>}
    </button>
  );
}

export function AttachmentStrip({ items }: { items: SentAttachment[] }) {
  const [looking, setLooking] = useState<string | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const viewed = items.find((a) => a.id === looking);
  return (
    <>
      <div className="kasten-chat-sent-strip" role="group" aria-label="Attachments">
        {items.map((item) => (
          <Sent
            key={item.id}
            item={item}
            open={looking === item.id}
            onLook={(button) => {
              anchor.current = button;
              setLooking(looking === item.id ? null : item.id);
            }}
          />
        ))}
      </div>
      {viewed && <AttachmentViewer item={viewed} anchor={anchor} onClose={() => setLooking(null)} />}
    </>
  );
}
