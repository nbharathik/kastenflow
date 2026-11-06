import type { CustomShow } from "@kasten-slides/wasm";
import { type JSX, useId, useState } from "react";

import { MOST_SHOWS, LONGEST_NAME, nextShowId, nextShowName, problemWith, setShows, showsOf } from "../titlebar/present-settings.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Toggle } from "../ui/Fields.tsx";
import { slideTitle } from "./slide-title.ts";
import type { DialogProps } from "./types.ts";
import "./dialogs.css";
import "./custom-shows.css";

/**
 * Custom shows: named subsets of the deck's slides, picked from the Slideshow options to present just those slides, in the deck's order.
 * The shows are edited as a draft and kept with Save as one step of undo.
 */
export function CustomShowsDialog({ session, onClose }: DialogProps): JSX.Element {
  const deck = session.deck;
  const [drafts, setDrafts] = useState<CustomShow[]>(() => showsOf(deck).map((show) => ({ ...show, slides: [...show.slides] })));
  const [picked, setPicked] = useState<string | null>(drafts[0]?.id ?? null);
  const nameId = useId();
  const show = drafts.find((candidate) => candidate.id === picked) ?? null;
  const problem = (candidate: CustomShow): string | null => problemWith(candidate, drafts);
  const blocked = drafts.map(problem).find((why) => why !== null) ?? null;

  const change = (id: string, patch: Partial<CustomShow>) => setDrafts((now) => now.map((candidate) => (candidate.id === id ? { ...candidate, ...patch } : candidate)));
  const add = () => {
    const made: CustomShow = { id: nextShowId(drafts), name: nextShowName(drafts), slides: deck.slides.filter((s) => !s.hidden && !s.backup).map((s) => s.id) };
    setDrafts([...drafts, made]);
    setPicked(made.id);
  };
  const remove = (id: string) => {
    const left = drafts.filter((candidate) => candidate.id !== id);
    setDrafts(left);
    setPicked(left[0]?.id ?? null);
  };
  // Slides stay in the deck's order: a show is the subset of the deck's slides it names.
  const toggle = (id: string, slideId: string, on: boolean) => {
    const current = drafts.find((candidate) => candidate.id === id);
    if (!current) return;
    const wanted = new Set(on ? [...current.slides, slideId] : current.slides.filter((s) => s !== slideId));
    change(id, { slides: deck.slides.filter((s) => wanted.has(s.id)).map((s) => s.id) });
  };
  const save = () => {
    setShows(
      session,
      drafts.map((draft) => ({ ...draft, name: draft.name.trim() })),
    );
    onClose();
  };

  return (
    <Dialog
      title="Custom shows"
      width={560}
      onClose={onClose}
      footer={
        <>
          {blocked ? <span className="ks-dg-left ks-sp-hint" role="status">{blocked}</span> : null}
          <TextButton onClick={onClose}>Cancel</TextButton>
          <TextButton primary onClick={save} disabled={blocked !== null} data-autofocus="">
            Save
          </TextButton>
        </>
      }
    >
      <div className="ks-cs">
        <div className="ks-cs-list" role="listbox" aria-label="Custom shows">
          {drafts.map((candidate) => (
            <button key={candidate.id} type="button" role="option" aria-selected={candidate.id === picked} className={`ks-btn ks-cs-item${candidate.id === picked ? " is-on" : ""}`} onClick={() => setPicked(candidate.id)}>
              {candidate.name.trim() || "Untitled show"}
              <span className="ks-cs-count">{candidate.slides.length}</span>
            </button>
          ))}
          <TextButton onClick={add} disabled={drafts.length >= MOST_SHOWS}>
            New show
          </TextButton>
        </div>
        {show ? (
          <div className="ks-cs-body">
            <div className="ks-dg-field">
              <label className="ks-dg-label" htmlFor={nameId}>
                Name
              </label>
              <input id={nameId} className="ks-input" value={show.name} maxLength={LONGEST_NAME} onChange={(event) => change(show.id, { name: event.target.value })} />
            </div>
            <div className="ks-dg-field">
              <span className="ks-dg-label">Slides in this show</span>
              <div className="ks-cs-slides" role="group" aria-label="Slides in this show">
                {deck.slides.map((slide, i) => (
                  <Toggle key={slide.id} label={`${i + 1}. ${slideTitle(slide)}`} on={show.slides.includes(slide.id)} onChange={(on) => toggle(show.id, slide.id, on)} />
                ))}
              </div>
            </div>
            <div className="ks-dg-row">
              <TextButton onClick={() => remove(show.id)}>Delete this show</TextButton>
            </div>
          </div>
        ) : (
          <p className="ks-dg-note">A custom show plays only the slides you pick. Make one with New show, then choose it in the Slideshow options.</p>
        )}
      </div>
    </Dialog>
  );
}
