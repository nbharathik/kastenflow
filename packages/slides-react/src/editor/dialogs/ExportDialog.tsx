import { type JSX, useState } from "react";

import { DEFAULT_PRINT, type PrintOptions } from "../../export/print.tsx";
import { PreflightPanel } from "../preflight/PreflightPanel.tsx";
import type { PreflightIssue } from "../preflight/types.ts";
import { usePreflight } from "../preflight/usePreflight.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Segmented, Toggle } from "../ui/Fields.tsx";
import { useEditorValue } from "../useEditor.ts";
import type { DialogProps } from "./types.ts";
import "./dialogs.css";

/**
 * Print, or save as PDF: which pages, and whether the speaker notes come with them. The
 * browser's own print dialog follows, with "Save as PDF" among its destinations, so the
 * text in the file stays text.
 */
export function ExportDialog({ session, ui, onClose }: DialogProps): JSX.Element {
  const [steps, setSteps] = useState<PrintOptions["steps"]>(DEFAULT_PRINT.steps);
  const [notes, setNotes] = useState(DEFAULT_PRINT.notes);
  const deck = useEditorValue(session, (state) => state.deck);
  const found = usePreflight(session, "pdf");
  const print = () => {
    onClose();
    ui.actions.print?.({ steps, notes });
  };
  const show = (issue: PreflightIssue): void => {
    if (issue.slide) session.goTo(issue.slide);
    if (issue.slide && issue.element) session.select([issue.element]);
    onClose();
  };
  return (
    <Dialog
      title="Print or save as PDF"
      width={560}
      onClose={onClose}
      footer={
        <>
          <TextButton onClick={onClose}>Cancel</TextButton>
          <TextButton primary onClick={print} data-autofocus="" disabled={ui.actions.print === undefined}>
            Print…
          </TextButton>
        </>
      }
    >
      <div className="ks-dg-form">
        <div className="ks-dg-field">
          <span className="ks-dg-label">Pages</span>
          <Segmented<PrintOptions["steps"]>
            label="Pages"
            value={steps}
            options={[
              { value: "final", label: "Each slide once", title: "Each slide once, as it ends" },
              { value: "each", label: "Every step", title: "A page for every step of a slide that has steps" },
            ]}
            onPick={setSteps}
          />
        </div>
        <Toggle label="Speaker notes under each slide (handout)" on={notes} onChange={setNotes} />
        <p className="ks-sp-hint">Choose “Save as PDF” as the destination to make a file. Hidden slides are left out.</p>
        <PreflightPanel deck={deck} report={found.report} checking={found.checking} failed={found.failed} onShow={show} onCheckWeb={() => found.check(true)} />
      </div>
    </Dialog>
  );
}
