// Mounts "Keep your notes safe" wherever the window is, when something asked
// for it. The app shell loads this file only then. The panel is one dialog; a
// folder browser takes its place (never stacks on it) while a folder is chosen.

import { Modal } from "../../../ui/Modal";
import { restoreFromGit } from "../api";
import { FolderPicker } from "../../vaults/FolderPicker";
import { useWorkspace } from "../../workspace/store";
import { sentence } from "./api";
import { backUpToFolder } from "./job";
import { useBackupWizard } from "./state";
import { Wizard } from "./Wizard";

export default function WizardHost() {
  const open = useBackupWizard((s) => s.open);
  const picker = useBackupWizard((s) => s.picker);
  const { hide, patch } = useBackupWizard.getState();
  if (!open) return null;

  if (picker?.kind === "folder") {
    return (
      <FolderPicker
        title="Where backup files go"
        onPick={(path) => {
          patch({ picker: null });
          void backUpToFolder(path);
        }}
        onClose={() => patch({ picker: null })}
      />
    );
  }
  if (picker?.kind === "restore") {
    const { repo } = picker;
    return (
      <FolderPicker
        title="An empty folder to restore the backup into"
        pickLabel="Restore here"
        onPick={(path) => {
          patch({ picker: null });
          restoreFromGit(repo.cloneUrl, path).then(hide, (err) => useWorkspace.getState().toast(sentence(err)));
        }}
        onClose={() => patch({ picker: null })}
      />
    );
  }
  return (
    <Modal labelledBy="kasten-wiz-title" onClose={hide} className="kasten-wiz-modal">
      <Wizard onClose={hide} />
    </Modal>
  );
}
