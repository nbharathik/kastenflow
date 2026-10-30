// Signing in to GitHub by code: the code is asked for, copied and the page
// opened by itself; the answer arrives as an event. Reopening the panel
// asks for a new code (a code lives about 15 minutes).

import { useCallback, useEffect, useRef, useState } from "react";

import { openUrl } from "../../../lib/api";
import { githubAccount, githubSignInCancel, githubSignInStart, onSignIn, type SignInCode } from "../api";
import { sentence } from "./api";
import { useBackupWizard } from "./state";

export type SignInView =
  | { state: "starting" }
  | { state: "waiting"; code: SignInCode }
  | { state: "expired" | "denied" | "disabled" }
  | { state: "failed"; message: string };

/** Moves on to the repository step as `login`. */
export function signedInAs(login: string): void {
  useBackupWizard.getState().patch({ login });
  useBackupWizard.getState().go("repo");
}

export function useSignIn(): { view: SignInView; again: () => void } {
  const [view, setView] = useState<SignInView>({ state: "starting" });
  // A code is asked for once per showing, even where React draws twice.
  const asked = useRef(0);

  const start = useCallback(async () => {
    const turn = ++asked.current;
    setView({ state: "starting" });
    try {
      const account = await githubAccount();
      if (turn !== asked.current) return;
      if (account.signedIn && account.login) return signedInAs(account.login);
      if (!account.canSignIn) return setView({ state: "disabled" });
      const code = await githubSignInStart();
      if (turn !== asked.current) return;
      setView({ state: "waiting", code });
      void navigator.clipboard?.writeText(code.userCode).catch(() => {});
      void openUrl(code.verificationUri).catch(() => {});
    } catch (err) {
      if (turn === asked.current) setView({ state: "failed", message: sentence(err) });
    }
  }, []);

  useEffect(() => {
    void start();
    const stop = onSignIn((end) => {
      if (end.state === "signed") signedInAs(end.login);
      else if (end.state === "failed") setView({ state: "failed", message: end.message });
      else setView({ state: end.state });
    });
    return () => {
      asked.current++;
      stop();
      void githubSignInCancel().catch(() => {});
    };
  }, [start]);

  return { view, again: () => void start() };
}
