import { type JSX, useEffect, useRef, useState } from "react";

import type { DialogProps } from "../dialogs/types.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { useEditorValue } from "../useEditor.ts";
import { askOf, dropAsk } from "./gate.ts";
import { PreflightPanel } from "./PreflightPanel.tsx";
import { runPreflight } from "./preflight.ts";
import type { PreflightIssue, PreflightReport } from "./types.ts";

/**
 * What the check found before an export or a presentation, with the way to go on anyway. It opens only when the check found something
 * (`checkThen`); Show goes to the slide and selects the element, which also leaves the export for later.
 */
export function PreflightDialog({ session, ui, onClose }: DialogProps): JSX.Element {
  // The question is kept by this dialog while it is open, and forgotten by the window when it closes.
  const [ask] = useState(() => askOf(ui));
  const deck = useEditorValue(session, (state) => state.deck);
  const [report, setReport] = useState<PreflightReport | null>(ask?.report ?? null);
  const [checking, setChecking] = useState(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      dropAsk(ui);
    };
  }, [ui]);

  if (!ask) {
    return (
      <Dialog title="Before you go on" width={560} onClose={onClose} footer={<TextButton onClick={onClose}>Close</TextButton>}>
        <p className="ks-pf-note">There is nothing to check.</p>
      </Dialog>
    );
  }

  const show = (issue: PreflightIssue): void => {
    if (issue.slide) session.goTo(issue.slide);
    if (issue.slide && issue.element) session.select([issue.element]);
    onClose();
  };
  const checkWeb = (): void => {
    setChecking(true);
    void runPreflight(session, session.host, ask.format, { network: true }).then(
      (found) => {
        if (!live.current) return;
        setReport(found);
        setChecking(false);
      },
      () => live.current && setChecking(false),
    );
  };
  const go = (): void => {
    const proceed = ask.proceed;
    onClose();
    proceed();
  };
  const title = ask.verb === "Present" ? "Before you present" : "Before you export";
  return (
    <Dialog
      title={title}
      width={640}
      onClose={onClose}
      footer={
        <>
          <TextButton onClick={onClose}>Cancel</TextButton>
          <TextButton primary onClick={go} data-autofocus="">
            {ask.verb} anyway
          </TextButton>
        </>
      }
    >
      <PreflightPanel deck={deck} report={report} checking={checking} onShow={show} onCheckWeb={checkWeb} />
    </Dialog>
  );
}
