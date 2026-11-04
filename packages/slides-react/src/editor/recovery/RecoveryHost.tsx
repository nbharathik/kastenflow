import type { JSX } from "react";
import { useEffect, useMemo, useState } from "react";

import { readDeck } from "../dialogs/import-layouts.ts";
import { SlideThumb, useImageUrl } from "../filmstrip/SlideThumb.tsx";
import { compareDecks } from "../history/compare.ts";
import { savedText } from "../history/DeckHistoryDialog.tsx";
import type { EditorSession } from "../session/session.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { type Offer, detect, discard, follow, journalOf, recover } from "./recovery.ts";
import "../history/history.css";

/** The most changed slides drawn in the preview. */
const MOST_SHOWN = 6;

function RecoverDialog({ session, offer, onRecover, onDiscard, onLater }: { session: EditorSession; offer: Offer; onRecover(): void; onDiscard(): void; onLater(): void }): JSX.Element {
  const imageUrl = useImageUrl(session);
  const kept = useMemo(() => readDeck(offer.entry.text), [offer]);
  const rows = useMemo(() => compareDecks(session.deck, kept), [session, kept]);
  const changed = rows.filter((row) => row.how !== "same");
  return (
    <Dialog
      title="Recover unsaved changes?"
      width={560}
      onClose={onLater}
      footer={
        <>
          <TextButton onClick={onDiscard}>Discard</TextButton>
          <TextButton primary data-autofocus="" onClick={onRecover}>
            Recover
          </TextButton>
        </>
      }
    >
      <p className="ks-hs-note">
        KastenFlow found changes to this deck from {savedText(offer.entry.time)} that were never saved
        {changed.length > 0 ? `: ${changed.length} slide${changed.length === 1 ? "" : "s"} differ from the saved deck.` : "."}
      </p>
      {offer.fileChanged ? (
        <p className="ks-hs-note" role="alert">
          The saved deck has changed since then. Recovering puts these changes in its place; you can undo that.
        </p>
      ) : null}
      <div className="ks-rc-previews" aria-label="Slides that differ">
        {changed.slice(0, MOST_SHOWN).map((row) =>
          row.after ? (
            <figure key={row.id} className="ks-rc-item">
              <SlideThumb deck={kept} slide={row.after} number={Math.max(1, kept.slides.findIndex((s) => s.id === row.id) + 1)} count={kept.slides.length} width={150} imageUrl={imageUrl} />
              <figcaption>{row.how === "added" ? "Added" : "Changed"}</figcaption>
            </figure>
          ) : (
            <span key={row.id} className="ks-rc-item">
              A slide that was removed
            </span>
          ),
        )}
      </div>
      {changed.length > MOST_SHOWN ? <p className="ks-hs-note">and {changed.length - MOST_SHOWN} more.</p> : null}
      <p className="ks-hs-note">Discarding keeps them aside on this computer, outside your vault, but does not bring them back.</p>
    </Dialog>
  );
}

/**
 * Keeps the journal of unsaved edits for the deck and, when the deck is opened and the journal holds edits the file never got, offers to
 * recover them. Until that is settled nothing new is written to the journal, so the edits on offer cannot be overwritten. Where there is no
 * journal (a host with none and a page without IndexedDB) it does nothing at all.
 */
export function RecoveryHost({ session }: { session: EditorSession }): JSX.Element | null {
  const journal = useMemo(() => journalOf(session.host), [session]);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!journal) return;
    let live = true;
    void detect(session, journal).then((found) => {
      if (!live) return;
      if (found) setOffer(found);
      else setSettled(true);
    });
    return () => {
      live = false;
    };
  }, [journal, session]);

  useEffect(() => {
    if (!journal || !settled) return;
    return follow(session, journal);
  }, [journal, settled, session]);

  if (!journal || !offer) return null;
  return (
    <RecoverDialog
      session={session}
      offer={offer}
      onRecover={() => {
        recover(session, offer);
        setOffer(null);
        setSettled(true);
      }}
      onDiscard={() => {
        void discard(session, journal);
        setOffer(null);
        setSettled(true);
      }}
      // "Not now": the edits stay where they are, and nothing is written over them until the deck is opened again.
      onLater={() => setOffer(null)}
    />
  );
}
