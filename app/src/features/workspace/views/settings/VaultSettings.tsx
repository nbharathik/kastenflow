// Settings → Vault, and History and backup: where the notes live, bringing
// notes in, switching to another folder, and keeping it all safe.

import { Button } from "../../../../ui/Button";
import type { RowComponent } from "../../../backup/parts";
import { HealthSettings } from "../../../health/HealthSettings";
import { askToExport } from "../../../projects/export/request";
import { showInFolder } from "../../page/page-file";
import { useWorkspace } from "../../store";
import { VaultSafety } from "../VaultSafety";
import { Group, Row } from "./parts";

export function VaultSettings({ onSwitch }: { onSwitch: () => void }) {
  const client = useWorkspace((s) => s.client);
  const preview = client?.kind === "preview";

  const copySettings = async () => {
    const { toast } = useWorkspace.getState();
    try {
      const config = await client!.getConfig();
      await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
      toast("Copied the vault's settings");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Group title="Vault">
      <Row id="vault.location" help={preview ? "Edits are kept in this browser only. Run the desktop app to work on a folder." : undefined} detail={preview ? "Kept in this browser" : undefined}>
        <code className="kasten-set-path" title={client?.label}>
          {client?.label ?? "No vault"}
        </code>
        {!preview && (
          <Button size="sm" icon="folder-open" onClick={() => void showInFolder()}>
            Show in folder
          </Button>
        )}
      </Row>
      <Row id="vault.import">
        <Button size="sm" icon="import" onClick={() => useWorkspace.getState().go({ view: "import" })}>
          Import…
        </Button>
      </Row>
      {!preview && (
        <Row id="vault.export">
          <Button size="sm" icon="upload" onClick={() => askToExport()}>
            Export…
          </Button>
        </Row>
      )}
      {!preview && (
        <Row id="vault.switch">
          <Button size="sm" icon="move-to" onClick={onSwitch}>
            Switch…
          </Button>
        </Row>
      )}
      {!preview && (
        <Row id="vault.copy">
          <Button size="sm" icon="copy" onClick={() => void copySettings()}>
            Copy
          </Button>
        </Row>
      )}
    </Group>
  );
}

/** The backup rows' ids in the index, from the names they draw themselves with. */
const SAFETY_ID: Record<string, string> = {
  "Vault folder": "history.synced",
  History: "history.history",
  "Back up to GitHub": "history.github",
  GitHub: "history.github",
  "Backup remote": "history.remote",
  "Get latest": "history.latest",
  "Backup files": "history.files",
  "Check the vault": "history.check",
};

/** The row the backup parts draw with: Settings' own, given the index id of what they are about. */
const SafetyRow: RowComponent = ({ label, detail, help, children }) => {
  const id = SAFETY_ID[label] ?? (label.startsWith("Token for") ? "history.token" : "history.status");
  // What the backup is doing now stays in view; the rest of what it says is behind the ?.
  const status = id === "history.status" || id === "history.synced";
  return (
    <Row id={id} label={label} help={help} detail={status && typeof detail === "string" ? <>{detail}</> : detail}>
      {children}
    </Row>
  );
};

export function HistorySettings() {
  return (
    <>
      <Group title="History and backup">
        <VaultSafety Row={SafetyRow} />
      </Group>
      <HealthSettings />
    </>
  );
}
