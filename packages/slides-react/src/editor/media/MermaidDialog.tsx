import { type JSX, useId, useState } from "react";

import type { DialogProps } from "../dialogs/types.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { SAMPLE_MERMAID, addMermaid, selectedChart, updateMermaid } from "./mermaid.ts";
import "../dialogs/dialogs.css";
import "../dialogs/insert.css";
import "./media.css";

/** A Mermaid flowchart as text. With a chart made this way selected the text is that chart's, and Update draws it again; otherwise Insert makes a new one. */
export function MermaidDialog({ session, onClose }: DialogProps): JSX.Element {
  const chart = selectedChart(session);
  const [source, setSource] = useState(chart?.source ?? SAMPLE_MERMAID);
  const uid = useId();

  const apply = () => {
    if (source.trim() === "") return;
    const done = chart ? updateMermaid(session, chart.id, source) : addMermaid(session, source) !== undefined;
    // A refused text stays in the box for the person to mend; the engine's words about it are in the notice.
    if (done) onClose();
  };

  return (
    <Dialog
      title={chart ? "Edit Mermaid diagram" : "Insert a Mermaid diagram"}
      width={520}
      onClose={onClose}
      footer={
        <>
          <TextButton onClick={onClose}>Cancel</TextButton>
          <TextButton primary onClick={apply}>
            {chart ? "Update" : "Insert"}
          </TextButton>
        </>
      }
    >
      <div className="ks-dg-form">
        <div className="ks-dg-field">
          <label className="ks-dg-label" htmlFor={`${uid}-src`}>
            Mermaid flowchart
          </label>
          <textarea
            id={`${uid}-src`}
            className="ks-input ks-mermaid-source"
            rows={10}
            spellCheck={false}
            autoComplete="off"
            data-autofocus=""
            value={source}
            onChange={(event) => setSource(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                apply();
              }
            }}
          />
        </div>
        <p className="ks-dg-note">
          Start with <code>flowchart TD</code> (top down) or <code>flowchart LR</code> (left to right). Boxes are <code>A[text]</code>, <code>A(text)</code>, <code>A{"{text}"}</code> or <code>A((text))</code>; arrows are <code>--&gt;</code>, <code>---</code> or <code>--&gt;|word|</code>. The boxes and arrows are ordinary shapes you can restyle; the text stays with the diagram so you can edit it here again. Press Ctrl+Enter to {chart ? "update" : "insert"}.
        </p>
      </div>
    </Dialog>
  );
}
