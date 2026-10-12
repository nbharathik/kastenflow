// Back up to GitHub: sign in by typing a code at GitHub, then Kasten makes a
// private repository for this vault and backs up into it. Signing out
// forgets the token here and offers GitHub's page for taking access back.

import { useEffect, useState } from "react";

import { openUrl } from "../../lib/api";
import { useVaultStatus } from "../workspace/status";
import { useWorkspace } from "../workspace/store";
import { githubAccount, githubCreateBackup, githubSignInCancel, githubSignInStart, githubSignOut, onSignIn, type GitHubAccount, type SignInCode, type SignInEnd } from "./api";
import { BUTTON, FIELD, message, type RowComponent } from "./parts";
import { SignInDialog } from "./SignInDialog";

import "./backup.css";

/** What an ended sign-in says, when it did not sign in. */
export function signInProblem(end: SignInEnd): string | null {
  switch (end.state) {
    case "signed":
      return null;
    case "expired":
      return "The code ran out before it was typed. Sign in again";
    case "denied":
      return "GitHub sign-in was cancelled";
    case "disabled":
      return "This copy of KastenFlow can't sign in by code. Paste a token instead";
    case "failed":
      return end.message;
  }
}

export function GitHubRow({ Row }: { Row: RowComponent }) {
  const remote = useVaultStatus((s) => s.status?.remote ?? null);
  const [account, setAccount] = useState<GitHubAccount | null>(null);
  const [code, setCode] = useState<SignInCode | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast } = useWorkspace.getState();

  const load = () =>
    githubAccount().then((found) => {
      setAccount(found);
      setName((was) => was || (found.suggested ?? ""));
    }, () => {});
  useEffect(() => {
    void load();
    return onSignIn((end) => {
      setCode(null);
      const problem = signInProblem(end);
      toast(problem ?? `Signed in to GitHub as ${end.state === "signed" ? end.login : ""}`);
      void load();
    });
    // Once, on showing.
  }, []);

  if (!account || (!account.signedIn && !account.canSignIn)) return null;
  const onGitHub = remote?.startsWith("https://github.com/") ?? false;

  const start = async () => {
    try {
      setCode(await githubSignInStart());
    } catch (err) {
      toast(message(err));
    }
  };
  const create = async () => {
    setBusy(true);
    try {
      const repo = await githubCreateBackup(name.trim());
      toast(`Backed up to ${repo.fullName} on GitHub`, { label: "Open", run: () => void openUrl(repo.htmlUrl) });
    } catch (err) {
      toast(message(err));
    } finally {
      setBusy(false);
      void useVaultStatus.getState().refresh();
    }
  };
  const signOut = async () => {
    try {
      const revoke = await githubSignOut();
      toast("Signed out of GitHub on this computer", revoke ? { label: "Revoke access", run: () => void openUrl(revoke) } : undefined);
      void load();
    } catch (err) {
      toast(message(err));
    }
  };

  return (
    <>
      {!account.signedIn ? (
        <Row label="Back up to GitHub" detail="Sign in, and KastenFlow makes a private repository in your account for this vault.">
          <button type="button" className={BUTTON} onClick={() => void start()}>
            Sign in with GitHub
          </button>
        </Row>
      ) : onGitHub ? (
        <Row label="GitHub" detail={`Signed in as ${account.login ?? "you"}`} help={`This vault backs up to ${remote?.replace("https://github.com/", "").replace(/\.git$/, "")}.`}>
          <button type="button" className={BUTTON} onClick={() => void signOut()}>
            Sign out
          </button>
        </Row>
      ) : (
        <Row label="Back up to GitHub" detail={`Signed in as ${account.login ?? "you"}. Make a private repository for this vault and back up into it.`}>
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Repository name" className={`${FIELD} w-[160px]`} />
            <button type="submit" className={BUTTON} disabled={busy || !name.trim()}>
              {busy ? "Making…" : "Create"}
            </button>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => void signOut()}>
              Sign out
            </button>
          </form>
        </Row>
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
    </>
  );
}
