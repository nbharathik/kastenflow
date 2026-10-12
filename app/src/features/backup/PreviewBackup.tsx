// The browser preview can't back up: its notes live in the browser, with no
// folder, git remote or keychain. It still shows the desktop app's three
// ways of backing up, with the same words, and each says where it works, so
// someone trying Kasten sees what keeps their notes safe.

import { useWorkspace } from "../workspace/store";
import { BUTTON, type RowComponent } from "./parts";

const NEEDS_APP = "Backup runs in the desktop app. The browser preview keeps its notes in this browser only";

export function PreviewBackup({ Row }: { Row: RowComponent }) {
  const tell = () => useWorkspace.getState().toast(NEEDS_APP);
  return (
    <>
      <Row label="Back up to GitHub" detail="Sign in, and KastenFlow makes a private repository in your account for this vault.">
        <button type="button" className={BUTTON} onClick={tell}>
          Sign in with GitHub
        </button>
      </Row>
      <Row label="Backup remote" detail="A private git repository on any host, such as GitLab, Gitea or your own server. Pushes happen 2 minutes after changes and at least hourly, never forced.">
        <button type="button" className={BUTTON} onClick={tell}>
          Set up…
        </button>
      </Row>
      <Row label="Backup files" detail="For Dropbox, Google Drive, OneDrive or a disk: a file of the whole vault in their folder, written daily. Not encrypted.">
        <button type="button" className={BUTTON} onClick={tell}>
          Choose folder…
        </button>
      </Row>
    </>
  );
}
