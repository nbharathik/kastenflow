import { type JSX, useId, useState } from "react";

import { insertComposite } from "../insert-composite.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { videoSource } from "./source-address.ts";
import type { DialogProps } from "./types.ts";
import { importVideoFile } from "./video-file.ts";
import "./dialogs.css";
import "./insert.css";

/** Asks for a video, by web address or by a file kept with the deck, and puts a frame for it on the slide. */
export function VideoDialog({ session, onClose }: DialogProps): JSX.Element {
  const [source, setSource] = useState("");
  const [tried, setTried] = useState(false);
  const uid = useId();
  const video = videoSource(source);
  const wrong = tried && video === null;

  const insert = () => {
    setTried(true);
    if (video === null) return;
    onClose();
    insertComposite(session, "video", { address: video });
  };

  return (
    <Dialog
      title="Insert a video"
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
          <label className="ks-dg-label" htmlFor={`${uid}-src`}>
            Web address or file name
          </label>
          <div className="ks-dg-row">
            <input
              id={`${uid}-src`}
              className="ks-input"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://example.com/talk.mp4"
              data-autofocus=""
              value={source}
              aria-invalid={wrong || undefined}
              aria-describedby={wrong ? `${uid}-error` : undefined}
              onChange={(event) => setSource(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                insert();
              }}
            />
            <TextButton
              onClick={async () => {
                const path = await importVideoFile(session);
                if (path) setSource(path);
              }}
            >
              Choose file…
            </TextButton>
          </div>
          {wrong ? (
            <p id={`${uid}-error`} className="ks-dg-note is-error" role="alert">
              Give a web address, or the name of a video file.
            </p>
          ) : null}
        </div>
        <p className="ks-dg-note">A YouTube, Vimeo or Loom link becomes an embedded player with its picture. A file you choose is kept with the deck. Add a poster from the format options to have a still to show until it plays.</p>
      </div>
    </Dialog>
  );
}
