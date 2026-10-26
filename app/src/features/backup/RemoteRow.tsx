// A backup remote on any git host: its address, and for an https one, a
// token that signs in to that server only. The token is checked against
// the remote first and kept in the system's keychain, never in the vault.

import { useEffect, useState } from "react";

import type { VaultConfig } from "../../lib/vault/types";
import { useVaultStatus } from "../workspace/status";
import { useWorkspace } from "../workspace/store";
import { canBackUp, gitTokenSave } from "./api";
import { BUTTON, FIELD, httpsOrigin, message, type RowComponent } from "./parts";

export function RemoteRow({ Row }: { Row: RowComponent }) {
  const client = useWorkspace((s) => s.client);
  const [config, setConfig] = useState<VaultConfig | null>(null);
  const [remote, setRemote] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<{ username: string; secret: string } | null>(null);
  const { toast } = useWorkspace.getState();

  useEffect(() => {
    client?.getConfig().then(
      (found) => {
        setConfig(found);
        setRemote(found.git.remote ?? "");
      },
      () => {},
    );
  }, [client]);

  if (!client) return null;
  const saved = config?.git.remote ?? null;
  const origin = saved ? httpsOrigin(saved) : null;
  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    try {
      await job();
    } catch (err) {
      toast(message(err));
    } finally {
      setBusy(false);
      void useVaultStatus.getState().refresh();
    }
  };
  const save = () =>
    run(async () => {
      // The config as it is now, which other settings may have changed
      // since this was drawn: only the remote changes.
      const current = await client.getConfig();
      const wanted = remote.trim() || null;
      const next = { ...current, git: { ...current.git, remote: wanted } };
      await client.setConfig(next);
      setConfig(next);
      toast(wanted ? "Backup remote saved" : "Backup turned off");
    });
  const keep = (url: string, given: { username: string; secret: string }) =>
    run(async () => {
      const kept = await gitTokenSave(url, given.secret, given.username);
      setToken(null);
      toast(kept.remembered ? `Token saved for ${httpsOrigin(url)}` : "Token works. This computer has no keychain KastenFlow can use, so it lasts until KastenFlow quits");
    });

  return (
    <>
      <Row label="Backup remote" detail="A private git repository on any host, such as GitLab, Gitea or your own server. Changes are sent 2 minutes after you make them, and at least once an hour. Nothing on the server is ever overwritten.">
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (config) void save();
          }}
        >
          <input value={remote} onChange={(e) => setRemote(e.target.value)} placeholder="https://git.example.com/you/notes.git" aria-label="Backup remote" className={`${FIELD} w-[220px]`} />
          <button type="submit" className={BUTTON} disabled={busy || !config || remote.trim() === (saved ?? "")}>
            Save
          </button>
          {origin && canBackUp() && !token && (
            <button type="button" className={BUTTON} disabled={busy} onClick={() => setToken({ username: "", secret: "" })}>
              Token…
            </button>
          )}
        </form>
      </Row>
      {origin && token && saved && (
        <Row label={`Token for ${origin}`} detail="A personal access token that can read and write this repository. It is checked now and sent to this server only.">
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void keep(saved, token);
            }}
          >
            {origin !== "https://github.com" && (
              <input value={token.username} onChange={(e) => setToken({ ...token, username: e.target.value })} placeholder="User name" aria-label="User name" className={`${FIELD} w-[110px]`} />
            )}
            <input type="password" value={token.secret} onChange={(e) => setToken({ ...token, secret: e.target.value })} placeholder="Token" aria-label="Token" autoComplete="off" className={`${FIELD} w-[160px]`} />
            <button type="submit" className={BUTTON} disabled={busy || !token.secret.trim()}>
              {busy ? "Checking…" : "Save"}
            </button>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => setToken(null)}>
              Cancel
            </button>
          </form>
        </Row>
      )}
    </>
  );
}
