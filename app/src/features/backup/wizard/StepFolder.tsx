// A folder or drive: backup files of the whole vault, written once a day into
// a folder Dropbox, Google Drive, OneDrive or a disk keeps. The folder browser
// takes the panel's place while it is open (WizardHost.tsx).

import { Button } from "../../../ui/Button";
import { useBackupWizard } from "./state";

export function StepFolder() {
  const where = useBackupWizard((s) => s.where);
  const { patch, go } = useBackupWizard.getState();
  return (
    <>
      <p className="kasten-wiz-lead">
        {where === "both" ? "Your GitHub backup is done. Now choose a folder for a second copy you can hold." : "Choose a folder that Dropbox, Google Drive, OneDrive or a disk keeps."}
      </p>
      <p className="kasten-wiz-note">A backup file holds the whole vault with its history. A new one is written daily, and the newest seven are kept. Backup files are not encrypted.</p>
      <footer className="kasten-wiz-foot">
        <Button tone="quiet" onClick={() => go(where === "both" ? "next" : "where")}>
          {where === "both" ? "Skip" : "Back"}
        </Button>
        <Button tone="primary" onClick={() => patch({ picker: { kind: "folder" } })}>
          Choose folder…
        </Button>
      </footer>
    </>
  );
}
