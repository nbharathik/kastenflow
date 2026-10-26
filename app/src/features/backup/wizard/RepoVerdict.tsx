// A repository that cannot be used yet: a public one (the choice is the
// person's, in red), or one that holds something else (three ways out).

import { useState } from "react";

import { Button } from "../../../ui/Button";
import type { RepoRow } from "../../../lib/vault/backup-types";
import { call, sentence } from "./api";
import { linkBackup } from "./job";
import { useBackupWizard, type Verdict } from "./state";

interface Props {
  verdict: Verdict;
  /** Back to making a new repository. */
  onCreateNew: () => void;
}

export function RepoVerdict({ verdict, onCreateNew }: Props) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { patch } = useBackupWizard.getState();
  const pickAnother = () => patch({ verdict: null });

  const goOn = async (change: () => Promise<unknown>, repo: RepoRow, kept: Verdict & { kind: "public" }) => {
    setBusy(true);
    setProblem(null);
    try {
      await change();
      void linkBackup(repo, kept.protection);
    } catch (err) {
      setProblem(sentence(err));
      setBusy(false);
    }
  };

  if (verdict.kind === "public") {
    const { repo } = verdict;
    return (
      <section className="kasten-wiz-warn" aria-labelledby="kasten-wiz-public">
        <h3 id="kasten-wiz-public" className="kasten-wiz-warn-title">
          {repo.fullName} is public
        </h3>
        <p>Anyone on the internet can read your notes in a public repository. Nothing is backed up until you choose.</p>
        <div className="kasten-wiz-row">
          <Button tone="danger" disabled={busy} onClick={() => void goOn(() => call("github_make_private", { repo: repo.fullName }), { ...repo, visibility: "private" }, verdict)}>
            Make it private
          </Button>
          <Button disabled={busy} onClick={() => void goOn(() => call("github_allow_public", { repo: repo.fullName }), repo, verdict)}>
            I want a public backup
          </Button>
          <Button tone="quiet" disabled={busy} onClick={pickAnother}>
            Pick another
          </Button>
        </div>
        {problem && (
          <p role="alert" className="kasten-wiz-problem">
            {problem}
          </p>
        )}
      </section>
    );
  }

  const { repo } = verdict;
  return (
    <section className="kasten-wiz-warn" aria-labelledby="kasten-wiz-unrelated">
      <h3 id="kasten-wiz-unrelated" className="kasten-wiz-warn-title">
        {repo.fullName} holds something else
      </h3>
      <p>It has content that is not this vault, so KastenFlow will not write into it.</p>
      <div className="kasten-wiz-row">
        <Button tone="primary" onClick={pickAnother}>
          Pick another
        </Button>
        <Button
          onClick={() => {
            pickAnother();
            onCreateNew();
          }}
        >
          Create a new one
        </Button>
        <Button onClick={() => patch({ picker: { kind: "restore", repo } })}>Restore that backup into a new folder</Button>
      </div>
    </section>
  );
}
