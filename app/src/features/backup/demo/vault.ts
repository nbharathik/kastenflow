// Makes the preview's vault say what the demo's backup is: its status (the
// status bar and the popover read it), its backup remote in the settings, and
// "Back up now" in Settings. The vault's notes and history stay the preview's own.

import type { VaultClient, VaultStatus, VaultConfig, BackupStatus } from "../../../lib/vault/types";
import type { BackupFlow } from "./flow";

/** The pieces of the client the demo replaces. */
type Patched = {
  status(): Promise<VaultStatus>;
  getConfig(): Promise<VaultConfig>;
  pushNow(): Promise<BackupStatus>;
};

export function patchVault(client: VaultClient, flow: BackupFlow): void {
  const was = {
    status: client.status.bind(client),
    getConfig: client.getConfig.bind(client),
  };
  const over = client as unknown as Patched;
  over.status = async () => {
    const base = await was.status();
    return { ...base, history: true, remote: flow.remote, backup: flow.vaultBackup(), pending: 0, computer: "Maya's laptop", ...flow.vaultFile() };
  };
  over.getConfig = async () => {
    const base = await was.getConfig();
    return flow.remote ? { ...base, git: { ...base.git, remote: flow.remote } } : base;
  };
  over.pushNow = async () => flow.pushNow();
}
