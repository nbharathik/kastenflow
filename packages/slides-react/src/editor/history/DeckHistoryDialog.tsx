import type { Deck } from "@kasten-slides/wasm";
import { type JSX, useEffect, useId, useMemo, useState } from "react";

import { readDeck } from "../dialogs/import-layouts.ts";
import type { DialogProps } from "../dialogs/types.ts";
import { SlideThumb, useImageUrl } from "../filmstrip/SlideThumb.tsx";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { useEditorValue } from "../useEditor.ts";
import { DIFFERENCE_WORDS, changedCount, compareDecks } from "./compare.ts";
import type { DeckVersion } from "./history-host.ts";
import "./history.css";

/** The thumbnails' width in pixels. */
const THUMB = 168;
const CURRENT = "current";

type Loaded = { state: "loading" } | { state: "ready"; deck: Deck } | { state: "failed"; why: string };

/** When a version was saved, for a person: "Nov 2, 2026, 9:30 AM". */
export function savedText(time: number): string {
  return new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const labelOf = (version: DeckVersion): string => `${savedText(version.time)} · ${version.author} · ${version.summary}`;

/** The deck at a version (read through the engine, so an older file is brought up to date), or the deck as it is now. */
function useVersion(session: DialogProps["session"], id: string | null, versions: readonly DeckVersion[] | null): Loaded {
  const now = useEditorValue(session, (state) => state.deck);
  const [loaded, setLoaded] = useState<{ id: string; result: Loaded } | null>(null);
  useEffect(() => {
    const history = session.host.history;
    if (id === null || id === CURRENT || !history || !versions) return;
    let live = true;
    history.read(id).then(
      (text) => {
        if (!live) return;
        if (text === undefined) return setLoaded({ id, result: { state: "failed", why: "This version is no longer kept." } });
        try {
          setLoaded({ id, result: { state: "ready", deck: readDeck(text) } });
        } catch (error) {
          setLoaded({ id, result: { state: "failed", why: error instanceof Error ? error.message : "This version could not be read." } });
        }
      },
      () => live && setLoaded({ id, result: { state: "failed", why: "This version could not be read." } }),
    );
    return () => {
      live = false;
    };
  }, [session, id, versions]);
  if (id === CURRENT) return { state: "ready", deck: now };
  if (id === null || loaded?.id !== id) return { state: "loading" };
  return loaded.result;
}

/**
 * Deck → History: the versions the host saved of this deck, two of them side by side (one against the deck as it is now, by default) with
 * the slides that differ marked, and a way to bring an old version back. Restoring puts the old version in as one step of undo that is saved
 * as a new version, so nothing is lost: the version it replaced is still in the list.
 */
export function DeckHistoryDialog({ session, onClose }: DialogProps): JSX.Element {
  const history = session.host.history;
  const imageUrl = useImageUrl(session);
  const [versions, setVersions] = useState<DeckVersion[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [left, setLeft] = useState<string | null>(null);
  const [right, setRight] = useState<string>(CURRENT);
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const leftId = useId();
  const rightId = useId();

  useEffect(() => {
    if (!history) return void setVersions([]);
    let live = true;
    history.versions().then(
      (found) => {
        if (!live) return;
        setVersions(found);
        setLeft((now) => now ?? found[0]?.id ?? null);
      },
      () => {
        if (!live) return;
        setFailed(true);
        setVersions([]);
      },
    );
    return () => {
      live = false;
    };
  }, [history]);

  const before = useVersion(session, left, versions);
  const after = useVersion(session, right, versions);
  const rows = useMemo(() => (before.state === "ready" && after.state === "ready" ? compareDecks(before.deck, after.deck) : null), [before, after]);
  const shown = rows ? (onlyChanged ? rows.filter((row) => row.how !== "same") : rows) : [];
  const changed = rows ? changedCount(rows) : 0;

  const restore = (): void => {
    if (before.state !== "ready") return;
    setProblem(null);
    const done = session.run(() => session.core.apply("replace_deck", { deck: before.deck }));
    if (!done) return setProblem("That version could not be brought back.");
    void session.flush();
    const version = versions?.find((v) => v.id === left);
    session.host.notify?.(version ? `Brought back the version of ${savedText(version.time)}. It is saved as a new version.` : "Brought back that version. It is saved as a new version.");
    onClose();
  };

  const thumbs = (deck: Deck | undefined, slide: Deck["slides"][number] | null): JSX.Element =>
    deck && slide ? (
      <SlideThumb deck={deck} slide={slide} number={Math.max(1, deck.slides.findIndex((s) => s.id === slide.id) + 1)} count={deck.slides.length} width={THUMB} imageUrl={imageUrl} />
    ) : (
      <span className="ks-hs-missing">Not in this version</span>
    );

  return (
    <Dialog
      title="Deck history"
      width={760}
      onClose={onClose}
      footer={
        <>
          <TextButton onClick={onClose}>Close</TextButton>
          <TextButton primary disabled={before.state !== "ready" || left === null} onClick={restore} title="Puts the version on the left in as the deck, as one step you can undo; it is saved as a new version">
            Restore as new version
          </TextButton>
        </>
      }
    >
      {versions === null ? <p className="ks-hs-note">Looking for the saved versions…</p> : null}
      {failed ? (
        <p className="ks-hs-note" role="alert">
          The saved versions could not be read.
        </p>
      ) : null}
      {versions !== null && versions.length === 0 && !failed ? <p className="ks-hs-note">This deck has no saved versions yet. They appear as it is saved.</p> : null}
      {versions !== null && versions.length > 0 ? (
        <>
          <div className="ks-hs-pick">
            <div className="ks-hs-field">
              <label htmlFor={leftId}>Version</label>
              <select id={leftId} className="ks-select" value={left ?? ""} data-autofocus="" onChange={(event) => setLeft(event.target.value)}>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {labelOf(version)}
                  </option>
                ))}
              </select>
            </div>
            <div className="ks-hs-field">
              <label htmlFor={rightId}>Compare with</label>
              <select id={rightId} className="ks-select" value={right} onChange={(event) => setRight(event.target.value)}>
                <option value={CURRENT}>The deck as it is now</option>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {labelOf(version)}
                  </option>
                ))}
              </select>
            </div>
            <label className="ks-hs-check">
              <input type="checkbox" checked={onlyChanged} onChange={(event) => setOnlyChanged(event.target.checked)} /> Only slides that differ
            </label>
          </div>
          {before.state === "failed" || after.state === "failed" ? (
            <p className="ks-hs-note" role="alert">
              {before.state === "failed" ? before.why : after.state === "failed" ? after.why : ""}
            </p>
          ) : null}
          {rows === null && before.state !== "failed" && after.state !== "failed" ? <p className="ks-hs-note">Reading the versions…</p> : null}
          {rows ? (
            <>
              <p className="ks-hs-summary" role="status">
                {changed === 0 ? "The two are the same." : `${changed} of ${rows.length} slide${rows.length === 1 ? "" : "s"} differ.`}
              </p>
              <div className="ks-hs-heads" aria-hidden="true">
                <span>Version</span>
                <span>Compared with</span>
              </div>
              <ul className="ks-hs-rows">
                {shown.map((row) => (
                  <li key={row.id} className={`ks-hs-row is-${row.how}`} data-slide={row.id}>
                    <div className="ks-hs-cell">{thumbs(before.state === "ready" ? before.deck : undefined, row.before)}</div>
                    <div className="ks-hs-cell">{thumbs(after.state === "ready" ? after.deck : undefined, row.after)}</div>
                    <span className="ks-hs-mark">{DIFFERENCE_WORDS[row.how]}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {problem ? (
            <p className="ks-hs-note" role="alert">
              {problem}
            </p>
          ) : null}
        </>
      ) : null}
    </Dialog>
  );
}
