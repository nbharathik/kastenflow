// Step 3: the repository. A new private one is the default (one click, the
// name filled in); an existing private one can be chosen instead.

import { useState } from "react";

import type { RepoRow } from "../../../lib/vault/backup-types";
import { Button } from "../../../ui/Button";
import { Segmented } from "../../../ui/Segmented";
import { chooseRepo } from "./choose";
import { ExistingRepo } from "./ExistingRepo";
import { NewRepo } from "./NewRepo";
import { RepoVerdict } from "./RepoVerdict";
import { useBackupWizard } from "./state";

type Mode = "new" | "existing";

export function StepRepo() {
  const verdict = useBackupWizard((s) => s.verdict);
  const login = useBackupWizard((s) => s.login);
  // A repository held back came from the list: "Pick another" goes back to it.
  const [mode, setMode] = useState<Mode>(verdict ? "existing" : "new");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const choose = async (repo: RepoRow) => {
    setBusy(true);
    setProblem(null);
    const said = await chooseRepo(repo);
    setBusy(false);
    if (said) {
      setProblem(said);
      setMode("existing");
    }
  };

  return (
    <>
      {login && <p className="kasten-wiz-note">Signed in to GitHub as {login}.</p>}
      {verdict ? (
        <RepoVerdict
          verdict={verdict}
          onCreateNew={() => {
            setMode("new");
            useBackupWizard.getState().patch({ verdict: null });
          }}
        />
      ) : (
        <>
          <Segmented
            radio
            label="Repository"
            value={mode}
            onChange={setMode}
            choices={[
              { value: "new", label: "Create a new private repo" },
              { value: "existing", label: "Use an existing private repo" },
            ]}
          />
          {mode === "new" ? <NewRepo onUseExisting={(repo) => void choose(repo)} /> : <ExistingRepo busy={busy} onChoose={(repo) => void choose(repo)} onCreateNew={() => setMode("new")} />}
          {problem && (
            <p role="alert" className="kasten-wiz-problem">
              {problem}
            </p>
          )}
        </>
      )}
      <footer className="kasten-wiz-foot">
        <Button tone="quiet" onClick={() => useBackupWizard.getState().go("where")}>
          Back
        </Button>
      </footer>
    </>
  );
}
