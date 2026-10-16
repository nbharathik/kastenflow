// A picture an attachment holds, drawn small: a blob: address made from its
// bytes (`chat_attachment`) once and kept for the session, for the strip under
// a sent message and for threads brought back from a saved copy.

import { useEffect, useState } from "react";

import { useChat } from "./store";

const made = new Map<string, Promise<string>>();

const mimeOf = (name: string) => (/\.jpe?g$/i.test(name) ? "image/jpeg" : /\.gif$/i.test(name) ? "image/gif" : /\.webp$/i.test(name) ? "image/webp" : "image/png");

/** The picture of attachment `id` as an address a page can show. */
export function pictureOf(id: string, name: string): Promise<string> {
  let held = made.get(id);
  if (!held) {
    held = useChat
      .getState()
      .ensure()
      .attachment(id)
      .then((bytes) => URL.createObjectURL(new Blob([bytes.slice()], { type: mimeOf(name) })));
    held.catch(() => made.delete(id));
    made.set(id, held);
  }
  return held;
}

/** The picture of a sent attachment: the small copy the window made when it was sent, else read from the backend. Undefined until it is there, or if it cannot be. */
export function usePicture(item: { id: string; name: string; kind: string; thumb?: string }): string | undefined {
  const [url, setUrl] = useState<string | undefined>(item.thumb);
  useEffect(() => {
    if (item.kind !== "image" || item.thumb) return;
    let live = true;
    pictureOf(item.id, item.name).then(
      (made) => live && setUrl(made),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [item.id, item.name, item.kind, item.thumb]);
  return item.thumb ?? url;
}
