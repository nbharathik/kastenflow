import type { JSX } from "react";

import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import type { DialogProps } from "./types.ts";
import "./dialogs.css";

/** A dialog with a title, a sentence and a way out: for the places that are yet to be filled in. */
function Notice({ title, children, onClose }: { title: string; children: string; onClose(): void }): JSX.Element {
  return (
    <Dialog
      title={title}
      width={380}
      onClose={onClose}
      footer={
        <TextButton primary data-autofocus="" onClick={onClose}>
          Close
        </TextButton>
      }
    >
      <p className="ks-dg-note">{children}</p>
    </Dialog>
  );
}

export function AboutDialog({ onClose }: DialogProps): JSX.Element {
  return (
    <Notice title="About KastenFlow Slides" onClose={onClose}>
      KastenFlow Slides is a slide editor that keeps every deck as one plain file that belongs to you.
    </Notice>
  );
}
