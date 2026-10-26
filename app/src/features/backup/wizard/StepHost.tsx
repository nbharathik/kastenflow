// Another git host (GitLab, Gitea, Bitbucket, your own server): an address,
// and for an https one a token that is checked and kept for that server only.

import { useState } from "react";

import { Button } from "../../../ui/Button";
import { httpsOrigin } from "../parts";
import { backUpToHost } from "./job";
import { useBackupWizard } from "./state";

export function StepHost() {
  const [address, setAddress] = useState("");
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const wanted = address.trim();
  const https = httpsOrigin(wanted) !== null;

  return (
    <form
      className="kasten-wiz-stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (wanted) void backUpToHost(wanted, username, https ? token : "");
      }}
    >
      <p className="kasten-wiz-lead">Make an empty private repository on your host first, then paste its address.</p>
      <label className="kasten-wiz-label">
        Repository address
        <input className="ui-field" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="https://git.example.com/you/notes.git" spellCheck={false} autoComplete="off" />
      </label>
      {https ? (
        <>
          <label className="kasten-wiz-label">
            User name (if your host asks for one)
            <input className="ui-field" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
          </label>
          <label className="kasten-wiz-label">
            Token
            <input className="ui-field" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <p className="kasten-wiz-note">The token is sent to that server only and kept in this computer's keychain.</p>
        </>
      ) : (
        wanted && <p className="kasten-wiz-note">An ssh address signs in with the SSH key this computer already uses for that host.</p>
      )}
      <footer className="kasten-wiz-foot">
        <Button tone="quiet" onClick={() => useBackupWizard.getState().go("where")}>
          Back
        </Button>
        <Button type="submit" tone="primary" disabled={!wanted}>
          Save and back up
        </Button>
      </footer>
    </form>
  );
}
