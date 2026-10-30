// The vault's settings as Settings → Backup reads and writes them: each change
// is made on the settings as they are now, so another setting changed since is kept.

import { useCallback, useEffect, useState } from "react";

import type { VaultConfig } from "../../lib/vault/types";
import { useWorkspace } from "../workspace/store";
import { message } from "./parts";

export function useVaultConfig(): { config: VaultConfig | null; change(edit: (current: VaultConfig) => VaultConfig): Promise<void> } {
  const client = useWorkspace((s) => s.client);
  const [config, setConfig] = useState<VaultConfig | null>(null);
  useEffect(() => {
    client?.getConfig().then(setConfig, () => {});
  }, [client]);
  const change = useCallback(
    async (edit: (current: VaultConfig) => VaultConfig) => {
      if (!client) return;
      try {
        const next = edit(await client.getConfig());
        await client.setConfig(next);
        setConfig(next);
      } catch (err) {
        useWorkspace.getState().toast(message(err));
      }
    },
    [client],
  );
  return { config, change };
}
