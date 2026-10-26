// Step 1: where the backup goes. One click on a card moves on; GitHub is first
// and says it is the recommended one.

import { Icon } from "../../../ui/Icon";
import { useBackupWizard, type Step, type Where } from "./state";

const CHOICES: { where: Where; title: string; detail: string; next: Step; recommended?: boolean }[] = [
  { where: "github", title: "GitHub (recommended)", detail: "A private repository in your account. Free, and every change is kept.", next: "signin", recommended: true },
  { where: "host", title: "Another git host", detail: "GitLab, Gitea, Bitbucket or your own server: an address and a token or SSH key.", next: "host" },
  { where: "folder", title: "A folder or drive", detail: "Backup files in Dropbox, Google Drive, OneDrive or a disk.", next: "folder" },
  { where: "both", title: "Both: GitHub and a folder", detail: "The most safety: a copy online and a copy you can hold.", next: "signin" },
];

export function StepWhere() {
  const { patch, go } = useBackupWizard.getState();
  return (
    <>
      <p className="kasten-wiz-lead">Your notes already keep every change on this computer. A backup keeps a copy somewhere else too, so a lost laptop loses nothing.</p>
      <div className="kasten-wiz-cards" role="group" aria-label="Where to keep the backup">
        {CHOICES.map((choice) => (
          <button
            key={choice.where}
            type="button"
            className="kasten-wiz-card"
            data-recommended={choice.recommended ? "true" : undefined}
            onClick={() => {
              patch({ where: choice.where });
              go(choice.next);
            }}
          >
            <Icon name={choice.where === "folder" ? "folder" : "cards"} className="size-5 shrink-0" />
            <span className="kasten-wiz-card-text">
              <span className="kasten-wiz-card-title">{choice.title}</span>
              <span className="kasten-wiz-card-detail">{choice.detail}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
