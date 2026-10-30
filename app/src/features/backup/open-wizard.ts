// Opens the guided backup setup. The wizard is loaded on demand and the call
// tolerates it being absent, so nothing else in the window depends on it.

import { useWorkspace } from "../workspace/store";

/** Opens the guided setup; answers false (and says so) when it cannot. */
export async function openWizard(): Promise<boolean> {
  try {
    const wizard = (await import("./wizard/index")) as { openBackupWizard?: () => void };
    if (typeof wizard.openBackupWizard === "function") {
      wizard.openBackupWizard();
      return true;
    }
  } catch {
    // Not there: say so below.
  }
  useWorkspace.getState().toast("Backup setup is not available in this build");
  return false;
}
