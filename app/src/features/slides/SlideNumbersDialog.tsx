import { useEffect, useState } from "react";

import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Modal";
import { saveDecksWasStale } from "../../lib/vault/types";
import { useWorkspace } from "../workspace/store";
import { deckFilesChanged } from "./events";
import { type NumberedDecks, decksWithNumbers, numbersMessage } from "./slide-numbers";
import { useSlideNumbers } from "./slide-numbers-state";
import { useDecks } from "./store";

const decks = (n: number) => `${n} deck${n === 1 ? "" : "s"}`;

/**
 * Turns slide numbers off in every deck of the vault that shows them. The decks are looked at first and listed; nothing is written until the
 * person says so, and then every deck is written or none, as one change that Undo takes back whole. A deck that cannot be read is listed apart
 * and left as it is. Open decks save themselves a moment after a change, so a deck being typed in is saved first.
 */
export function SlideNumbersDialog() {
  const [found, setFound] = useState<NumberedDecks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => useSlideNumbers.getState().hide();

  /** Looks at the decks; `keepSaid` keeps what the last try said while the list is made again. */
  const look = (keepSaid = false) => {
    const client = useWorkspace.getState().client;
    if (!client) return;
    setFound(null);
    if (!keepSaid) setError(null);
    decksWithNumbers(client).then(setFound, (err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };
  useEffect(() => {
    look();
  }, []);

  const apply = async () => {
    const client = useWorkspace.getState().client;
    if (!client || !found || found.affected.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    const { toast } = useWorkspace.getState();
    try {
      const saved = await client.saveDecks({ message: numbersMessage(found.affected.length), edits: found.affected.map(({ path, baseHash, text }) => ({ path, baseHash, text })) });
      deckFilesChanged(saved.paths);
      void useDecks.getState().load();
      close();
      const commit = saved.commit;
      toast(
        `Turned slide numbers off in ${decks(saved.paths.length)}.`,
        commit
          ? {
              label: "Undo",
              run: () => {
                void client.undoCommit(commit).then(
                  (undone) => {
                    if (undone.conflict) return toast(`Not undone: ${undone.conflict.path} changed since (${undone.conflict.detail.toLowerCase()}).`);
                    deckFilesChanged(saved.paths);
                    void useDecks.getState().load();
                    toast("Slide numbers are back.");
                  },
                  (err: unknown) => toast(err instanceof Error ? err.message : String(err)),
                );
              },
            }
          : undefined,
      );
    } catch (err) {
      // A deck that changed since it was looked at: nothing was written, and the list is made again.
      if (saveDecksWasStale(err)) {
        setError("A deck changed while this was open, so nothing was saved. The list is made again.");
        look(true);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const affected = found?.affected ?? [];
  return (
    <Modal label="Turn off slide numbers in every deck" onClose={close} className="w-[min(560px,94vw)] p-5">
      <h2 className="text-16 font-semibold">Turn off slide numbers in every deck</h2>
      {!found && !error && <p className="mt-3 text-13 text-muted">Looking at your decks…</p>}
      {found && affected.length === 0 && <p className="mt-3 text-13">No deck shows slide numbers. Nothing to change.</p>}
      {found && affected.length > 0 && (
        <>
          <p className="mt-3 text-13">
            {affected.length} of your {decks(found.looked)} show slide numbers. They are turned off in all of them at once, and Undo puts them back.
          </p>
          <ul aria-label="Decks that show slide numbers" className="mt-3 flex max-h-[min(260px,40vh)] flex-col gap-0.5 overflow-auto rounded-lg border border-line p-1">
            {affected.map((deck) => (
              <li key={deck.path} className="flex items-baseline justify-between gap-3 rounded px-2 py-1">
                <span className="min-w-0 truncate text-14">{deck.title}</span>
                <span className="min-w-0 truncate text-12 text-muted">{deck.path}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-12 text-muted">Save open decks first: a deck that changes while this is open is not written, and nothing is.</p>
        </>
      )}
      {found && found.unreadable.length > 0 && (
        <section aria-label="Decks that could not be read" className="mt-3">
          <h3 className="text-12 font-medium text-muted">Could not be read, so left as they are</h3>
          <ul className="mt-1 flex flex-col gap-0.5">
            {found.unreadable.map((deck) => (
              <li key={deck.path} className="text-13">
                {deck.title} <span className="text-12 text-muted">{deck.path}: {deck.why}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && (
        <p role="alert" className="mt-3 text-13 text-danger">
          {error}
        </p>
      )}
      <div className="mt-4 flex items-center justify-end gap-2">
        <Button onClick={close}>Cancel</Button>
        <Button tone="primary" disabled={affected.length === 0 || busy} onClick={() => void apply()}>
          {affected.length === 0 ? "Turn off" : `Turn off in ${decks(affected.length)}`}
        </Button>
      </div>
    </Modal>
  );
}

/** The dialog, when it is asked for (loaded then: the slide engine comes with it). */
export function SlideNumbersHost() {
  const open = useSlideNumbers((s) => s.open);
  return open ? <SlideNumbersDialog /> : null;
}
