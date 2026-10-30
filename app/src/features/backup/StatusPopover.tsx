// The backup's status popover, from the status bar: how fresh the backup is,
// what waits, what was left out, and the few things to do about it.

import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";

import type { CarryOn } from "../../lib/vault/backup-types";
import { Button } from "../../ui/Button";
import { showInFolder } from "../workspace/page/page-file";
import { Popup } from "../pages/page/Popup";
import { useVaultStatus } from "../workspace/status";
import { useWorkspace } from "../workspace/store";
import { openSettingsAt } from "../workspace/views/settings/jump";
import { githubPage, openBackupOnGitHub, runBackUpNow } from "./back-up-now";
import { runGetLatest } from "./latest";
import { message } from "./parts";
import { popoverView, type PopoverView } from "./popover-model";
import { openWizard } from "./open-wizard";
import { useBackupStatus } from "./use-backup-status";

const RED = "text-danger";

/** `owner/name` of a GitHub backup, for the commands that act on the repository. */
const repoOf = (remote: string | null) => githubPage(remote)?.replace("https://github.com/", "") ?? null;

function Problems({ view, busy, run }: { view: PopoverView; busy: boolean; run: (job: () => Promise<void>) => void }) {
  const { toast } = useWorkspace.getState();
  const repo = repoOf(view.remote);
  return (
    <>
      {view.publicRepo && repo && (
        <div role="alert" className={`text-13 ${RED}`}>
          <p>This backup is public, so anyone can read your notes. Nothing is backed up until you choose.</p>
          <div className="mt-1.5 flex gap-1.5">
            <Button size="sm" disabled={busy} onClick={() => run(async () => void (await invoke("github_make_private", { repo }), toast("The backup is private now")))}>
              Make it private
            </Button>
            <Button size="sm" tone="quiet" disabled={busy} onClick={() => run(async () => void (await invoke("github_allow_public", { repo }), toast("Backing up to the public repository")))}>
              I want a public backup
            </Button>
          </div>
        </div>
      )}
      {view.lostHistory && (
        <div role="alert" className="text-13 text-warning">
          <p>The backup on GitHub is missing some of your history. This computer still has all of it.</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Button
              size="sm"
              disabled={busy}
              onClick={() => run(async () => void toast(`Saved this computer's full history to ${await invoke<string>("backup_save_full_history")} on GitHub`))}
            >
              Save this computer’s full history as a separate copy on GitHub
            </Button>
            <Button
              size="sm"
              tone="quiet"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const found = await invoke<CarryOn>("backup_carry_on");
                  toast(found.canPush ? "Carrying on with the backup as it is now" : "This computer’s history and the backup share nothing, so nothing was sent");
                })
              }
            >
              Carry on with the backup as it is now
            </Button>
          </div>
        </div>
      )}
      {view.failing && (
        <p role="alert" className={`text-13 ${RED}`}>
          Backing up is not working: {view.failing}
        </p>
      )}
      {view.skipped.map((f) => (
        <div key={f.path} className="text-13 text-warning">
          <p>{f.text}.</p>
          <div className="mt-1.5 flex gap-1.5">
            <Button size="sm" onClick={() => void showInFolder(f.path)}>
              Show it
            </Button>
            <span className="self-center text-12 text-muted">Move it out of the vault, or shrink it.</span>
          </div>
        </div>
      ))}
    </>
  );
}

export function StatusPopover({ onClose, anchor }: { onClose: () => void; anchor: React.RefObject<HTMLElement | null> }) {
  const vault = useVaultStatus((s) => s.status);
  const backup = useBackupStatus((s) => s.status);
  const [busy, setBusy] = useState<string | null>(null);
  const view = popoverView(vault, backup);
  const { toast } = useWorkspace.getState();

  const guard = async (what: string, job: () => Promise<unknown>) => {
    setBusy(what);
    try {
      await job();
    } catch (err) {
      toast(message(err));
    } finally {
      setBusy(null);
      void useVaultStatus.getState().refresh();
      void useBackupStatus.getState().refresh();
    }
  };
  const act = (job: () => Promise<void>) => void guard("fix", job);

  return (
    <Popup label="Backup status" anchor={anchor} onClose={onClose} className="absolute bottom-full right-0 mb-1 w-[340px] space-y-2 p-3 text-left text-13 text-ink">
      <p className="font-medium" role="status">
        {view.headline}
      </p>
      {view.off ? (
        <>
          <p className="text-muted">History is on this computer only. Back it up to keep your notes safe if this computer is lost.</p>
          <Button tone="primary" size="sm" onClick={() => void openWizard().then(onClose)}>
            Set up backup
          </Button>
        </>
      ) : (
        <>
          {view.waiting && <p>{view.waiting}</p>}
          {view.verified && <p className="text-muted">{view.verified}</p>}
          {view.behind && <p className="text-warning">Another computer backed up changes this one does not have.</p>}
          <Problems view={view} busy={busy !== null} run={act} />
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Button size="sm" tone="primary" disabled={busy !== null} onClick={() => void guard("now", runBackUpNow)}>
              {busy === "now" ? "Backing up…" : "Back up now"}
            </Button>
            <Button size="sm" disabled={busy !== null} onClick={() => void guard("latest", () => runGetLatest())}>
              Get latest
            </Button>
            {githubPage(view.remote) && (
              <Button size="sm" onClick={() => openBackupOnGitHub(view.remote)}>
                Open on GitHub
              </Button>
            )}
            <Button
              size="sm"
              tone="quiet"
              onClick={() => {
                onClose();
                openSettingsAt({ group: "backup" });
              }}
            >
              Backup settings
            </Button>
          </div>
        </>
      )}
    </Popup>
  );
}
