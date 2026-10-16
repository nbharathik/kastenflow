// Renaming a citation key changes it everywhere it is cited: the reference
// itself, every page that cites it as [@key], the citations in decks and the
// pictures that name it. The vault works out what that would change before
// anything is written; this shows it, and Apply makes the whole change as one
// step that Undo takes back.

import { useEffect, useId, useState } from "react";

import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Modal";
import type { KeyRenamePlan } from "../../lib/vault/reference-types";
import { useWorkspace } from "../workspace/store";
import { keyProblem } from "./keys";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const SHOWN = 6;

type Planned = { state: "idle" } | { state: "asking" } | { state: "refused"; why: string } | { state: "ready"; plan: KeyRenamePlan };

/** What the plan changes, in a sentence. */
export function summaryOf(plan: KeyRenamePlan): string {
  const parts = [plural(plan.pages.length, "page"), plural(plan.decks.length, "deck"), plural(plan.assets.length, "picture")];
  return `This changes the key in the reference and in ${parts.join(", ")}.`;
}

export function RenameDialog({ keyName, onClose, onRenamed }: { keyName: string; onClose(): void; onRenamed(to: string): void }) {
  const titleId = useId();
  const fieldId = useId();
  const [to, setTo] = useState(keyName);
  const [planned, setPlanned] = useState<Planned>({ state: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = to === keyName ? null : keyProblem(to.trim());

  useEffect(() => {
    const { client } = useWorkspace.getState();
    const wanted = to.trim();
    if (!client || wanted === keyName || keyProblem(wanted) !== null) {
      setPlanned({ state: "idle" });
      return;
    }
    let cancelled = false;
    setPlanned({ state: "asking" });
    const timer = setTimeout(() => {
      client.planKeyRename(keyName, wanted).then(
        (plan) => !cancelled && setPlanned({ state: "ready", plan }),
        (err: unknown) => !cancelled && setPlanned({ state: "refused", why: message(err) }),
      );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [to, keyName]);

  const apply = async () => {
    const { client, toast } = useWorkspace.getState();
    if (!client || planned.state !== "ready") return;
    setBusy(true);
    setError(null);
    try {
      const { plan } = planned;
      const done = await client.renameCitationKey(plan.from, plan.to, plan.bibHash);
      const commit = done.commit;
      const where = [done.pages > 0 ? plural(done.pages, "page") : "", done.decks > 0 ? plural(done.decks, "deck") : ""].filter(Boolean).join(" and ");
      toast(`Renamed “${done.from}” to “${done.to}”${where ? ` in ${where}` : ""}${done.layouts > 0 ? `; ${plural(done.layouts, "citation")} in deck layouts were left as they were` : ""}`, commit ? { label: "Undo", run: () => void client.undoCommit(commit).then(() => toast("Took back the rename"), (err: unknown) => toast(message(err))) } : undefined);
      onRenamed(done.to);
      onClose();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const plan = planned.state === "ready" ? planned.plan : null;
  return (
    <Modal labelledBy={titleId} onClose={onClose} className="ui-dialog">
      <h2 id={titleId} className="ui-dialog-title">
        Rename the key “{keyName}”
      </h2>
      <form
        className="ui-dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          void apply();
        }}
      >
        <label htmlFor={fieldId} className="text-12 font-medium text-ink">
          New key
        </label>
        <input id={fieldId} autoFocus type="text" className="ui-field font-mono" spellCheck={false} aria-invalid={problem !== null} value={to} onChange={(event) => setTo(event.target.value)} onFocus={(event) => event.currentTarget.select()} />
        {problem && (
          <p role="alert" className="text-12 text-danger">
            {problem}
          </p>
        )}
        {planned.state === "refused" && (
          <p role="alert" className="text-12 text-danger">
            {planned.why}
          </p>
        )}
        {planned.state === "asking" && <p className="text-12">Working out what it would change…</p>}
        {plan && (
          <section aria-label="What would change" className="rounded bg-well p-3 text-12 text-ink">
            <p>{summaryOf(plan)}</p>
            {plan.pages.length > 0 && (
              <ul className="mt-1 list-disc pl-4">
                {plan.pages.slice(0, SHOWN).map((page) => (
                  <li key={page.path}>
                    {page.title} ({plural(page.count, "citation")})
                  </li>
                ))}
                {plan.pages.length > SHOWN && <li>and {plan.pages.length - SHOWN} more pages</li>}
              </ul>
            )}
            {plan.decks.length > 0 && (
              <ul className="mt-1 list-disc pl-4">
                {plan.decks.slice(0, SHOWN).map((deck) => (
                  <li key={deck.path}>
                    {deck.title} ({plural(deck.count, "citation")}){deck.inLayouts > 0 ? `; ${plural(deck.inLayouts, "citation")} in its layouts stay as they are` : ""}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-muted">It is one step, and Undo takes it back whole.</p>
          </section>
        )}
        {error && (
          <p role="alert" className="text-13 text-danger">
            {error}
          </p>
        )}
        <footer className="ui-dialog-foot">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" tone="primary" disabled={!plan || busy}>
            {busy ? "Renaming…" : "Rename"}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
