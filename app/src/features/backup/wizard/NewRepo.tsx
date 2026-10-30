// "Create a new private repo": the name is filled in from the vault and checked
// as it is typed; one click makes it and backs up. A name that is taken is not
// a dead end: one button uses the repository that has it.

import { useEffect, useRef, useState } from "react";

import { Button } from "../../../ui/Button";
import type { RepoRow } from "../../../lib/vault/backup-types";
import { githubAccount } from "../api";
import { call } from "./api";
import { rowFor } from "./choose";
import { createBackup } from "./job";
import { useBackupWizard } from "./state";

type Check = "checking" | "free" | "taken" | "unknown";
const CHECK_AFTER_MS = 300;

export function NewRepo({ onUseExisting }: { onUseExisting: (repo: RepoRow) => void }) {
  const login = useBackupWizard((s) => s.login);
  const taken = useBackupWizard((s) => s.taken);
  const [name, setName] = useState("");
  const [check, setCheck] = useState<Check>("checking");
  const asked = useRef(0);

  useEffect(() => {
    let live = true;
    githubAccount().then(
      (account) => live && setName((was) => was || account.suggested || "my-notes"),
      () => live && setName((was) => was || "my-notes"),
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const clean = name.trim();
    if (!clean) return;
    const turn = ++asked.current;
    setCheck("checking");
    const timer = setTimeout(() => {
      call("github_name_available", { name: clean }).then(
        (free) => turn === asked.current && setCheck(free ? "free" : "taken"),
        () => turn === asked.current && setCheck("unknown"),
      );
    }, CHECK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [name]);

  const clean = name.trim();
  const existing = taken ? taken.fullName : login && clean ? `${login}/${clean}` : null;
  const isTaken = check === "taken" || taken !== null;

  return (
    <form
      className="kasten-wiz-stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (clean && check !== "taken") void createBackup(clean);
      }}
    >
      <p className="kasten-wiz-note">KastenFlow makes a private repository in your account, described as “KastenFlow vault backup” and tagged kastenflow-vault.</p>
      <label className="kasten-wiz-label">
        Repository name
        <input
          className="ui-field"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            useBackupWizard.getState().patch({ taken: null });
          }}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <p role="status" className="kasten-wiz-note" data-state={isTaken ? "taken" : check}>
        {isTaken
          ? "That name is taken — use the existing repo?"
          : check === "checking"
            ? "Checking the name…"
            : check === "free"
              ? "That name is free."
              : "Could not check the name now; making it will tell."}
      </p>
      <div className="kasten-wiz-row">
        {isTaken && existing ? (
          <Button type="button" tone="primary" onClick={() => onUseExisting(taken ?? rowFor(existing))}>
            Use {taken ? taken.fullName : existing}
          </Button>
        ) : (
          <Button type="submit" tone="primary" disabled={!clean}>
            Create private repo
          </Button>
        )}
      </div>
    </form>
  );
}
