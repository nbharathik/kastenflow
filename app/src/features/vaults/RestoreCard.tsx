// Restore from a backup, on a new computer or after losing one: from a
// private GitHub repository (after signing in), any git address (with a
// token if it needs one), or a backup file. It goes into a new, empty
// folder, and Kasten restarts on it with that backup confirmed.

import { useEffect, useState } from "react";

import { canBackUp, githubAccount, githubSignInCancel, githubSignInStart, onSignIn, restoreFromFile, restoreFromGit, type GitHubAccount, type SignInCode } from "../backup/api";
import type { RepoRow } from "../../lib/vault/backup-types";
import { GitHubBackups } from "./GitHubBackups";
import { httpsOrigin } from "../backup/parts";
import { signInProblem } from "../backup/GitHubRow";
import { SignInDialog } from "../backup/SignInDialog";
import { Segmented } from "../../ui/Segmented";
import { writeEverything } from "../workspace/page/before-exit";
import { FolderPicker } from "./FolderPicker";
import { Button, Card, Field } from "./parts";
import { SyncedNote, useSynced } from "./SyncedNote";
import { folderName, inside } from "./paths";

type From = "github" | "git" | "file";
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function RestoreCard({ location, onLocation }: { location: string; onLocation: (path: string) => void }) {
  const [from, setFrom] = useState<From>("file");
  const [account, setAccount] = useState<GitHubAccount | null>(null);
  const [repo, setRepo] = useState<RepoRow | null>(null);
  const [code, setCode] = useState<SignInCode | null>(null);
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [file, setFile] = useState("");
  const [name, setName] = useState("Kasten");
  const [picking, setPicking] = useState<"file" | "location" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAccount = () => githubAccount().then(setAccount, () => {});
  useEffect(() => {
    if (!canBackUp()) return;
    void loadAccount();
    return onSignIn((end) => {
      setCode(null);
      const problem = signInProblem(end);
      if (problem) setError(problem);
      void loadAccount();
    });
    // Once, on showing.
  }, []);
  const where = location.trim() ? inside(location.trim(), folderName(name)) : "";
  const synced = useSynced(where);
  if (!canBackUp()) return null;

  const github = account?.canSignIn || account?.signedIn;
  const pickRepo = (chosen: RepoRow) => {
    setRepo(chosen);
    setName(chosen.name);
  };
  const restore = async () => {
    if (!where) return setError("Choose where the restored vault goes.");
    setBusy(true);
    setError(null);
    try {
      await writeEverything();
      if (from === "file") await restoreFromFile(file, where);
      else if (from === "github" && repo) await restoreFromGit(repo.cloneUrl, where);
      else await restoreFromGit(url, where, secret, username);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };
  const ready = from === "file" ? file.trim() !== "" : from === "github" ? repo !== null : url.trim() !== "";

  return (
    <Card icon="restore" title="Restore from a backup" detail="On a new computer: bring a vault back, with all its history, into a new folder.">
      <form
        className="flex flex-1 flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void restore();
        }}
      >
        <Segmented
          label="Restore from"
          value={from}
          onChange={(next) => {
            setFrom(next);
            setError(null);
          }}
          choices={[
            { value: "file", label: "Backup file" },
            ...(github ? [{ value: "github" as const, label: "GitHub" }] : []),
            { value: "git", label: "Git address" },
          ]}
        />
        {from === "file" && <Field label="Backup file" value={file} onChange={setFile} placeholder="~/Dropbox/Kasten backup - Notes/….bundle" mono browse={() => setPicking("file")} />}
        {from === "github" &&
          (account?.signedIn ? (
            <GitHubBackups chosen={repo?.fullName ?? null} onChoose={pickRepo} />
          ) : (
            <button type="button" className="h-9 rounded-lg text-13 ring-1 ring-line hover:bg-hover" onClick={() => void githubSignInStart().then(setCode, (err: unknown) => setError(message(err)))}>
              Sign in to open my backup from GitHub
            </button>
          ))}
        {from === "git" && (
          <>
            <Field label="Git address" value={url} onChange={setUrl} placeholder="https://git.example.com/you/notes.git" mono />
            {httpsOrigin(url) && (
              <div className="flex gap-1.5">
                {httpsOrigin(url) !== "https://github.com" && <Field label="User name" value={username} onChange={setUsername} placeholder="Optional" />}
                <Field label="Token" value={secret} onChange={setSecret} placeholder="If the repository is private" secret />
              </div>
            )}
          </>
        )}
        <Field label="Name" value={name} onChange={setName} placeholder="Kasten" />
        <Field label="Location" value={location} onChange={onLocation} placeholder="~/Documents" mono browse={() => setPicking("location")} />
        {where && (
          <p className="text-12 text-muted">
            Restores into <code className="font-mono text-12 text-ink">{where}</code>, which must be empty
          </p>
        )}
        <SyncedNote app={synced} />
        {error && (
          <p role="alert" className="text-13 text-danger">
            {error}
          </p>
        )}
        <div className="flex-1" />
        <Button busy={busy} disabled={busy || !ready}>
          {busy ? "Restoring…" : "Restore"}
        </Button>
      </form>
      {picking && (
        <FolderPicker
          title={picking === "file" ? "Choose a backup file" : "Where the restored vault goes"}
          start={picking === "location" ? location : undefined}
          files={picking === "file" ? "bundle" : undefined}
          pickLabel={picking === "file" ? "Use" : "Restore in"}
          onClose={() => setPicking(null)}
          onPick={(path) => {
            if (picking === "file") setFile(path);
            else onLocation(path);
            setPicking(null);
          }}
        />
      )}
      {code && (
        <SignInDialog
          code={code}
          onCancel={() => {
            setCode(null);
            void githubSignInCancel();
          }}
        />
      )}
    </Card>
  );
}
