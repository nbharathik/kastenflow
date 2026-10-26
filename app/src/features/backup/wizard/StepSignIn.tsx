// Step 2: sign in to GitHub. Nothing to click on the common path: the code is
// shown large, already copied, and GitHub's page is open in the browser.

import { openUrl } from "../../../lib/api";
import { Button } from "../../../ui/Button";
import { SignInOther } from "./SignInOther";
import { useBackupWizard } from "./state";
import { useSignIn } from "./use-sign-in";

import "../backup.css";

const WORDS = {
  expired: "The code ran out before it was approved.",
  denied: "GitHub sign-in was cancelled.",
  disabled: "This copy of KastenFlow can't sign in by code. Use a token below.",
} as const;

export function StepSignIn() {
  const { view, again } = useSignIn();
  const back = () => useBackupWizard.getState().go("where");

  return (
    <>
      {view.state === "starting" && (
        <p role="status" className="kasten-wiz-lead">
          Getting a code from GitHub…
        </p>
      )}
      {view.state === "waiting" && (
        <>
          <p className="kasten-wiz-lead">GitHub's page is open in your browser. Type this code there and approve. It is already copied.</p>
          <output aria-label="Sign-in code" className="kasten-sign-in-code">
            {view.code.userCode}
          </output>
          <p role="status" className="kasten-wiz-note">
            Waiting for you to approve on GitHub…
          </p>
          <div className="kasten-wiz-row">
            <Button
              onClick={() => {
                void navigator.clipboard?.writeText(view.code.userCode).catch(() => {});
                void openUrl(view.code.verificationUri);
              }}
            >
              Open GitHub again
            </Button>
          </div>
        </>
      )}
      {(view.state === "expired" || view.state === "denied") && (
        <>
          <p role="alert" className="kasten-wiz-problem">
            {WORDS[view.state]}
          </p>
          <div className="kasten-wiz-row">
            <Button tone="primary" onClick={again}>
              {view.state === "expired" ? "Get a new code" : "Try again"}
            </Button>
          </div>
        </>
      )}
      {view.state === "disabled" && (
        <p role="alert" className="kasten-wiz-problem">
          {WORDS.disabled}
        </p>
      )}
      {view.state === "failed" && (
        <>
          <p role="alert" className="kasten-wiz-problem">
            {view.message}
          </p>
          <div className="kasten-wiz-row">
            <Button tone="primary" onClick={again}>
              Try again
            </Button>
          </div>
        </>
      )}
      <SignInOther open={view.state === "disabled"} />
      <footer className="kasten-wiz-foot">
        <Button tone="quiet" onClick={back}>
          Back
        </Button>
      </footer>
    </>
  );
}
