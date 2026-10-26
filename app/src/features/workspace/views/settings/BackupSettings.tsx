// Settings → Backup: where the backup is, when it happens, what comes in from
// other computers, the backup files, and how safe it is. The rows that sign in
// and point at a place are the backup parts' own (VaultSafety); the rest write
// the vault's settings through the same config the engine reads.

import { invoke } from "@tauri-apps/api/core";

import { inDemo } from "../../../../demo/flag";
import { openUrl } from "../../../../lib/api";
import type { RevokeLink } from "../../../../lib/vault/backup-types";
import { Button } from "../../../../ui/Button";
import { canBackUp } from "../../../backup/api";
import { message, FIELD } from "../../../backup/parts";
import { openWizard } from "../../../backup/open-wizard";
import { WHEN, WHEN_WORDS, whenOf, type When } from "../../../backup/schedule";
import { SafetyRows } from "./SafetyRows";
import { useVaultConfig } from "../../../backup/use-vault-config";
import { useVaultStatus } from "../../status";
import { useWorkspace } from "../../store";
import { VaultSafety } from "../VaultSafety";
import { Group, Row, Segmented } from "./parts";
import { SAFETY_ROW } from "./VaultSettings";

type Mode = "auto" | "ask" | "manual";

const LATEST_WORDS: Record<Mode, string> = {
  auto: "Brought in by itself when it is safe: nothing here is waiting and no page has unsaved typing.",
  ask: "KastenFlow tells you, and you choose when to bring them in.",
  manual: "Only when you choose Get latest. KastenFlow does not even look.",
};

function Schedule() {
  const { config, change } = useVaultConfig();
  if (!config) return null;
  const when = whenOf(config.git);
  const mode: Mode = config.backup?.get_latest ?? "auto";
  const minutes = config.backup?.fetch_interval ?? 15;
  const keep = config.backup?.keep_files ?? 7;
  const setBackup = (patch: NonNullable<typeof config.backup>) => change((c) => ({ ...c, backup: { ...c.backup, ...patch } }));
  return (
    <>
      <Row id="backup.when" detail={WHEN_WORDS[when]}>
        <Segmented
          label="When to back up"
          value={when}
          options={[
            { id: "work", label: "As I work" },
            { id: "hourly", label: "Every hour" },
            { id: "hand", label: "Only when I close or by hand" },
          ]}
          onChange={(next: When) => void change((c) => ({ ...c, git: { ...c.git, ...WHEN[next] } }))}
        />
      </Row>
      <Row id="backup.others" detail={LATEST_WORDS[mode]}>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Changes from other computers"
            value={mode}
            options={[
              { id: "auto", label: "Automatically when safe" },
              { id: "ask", label: "Ask me" },
              { id: "manual", label: "Only by hand" },
            ]}
            onChange={(next: Mode) => void setBackup({ get_latest: next })}
          />
          {mode !== "manual" && (
            <label className="flex items-center gap-1.5 text-13 text-muted">
              Look every
              <input
                type="number"
                min={0}
                max={1440}
                aria-label="Minutes between looks at the backup"
                value={minutes}
                onChange={(e) => void setBackup({ fetch_interval: Math.max(0, Math.min(1440, Math.round(Number(e.target.value) || 0))) })}
                className={`${FIELD} w-[72px]`}
              />
              minutes (0 stops looking)
            </label>
          )}
        </div>
      </Row>
      <Row id="backup.keep" detail="Backup files in the folder you chose: the newest ones from this computer are kept; an older one goes only when the newest holds all of its history.">
        <label className="flex items-center gap-1.5 text-13 text-muted">
          Keep
          <input
            type="number"
            min={3}
            max={60}
            aria-label="How many backup files to keep"
            value={keep}
            onChange={(e) => void setBackup({ keep_files: Math.max(3, Math.min(60, Math.round(Number(e.target.value) || 7))) })}
            className={`${FIELD} w-[72px]`}
          />
          files (3 to 60)
        </label>
      </Row>
    </>
  );
}

function SignIn() {
  const status = useVaultStatus((s) => s.status);
  if (!status?.remote?.startsWith("https://github.com/")) return null;
  const revoke = async () => {
    try {
      const link = await invoke<RevokeLink>("github_revoke_link");
      await openUrl(link.url);
    } catch (err) {
      useWorkspace.getState().toast(message(err));
    }
  };
  return (
    <Row id="backup.signin" detail="Sign out is above. To take KastenFlow's access away from your GitHub account for good, GitHub has the page for it.">
      <Button size="sm" onClick={() => void revoke()}>
        Revoke access on GitHub…
      </Button>
    </Row>
  );
}

export function BackupSettings() {
  const client = useWorkspace((s) => s.client);
  const preview = client?.kind === "preview" && !inDemo();
  return (
    <Group title="Backup">
      {!preview && (
        <Row id="backup.setup">
          <Button size="sm" tone="primary" icon="upload" onClick={() => void openWizard()}>
            Set up backup…
          </Button>
        </Row>
      )}
      <VaultSafety Row={SAFETY_ROW} part="backup" />
      {!preview && canBackUp() && <SignIn />}
      {!preview && <Schedule />}
      {!preview && <SafetyRows />}
    </Group>
  );
}
