import { type JSX, useId, useState } from "react";

import type { DialogProps } from "../dialogs/types.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { audioSource, importAudioFile, insertAudio } from "./audio-file.ts";
import "../dialogs/dialogs.css";
import "../dialogs/insert.css";

/** Asks for a sound, by web address or by a file kept with the deck, and puts its chip on the slide. */
export function AudioDialog({ session, onClose }: DialogProps): JSX.Element {
  const [source, setSource] = useState("");
  const [tried, setTried] = useState(false);
  const uid = useId();
  const audio = audioSource(source);
  const wrong = tried && audio === null;

  const insert = () => {
    setTried(true);
    if (audio === null) return;
    onClose();
    insertAudio(session, audio);
  };

  return (
    <Dialog
      title="Insert audio"
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
              placeholder="https://example.com/theme.mp3"
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
                const path = await importAudioFile(session);
                if (path) setSource(path);
              }}
            >
              Choose file…
            </TextButton>
          </div>
          {wrong ? (
            <p id={`${uid}-error`} className="ks-dg-note is-error" role="alert">
              Give a web address, or the name of an audio file (mp3, m4a, wav, ogg, flac).
            </p>
          ) : null}
        </div>
        <p className="ks-dg-note">A file you choose is kept with the deck. It plays while presenting, on a click on its chip or by itself, and can go on over the next slides; PowerPoint gets the chip and, for a web address, a link.</p>
      </div>
    </Dialog>
  );
}
