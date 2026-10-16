// Above the message box, while a chat has changes staged: "3 changes ·
// Review · Apply · Discard". Review opens what they are, file by file; Apply
// writes them together; Discard throws them away (after asking). Nothing the
// chat staged is in the vault until Apply.

import "../../review/review.css";
import "./changes.css";

import { useState } from "react";

import { Icon } from "../../../ui/Icon";
import { BUTTON, Callout, ConfirmBar, PRIMARY } from "../../review/ui";
import type { Thread } from "../thread";
import { applyChanges, changesWords, discardChanges } from "./changes";
import { ChangeSetView } from "./ChangeSetView";

export function ChangeSetBar({ thread }: { thread: Thread }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<"apply" | "discard" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const count = thread.changes?.count ?? 0;
  if (count === 0) return null;
  const waiting = thread.streaming;

  const apply = async () => {
    setBusy("apply");
    setProblem(null);
    const done = await applyChanges(thread.id);
    setBusy(null);
    if (!done.ok) return setProblem(done.error);
    if (done.value.status === "stale") {
      setOpen(true);
      setProblem("Some files changed since the chat staged its changes, so nothing was written. Recalculate them below, or discard the changes.");
    }
  };
  const discard = async () => {
    setBusy("discard");
    const done = await discardChanges(thread.id);
    setBusy(null);
    setAsking(false);
    if (!done.ok) setProblem(done.error);
  };

  return (
    <section className="kasten-changes" aria-label="This chat's staged changes">
      {open && <ChangeSetView thread={thread} />}
      {problem && (
        <Callout tone="bad" icon="alert" role="alert">
          {problem}
        </Callout>
      )}
      {asking ? (
        <ConfirmBar title={`Discard ${changesWords(count)}?`} detail="They were never written to your notes, and are gone for good. The chat itself is kept." confirm="Discard changes" onConfirm={() => void discard()} onCancel={() => setAsking(false)} />
      ) : (
        <div className="kasten-changes-bar">
          <Icon name="agent" className="size-4" />
          <span className="kasten-changes-count" role="status">
            {changesWords(count)} to review
          </span>
          <button type="button" className={BUTTON} aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Hide" : "Review"}
          </button>
          <button type="button" className={PRIMARY} disabled={waiting || busy !== null} title={waiting ? "Wait for the answer to finish" : "Write these changes to your notes, as one change"} onClick={() => void apply()}>
            {busy === "apply" ? "Applying…" : "Apply"}
          </button>
          <button type="button" className={BUTTON} disabled={waiting || busy !== null} title={waiting ? "Wait for the answer to finish" : undefined} onClick={() => setAsking(true)}>
            Discard
          </button>
        </div>
      )}
    </section>
  );
}
