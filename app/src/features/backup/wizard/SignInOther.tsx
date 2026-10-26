// "Other ways to sign in": a fine-grained token, or the GitHub command line
// when it is installed and signed in. Both end the same way as the code.

import { useEffect, useState } from "react";

import { openUrl } from "../../../lib/api";
import { Button } from "../../../ui/Button";
import { Disclosure } from "../../../ui/Disclosure";
import { call, sentence } from "./api";
import { signedInAs } from "./use-sign-in";

export function SignInOther({ open }: { open: boolean }) {
  const [cli, setCli] = useState(false);
  const [token, setToken] = useState("");
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    call("github_gh_cli_available").then(
      (found) => live && setCli(found),
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);

  const attempt = async (job: () => Promise<{ login: string }>) => {
    setBusy(true);
    setProblem(null);
    try {
      signedInAs((await job()).login);
    } catch (err) {
      setProblem(sentence(err));
      setBusy(false);
    }
  };

  return (
    <Disclosure title="Other ways to sign in" defaultOpen={open} key={open ? "open" : "closed"}>
      <form
        className="kasten-wiz-stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (token.trim()) void attempt(() => call("github_token_sign_in", { token: token.trim(), repo: repo.trim() || null }));
        }}
      >
        <p className="kasten-wiz-note">
          Make a fine-grained token that can read and write contents. GitHub's page opens with the name and the permission filled in.
        </p>
        <div className="kasten-wiz-row">
          <Button onClick={() => void call("github_token_page").then((url) => openUrl(url), (err) => setProblem(sentence(err)))}>Open GitHub's token page</Button>
        </div>
        <label className="kasten-wiz-label">
          Token
          <input type="password" className="ui-field" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <label className="kasten-wiz-label">
          Repository to use (optional)
          <input className="ui-field" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="you/my-notes" spellCheck={false} />
        </label>
        <div className="kasten-wiz-row">
          <Button type="submit" tone="primary" disabled={busy || !token.trim()}>
            {busy ? "Checking…" : "Sign in with token"}
          </Button>
          {cli && (
            <Button disabled={busy} onClick={() => void attempt(() => call("github_gh_cli_sign_in"))}>
              Use the GitHub command line
            </Button>
          )}
        </div>
        {problem && (
          <p role="alert" className="kasten-wiz-problem">
            {problem}
          </p>
        )}
      </form>
    </Disclosure>
  );
}
