import type { JSX } from "react";

import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { presentingKeys, startingKeys } from "./presenting-keys.ts";
import type { DialogProps } from "./types.ts";
import "./dialogs.css";

/** A short card of what to press during a show, reached from the Slideshow button's menu. The show lists the same keys with "?". */
export function PresentingDialog({ onClose }: DialogProps): JSX.Element {
  return (
    <Dialog title="Presenting" width={480} onClose={onClose} footer={<TextButton primary onClick={onClose}>Close</TextButton>}>
      <section className="ks-dg-keys-group" aria-label="Starting">
        <h3 className="ks-dg-keys-area">Starting</h3>
        <ul>
          {startingKeys().map((row) => (
            <li key={row.what}>
              <span className="ks-dg-keys-label">{row.what}</span>
              <span className="ks-dg-keys-combos">
                <kbd className="ks-kbd ks-dg-kbd">{row.keys}</kbd>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="ks-dg-keys-group" aria-label="During the show">
        <h3 className="ks-dg-keys-area">During the show</h3>
        <ul>
          {presentingKeys().map((row) => (
            <li key={row.what}>
              <span className="ks-dg-keys-label">{row.what}</span>
              <span className="ks-dg-keys-combos">
                <kbd className="ks-kbd ks-dg-kbd">{row.keys}</kbd>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <p className="ks-dg-note">Press ? during the show to see this list there. Type a slide's number and press Enter to go to it.</p>
    </Dialog>
  );
}
