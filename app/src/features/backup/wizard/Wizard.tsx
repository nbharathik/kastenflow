// "Keep your notes safe": one panel with steps, never a chain of dialogs. Each
// step names itself in a heading that takes focus when the step appears, so
// a keyboard run (or a screen reader) always starts at the top of what is new.

import { useEffect, useRef } from "react";

import { Button } from "../../../ui/Button";
import { HowItWorks } from "./HowItWorks";
import { StepFirstBackup } from "./StepFirstBackup";
import { StepFolder } from "./StepFolder";
import { StepHost } from "./StepHost";
import { StepRepo } from "./StepRepo";
import { StepSignIn } from "./StepSignIn";
import { StepWhere } from "./StepWhere";
import { useBackupWizard, type Step } from "./state";

import "./wizard.css";

const TITLES: Record<Step, string> = {
  where: "Where should your backup go?",
  signin: "Sign in to GitHub",
  repo: "Choose the repository",
  first: "Your first backup",
  host: "Another git host",
  folder: "A folder or drive",
  next: "How your backup works",
};

/** Steps on the way to a backup on GitHub, for "Step 2 of 4". */
const GITHUB_STEPS: Step[] = ["signin", "repo", "first", "next"];

export function Wizard({ onClose }: { onClose: () => void }) {
  const step = useBackupWizard((s) => s.step);
  const where = useBackupWizard((s) => s.where);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [step]);

  const place = GITHUB_STEPS.indexOf(step);
  return (
    <div className="kasten-wiz">
      <header className="kasten-wiz-head">
        {where === "github" && place >= 0 && (
          <p className="kasten-wiz-count" aria-hidden="true">
            Step {place + 1} of {GITHUB_STEPS.length}
          </p>
        )}
        <h2 id="kasten-wiz-title" ref={heading} tabIndex={-1} className="kasten-wiz-title">
          {TITLES[step]}
        </h2>
      </header>
      <div className="kasten-wiz-body">
        {step === "where" && <StepWhere />}
        {step === "signin" && <StepSignIn />}
        {step === "repo" && <StepRepo />}
        {step === "first" && <StepFirstBackup />}
        {step === "host" && <StepHost />}
        {step === "folder" && <StepFolder />}
        {step === "next" && <HowItWorks onDone={onClose} />}
      </div>
      {step === "where" && (
        <footer className="kasten-wiz-foot">
          <Button tone="quiet" onClick={onClose}>
            Later
          </Button>
        </footer>
      )}
    </div>
  );
}
