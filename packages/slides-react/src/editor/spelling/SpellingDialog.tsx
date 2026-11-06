import { type JSX, useEffect, useRef, useState } from "react";

import type { DialogProps } from "../dialogs/types.ts";
import { setDictionary } from "../fonts/deck-ops.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { type Finding, check } from "./words.ts";
import "../dialogs/dialogs.css";
import "../fonts/fonts.css";

/** "Check spelling": the words of the deck that the dictionary does not know, with a way to each, to ignore it or to keep it in the deck's own list. */
export function SpellingDialog({ session, onClose }: DialogProps): JSX.Element {
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  // Which of a word's places the next "Go to" shows.
  const visits = useRef(new Map<string, number>());
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    const ask = session.host.misspelled ? (words: string[]) => session.host.misspelled?.(words) ?? Promise.resolve([]) : undefined;
    check(session.deck, [...(session.deck.present.dictionary ?? []), ...ignored], ask).then(
      (found) => live && setFindings(found),
      () => live && setFindings([]),
    );
    return () => {
      live = false;
    };
  }, [session, ignored, version]);

  const go = (finding: Finding) => {
    const at = visits.current.get(finding.word) ?? 0;
    const place = finding.places[at % finding.places.length];
    visits.current.set(finding.word, at + 1);
    if (!place) return;
    session.goTo(place.slideId);
    if (place.elementId) session.select([place.elementId]);
  };

  const withDictionary = session.host.misspelled !== undefined;
  return (
    <Dialog
      title="Check spelling"
      width={520}
      onClose={onClose}
      footer={
        <TextButton primary onClick={onClose}>
          Done
        </TextButton>
      }
    >
      <div className="ks-dg-form">
        {findings === null ? <p className="ks-dg-note">Reading the deck…</p> : null}
        {findings !== null && findings.length === 0 ? (
          <p className="ks-dg-note" role="status">
            {withDictionary ? "No word was found that the dictionary does not know." : "No likely slips were found."}
          </p>
        ) : null}
        <ul className="ks-fonts-files" aria-label="Words to look at">
          {(findings ?? []).map((finding) => (
            <li key={finding.word} className="ks-fonts-file">
              <span className="ks-fonts-name">
                {finding.word}
                <span className="ks-fonts-where">
                  {finding.count === 1 ? "once" : `${finding.count} times`}, slide {finding.places[0]?.number}
                  {finding.suggestion ? `, maybe “${finding.suggestion}”` : ""}
                </span>
              </span>
              <span className="ks-sp-actions">
                <TextButton onClick={() => go(finding)}>Go to</TextButton>
                {finding.suggestion ? (
                  <TextButton
                    onClick={() => {
                      session.elements.replaceAll(finding.word, finding.suggestion as string, { caseSensitive: true, wholeWord: true });
                      setVersion(version + 1);
                    }}
                  >
                    Change to “{finding.suggestion}”
                  </TextButton>
                ) : null}
                <TextButton onClick={() => setIgnored([...ignored, finding.word])}>Ignore</TextButton>
                <TextButton
                  onClick={() => {
                    if (setDictionary(session, { add: [finding.word] })) setVersion(version + 1);
                  }}
                >
                  Add to dictionary
                </TextButton>
              </span>
            </li>
          ))}
        </ul>
        {withDictionary ? null : <p className="ks-dg-note">This computer’s spell checker cannot be asked from here, so only words that look like a slip of a word the deck uses more often are listed.</p>}
      </div>
    </Dialog>
  );
}
