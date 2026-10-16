import { type JSX, useId, useState } from "react";

import { insertComposite } from "../insert-composite.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { pageAddress } from "./source-address.ts";
import type { DialogProps } from "./types.ts";
import "./dialogs.css";
import "./insert.css";

/** Asks for the address of a web page, and puts a frame for it on the slide. */
export function EmbedDialog({ session, onClose }: DialogProps): JSX.Element {
  const [address, setAddress] = useState("");
  const [title, setTitle] = useState("");
  const [tried, setTried] = useState(false);
  const uid = useId();
  const page = pageAddress(address);
  const wrong = tried && page === null;

  const insert = () => {
    setTried(true);
    if (page === null) return;
    onClose();
    insertComposite(session, "embed", { address: page, ...(title.trim() ? { title: title.trim() } : {}) });
  };
  const enter = (event: { key: string; preventDefault(): void }) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    insert();
  };

  return (
    <Dialog
      title="Embed a web page"
      width={420}
      onClose={onClose}
      footer={
        <>
          <TextButton onClick={onClose}>Cancel</TextButton>
          <TextButton primary onClick={insert}>
            Insert
          </TextButton>
        </>
      }
    >
      <div className="ks-dg-form">
        <div className="ks-dg-field">
          <label className="ks-dg-label" htmlFor={`${uid}-url`}>
            Web address
          </label>
          <input
            id={`${uid}-url`}
            className="ks-input"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://example.com"
            data-autofocus=""
            value={address}
            aria-invalid={wrong || undefined}
            aria-describedby={wrong ? `${uid}-error` : undefined}
            onChange={(event) => setAddress(event.target.value)}
            onKeyDown={enter}
          />
          {wrong ? (
            <p id={`${uid}-error`} className="ks-dg-note is-error" role="alert">
              Use a web address such as https://example.com.
            </p>
          ) : null}
        </div>
        <div className="ks-dg-field">
          <label className="ks-dg-label" htmlFor={`${uid}-title`}>
            Title (optional)
          </label>
          <input id={`${uid}-title`} className="ks-input" autoComplete="off" placeholder="What the page is called" value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={enter} />
        </div>
        <p className="ks-dg-note">It shows live when you present. Elsewhere it is a picture and a link, so give it a poster from the format options: a picture you choose or paste, since the app does not take pictures of web pages.</p>
      </div>
    </Dialog>
  );
}
