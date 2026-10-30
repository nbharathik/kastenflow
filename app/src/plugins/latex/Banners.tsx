// The lines above the editor when something needs a choice or a look: the
// file changed elsewhere on the same lines, or the text could not be saved.
// Each says what happened in one sentence and has the button for the way on.

import { Button } from "../../ui/Button";
import type { Snapshot } from "./session";

const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

export function Banners({ snap, onKeepMine, onUseDisk, onRetry }: { snap: Snapshot; onKeepMine(): void; onUseDisk(): void; onRetry(): void }) {
  return (
    <>
      {snap.conflict && (
        <div className="latex-banner is-warning" role="alert">
          <span>
            {nameOf(snap.conflict.path)} was changed somewhere else on the same lines. Your text is kept in “{nameOf(snap.conflict.copy)}”.
          </span>
          <Button size="sm" onClick={onKeepMine}>
            Keep my text
          </Button>
          <Button size="sm" onClick={onUseDisk}>
            Use the file on disk
          </Button>
        </div>
      )}
      {snap.saveProblem && !snap.conflict && (
        <div className="latex-banner is-danger" role="alert">
          <span>Your changes are not saved: {snap.saveProblem}</span>
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </>
  );
}
