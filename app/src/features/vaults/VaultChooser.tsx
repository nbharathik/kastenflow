import "./vaults.css";

import { useEffect, useState, type FormEvent } from "react";

import { listKits, openVault, vaultChoices, type VaultChoices } from "../../lib/api";
import type { KitInfo } from "../../lib/vault/types";
import { BrandMark } from "../../ui/BrandMark";
import { writeEverything } from "../workspace/page/before-exit";
import { Icon } from "../../ui/Icon";
import { FolderPicker } from "./FolderPicker";
import { openOnFirstRun } from "./first-page";
import { FolderNote, useSurvey } from "./FolderNote";
import { KitChoice } from "./KitChoice";
import { Button, Card, Field } from "./parts";
import { RestoreCard } from "./RestoreCard";
import { SyncedNote, useSynced } from "./SyncedNote";
import { folderName, inside, parentOf } from "./paths";

type Picking = "location" | "folder" | null;

/** The first-run screen, and Settings' "Switch vault":
 * make a new vault in a folder you pick, open a folder, which says what it
 * holds first, or restore one from a backup. The app restarts on the choice. */
export function VaultChooser({ problem, onCancel }: { problem?: string | null; onCancel?: () => void }) {
  const [choices, setChoices] = useState<VaultChoices | null>(null);
  const [name, setName] = useState("Kasten");
  const [location, setLocation] = useState("");
  const [folder, setFolder] = useState("");
  const [picking, setPicking] = useState<Picking>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kits, setKits] = useState<KitInfo[]>([]);
  const [kit, setKit] = useState<string | null>(null);
  const survey = useSurvey(folder);
  const where = location.trim() ? inside(location.trim(), folderName(name)) : "";
  const syncedWhere = useSynced(where);
  const syncedFolder = useSynced(folder);

  useEffect(() => {
    listKits().then(
      (found) => {
        setKits(found);
        setKit(found.find((k) => k.recommended)?.id ?? null);
      },
      () => {},
    );
  }, []);

  useEffect(() => {
    vaultChoices().then(
      (found) => {
        setChoices(found);
        if (found) setLocation(parentOf(found.suggested));
      },
      () => {},
    );
  }, []);

  const go = async (path: string, create: boolean, label: string) => {
    if (!path.trim()) return setError("Type a folder path first.");
    setBusy(label);
    setError(null);
    try {
      // What was typed a moment ago stays with the vault it belongs to.
      await writeEverything();
      const starter = create ? kits.find((k) => k.id === kit) : undefined;
      if (starter) openOnFirstRun(starter.home);
      await openVault(path, create, create ? name : undefined, starter?.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  const submit = (run: () => void) => (event: FormEvent) => {
    event.preventDefault();
    run();
  };

  return (
    <div className="mx-auto w-full max-w-[760px] px-6 pb-20 pt-16">
      <div className="flex items-center gap-3">
        <BrandMark tile className="size-12" />
        <div className="flex-1">
          <h1 className="text-28 font-bold tracking-tight">{onCancel ? "Switch vault" : "Welcome to KastenFlow"}</h1>
          <p className="text-14 text-muted">Your notes stay plain Markdown files in a folder you own, with history for every change.</p>
        </div>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-13 ring-1 ring-line hover:bg-hover">
            Cancel
          </button>
        )}
      </div>

      {problem && <p className="mt-6 rounded-xl bg-warning/10 px-4 py-3 text-13 text-warning">{problem}</p>}
      {choices?.fromEnv && (
        <p className="mt-6 rounded-xl bg-soft px-4 py-3 text-13">KASTEN_VAULT is set, so it opens instead of what you choose here until it is unset.</p>
      )}

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Card icon="sparkle" title="Create a new vault" detail="A folder in KastenFlow’s own format: projects, journal, inbox, templates and tags, with history from the start.">
          <form onSubmit={submit(() => void go(where, true, "Creating…"))} className="flex flex-1 flex-col gap-2">
            <Field label="Name" value={name} onChange={setName} placeholder="Kasten" />
            <Field label="Location" value={location} onChange={setLocation} placeholder="~/Documents" mono browse={choices ? () => setPicking("location") : undefined} />
            {where && (
              <p className="text-12 text-muted">
                Creates <code className="font-mono text-12 text-ink">{where}</code>
              </p>
            )}
            <SyncedNote app={syncedWhere} />
            <KitChoice kits={kits} value={kit} onChange={setKit} />
            <div className="flex-1" />
            <Button busy={busy === "Creating…"} disabled={Boolean(busy)} primary>
              {busy === "Creating…" ? "Creating…" : "Create vault"}
            </Button>
          </form>
        </Card>
        <Card icon="folder-open" title="Open a folder" detail="A KastenFlow vault, or any folder of Markdown notes, such as an Obsidian vault: it says what it holds before you open it.">
          <form onSubmit={submit(() => void go(folder, false, "Opening…"))} className="flex flex-1 flex-col gap-2">
            <Field label="Folder" value={folder} onChange={setFolder} placeholder="~/Notes" mono browse={choices ? () => setPicking("folder") : undefined} />
            <FolderNote survey={survey} />
            <SyncedNote app={syncedFolder} />
            <div className="flex-1" />
            <Button busy={busy === "Opening…"} disabled={Boolean(busy) || survey?.kind === "newer"}>
              {busy === "Opening…" ? "Opening…" : survey?.kind === "kasten" ? "Open vault" : "Open folder"}
            </Button>
          </form>
        </Card>
      </div>

      <div className="mt-4">
        <RestoreCard location={location} onLocation={setLocation} />
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-danger/10 px-4 py-3 text-13 text-danger">
          {error}
        </p>
      )}

      {picking && (
        <FolderPicker
          title={picking === "location" ? "Where to make the vault" : "Open a folder"}
          start={picking === "location" ? location : folder || location}
          pickLabel={picking === "location" ? "Make it in" : "Choose"}
          onClose={() => setPicking(null)}
          onPick={(path) => {
            if (picking === "location") setLocation(path);
            else setFolder(path);
            setPicking(null);
          }}
        />
      )}

      {choices && choices.recent.length > 0 && (
        <section className="mt-10" aria-label="Recent vaults">
          <h2 className="text-12 font-medium tracking-[0.06em] text-muted">Recent</h2>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-canvas shadow-card">
            {choices.recent.map((path) => (
              <li key={path} className="flex items-center gap-3 px-4 py-2.5">
                <Icon name="folder" className="size-4 text-muted" />
                <span className="min-w-0 flex-1 truncate font-mono text-13" title={path}>
                  {path}
                </span>
                {path === choices.current ? (
                  <span className="text-12 text-muted">Open now</span>
                ) : (
                  <button type="button" disabled={Boolean(busy)} onClick={() => void go(path, false, "Opening…")} className="rounded-md px-2.5 py-1 text-13 ring-1 ring-line hover:bg-hover">
                    Open
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
