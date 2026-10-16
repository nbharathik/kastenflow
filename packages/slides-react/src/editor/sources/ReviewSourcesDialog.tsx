import { type JSX, useEffect, useMemo, useState } from "react";

import type { DialogProps } from "../dialogs/types.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Segmented, Toggle } from "../ui/Fields.tsx";
import { type Choice, type ReviewRow, applyReview, reviewSources, reviewedText } from "./review.ts";
import "./review.css";

const STATE_WORDS = {
  update: "The page changed. The slide is as it was made.",
  edited: "The page changed, and so did the slide.",
  missing: "The page, or the section, is not there any more.",
} as const;

/**
 * The slides made from pages, after the pages changed: the ones that are as they were made are ticked to be updated; the ones changed on both
 * sides ask what to do (keep yours, or replace it with the page's words); the ones whose page is gone are only listed. One step of undo.
 */
export function ReviewSourcesDialog({ session, onClose }: DialogProps): JSX.Element {
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [choices, setChoices] = useState<ReadonlyMap<string, Choice>>(new Map());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    reviewSources(session).then(
      (found) => {
        if (!live) return;
        setRows(found);
        setTicked(new Set(found.filter((row) => row.state === "update").map((row) => row.key)));
      },
      () => live && setRows([]),
    );
    return () => {
      live = false;
    };
  }, [session]);

  const will = useMemo(() => (rows ?? []).filter((row) => (row.state === "update" ? ticked.has(row.key) : row.state === "edited")).length, [rows, ticked]);

  const toggle = (key: string, on: boolean): void =>
    setTicked((now) => {
      const next = new Set(now);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const apply = async (): Promise<void> => {
    if (!rows || busy) return;
    setBusy(true);
    try {
      session.host.notify?.(reviewedText(await applyReview(session, rows, ticked, choices)));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Review slides made from pages"
      width={720}
      onClose={onClose}
      footer={
        <>
          <TextButton onClick={onClose}>Cancel</TextButton>
          <TextButton primary disabled={rows === null || will === 0 || busy} onClick={() => void apply()} data-autofocus="">
            {will === 0 ? "Apply" : will === 1 ? "Apply to 1 slide" : `Apply to ${will} slides`}
          </TextButton>
        </>
      }
    >
      {rows === null ? <p className="ks-rv-note">Looking at the pages…</p> : null}
      {rows?.length === 0 ? <p className="ks-rv-note">Every slide made from a page says what its page says. Nothing to review.</p> : null}
      {rows && rows.length > 0 ? (
        <ul className="ks-rv-list" aria-label="Slides to review">
          {rows.map((row) => (
            <li key={row.key} className={`ks-rv-row is-${row.state}`}>
              <div className="ks-rv-what">
                <span className="ks-rv-slide">
                  Slide {row.number}: {row.title}
                </span>
                <span className="ks-rv-page">{row.section ? `${row.pageTitle ?? row.page} › ${row.section}` : (row.pageTitle ?? row.page)}</span>
                <span className="ks-rv-state">{row.state === "missing" ? (row.reason ?? STATE_WORDS.missing) : STATE_WORDS[row.state]}</span>
                {row.unsure && row.state === "update" ? <span className="ks-rv-state">Whether you changed the slide cannot be told, so updating it may replace words you wrote.</span> : null}
              </div>
              {row.state === "update" ? <Toggle label={`Update slide ${row.number}`} on={ticked.has(row.key)} onChange={(on) => toggle(row.key, on)} /> : null}
              {row.state === "edited" ? (
                <Segmented<Choice>
                  label={`What to do with slide ${row.number}`}
                  value={choices.get(row.key) ?? "keep"}
                  options={[
                    { value: "keep", label: "Keep mine", title: `Keep slide ${row.number} as it is` },
                    { value: "replace", label: "Replace", title: `Replace slide ${row.number} with what the page says now` },
                  ]}
                  onPick={(choice) => setChoices((now) => new Map(now).set(row.key, choice))}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Dialog>
  );
}
