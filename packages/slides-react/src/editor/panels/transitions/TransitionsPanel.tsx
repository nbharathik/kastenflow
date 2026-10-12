import type { TransitionKind } from "@kasten-slides/wasm";
import { type JSX, useEffect } from "react";

import { TextButton } from "../../ui/Button.tsx";
import { NumberField } from "../../ui/Fields.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { useEditorValue } from "../../useEditor.ts";
import { useUiState } from "../../useUi.ts";
import { PanelSection } from "../format/PanelSection.tsx";
import { stopAt, walkOptions } from "../format/roving.ts";
import type { PanelProps } from "../format/types.ts";
import { KINDS, LONGEST, USUAL, arrivesWith, chosen, said } from "./transitions.ts";
import "./transitions.css";

/**
 * How the slide shown arrives while presenting, and how its elements come in. A kind picked is the slide's transition at once (one step
 * of undo) and plays on the slide behind the panel; Play shows it again; the deck's own default and every slide are one button away.
 */
export function TransitionsPanel({ session, ui }: PanelProps): JSX.Element {
  const deck = useEditorValue(session, (state) => state.deck);
  const slideId = useEditorValue(session, (state) => state.slideId);
  const preview = useUiState(ui).transitionPreview;
  const slide = deck.slides.find((s) => s.id === slideId);
  const fallback = deck.present.transition ?? null;
  const now = arrivesWith(slide, fallback);
  const kind: TransitionKind = now?.kind ?? "none";
  const seconds = now?.duration ?? USUAL[kind];
  const inherited = slide?.transition === undefined || slide.transition === null;

  // A preview that nothing finishes (the slide is not on the screen) does not stay on.
  useEffect(() => {
    if (!preview) return;
    const timer = window.setTimeout(() => ui.endTransitionPreview(), preview.duration * 1000 + 250);
    return () => window.clearTimeout(timer);
  }, [preview?.id, preview?.duration, ui, preview]);
  useEffect(() => () => ui.endTransitionPreview(), [ui]);

  const set = (nextKind: TransitionKind, nextSeconds: number) => {
    session.slides.setTransition(chosen(nextKind, nextSeconds), [slideId]);
    ui.playTransition(nextKind, nextSeconds);
  };
  const steps = slide?.steps ?? 0;

  return (
    <>
      <PanelSection id="transition-kind" title="Slide transition">
        <div className="ks-tr-kinds" role="listbox" aria-label="Transition" onKeyDown={(event) => walkOptions(event)}>
          {KINDS.map((choice, i) => {
            const on = choice.value === kind;
            return (
              <button
                key={choice.value}
                type="button"
                role="option"
                aria-selected={on}
                tabIndex={stopAt(i, KINDS.findIndex((k) => k.value === kind))}
                className={`ks-btn ks-tr-kind${on ? " is-on" : ""}`}
                onClick={() => set(choice.value, choice.value === kind ? seconds : USUAL[choice.value])}
              >
                <span className="ks-tr-icon">
                  <Icon name={choice.icon} size={16} />
                </span>
                <span className="ks-tr-text">
                  <span className="ks-tr-name">{choice.label}</span>
                  <span className="ks-tr-says">{choice.says}</span>
                </span>
                {on ? <Icon name="check" size={14} /> : null}
              </button>
            );
          })}
        </div>
        {kind !== "none" ? (
          <div className="ks-tr-time">
            <NumberField label="Duration" unit="seconds" min={0} max={LONGEST} step={0.1} decimals={2} width={72} value={seconds} onCommit={(value) => set(kind, value)} />
          </div>
        ) : null}
        {inherited && fallback ? <p className="ks-sp-hint">This slide follows the deck: {said(fallback)}.</p> : null}
        <div className="ks-sp-actions">
          <TextButton className="ks-tr-play" disabled={kind === "none"} onClick={() => ui.playTransition(kind, seconds)}>
            <Icon name="play" size={13} />
            Play
          </TextButton>
          <TextButton onClick={() => session.slides.setTransition(chosen(kind, seconds), deck.slides.map((s) => s.id))}>Apply to all slides</TextButton>
        </div>
      </PanelSection>

      <PanelSection id="transition-deck" title="Deck default">
        <p className="ks-sp-hint">
          Slides that name no transition of their own arrive with: <strong>{fallback ? said(fallback) : "None"}</strong>.
        </p>
        <div className="ks-sp-actions">
          <TextButton onClick={() => session.slides.setDeckTransition(chosen(kind, seconds))}>Use this for the deck</TextButton>
        </div>
      </PanelSection>

      <PanelSection id="transition-steps" title="Animations on this slide">
        <p className="ks-sp-hint">{steps > 0 ? `This slide has ${steps} ${steps === 1 ? "click" : "clicks"} after it appears: elements come in one by one.` : "Elements all appear with the slide. Steps bring them in one at a time."}</p>
        <div className="ks-sp-actions">
          <TextButton onClick={() => ui.openPanel("steps")}>Open steps</TextButton>
        </div>
      </PanelSection>
    </>
  );
}
