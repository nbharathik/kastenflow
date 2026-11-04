import type { FxKind, MotionDirection, StepFx } from "@kasten-slides/wasm";
import { type JSX, useState } from "react";

import type { EditorSession } from "../../session/session.ts";
import { NumberField, Segmented } from "../../ui/Fields.tsx";
import { useEditor } from "../../useEditor.ts";
import { EFFECTS, GROUPS, LONGEST, SIDES, STARTS, USUAL_SECONDS, WASHES, changed, hasSide, withKind } from "./effects.ts";

const DEFAULT = "";

/**
 * How the element picked comes in, goes out or draws the eye at a step. The grid above says what changes at each step; this says how.
 * A step with no effect of its own uses the deck's usual one. Everything here is one step of undo.
 */
export function EffectPicker({ session }: { session: EditorSession }): JSX.Element | null {
  const state = useEditor(session);
  const slide = state.deck.slides.find((s) => s.id === state.slideId);
  const [chosenStep, setStep] = useState(1);
  const steps = slide?.steps ?? 0;
  const only = state.selection.length === 1 ? slide?.elements.find((e) => e.id === state.selection[0]) : undefined;
  if (!slide || steps === 0) return <p className="ks-steps-hint">Add a step to give an element an effect.</p>;
  if (!only) return <p className="ks-steps-hint">Pick one element to choose how it comes in or goes out at a step.</p>;

  const step = Math.min(Math.max(chosenStep, 1), steps);
  const fx: StepFx | undefined = only.stepFx?.[step] ?? undefined;
  const apply = (next: StepFx | null) => session.steps.setFx(only.id, step, next);
  const edit = (patch: Parameters<typeof changed>[1]) => {
    if (fx) apply(changed(fx, patch));
  };
  const entry = (only.stepStates?.[step] ?? null) !== null;

  return (
    <section className="ks-fx" aria-label="Effect">
      <h3 className="ks-fx-title">Effect</h3>
      <label className="ks-fx-row">
        <span>At step</span>
        <select className="ks-select" aria-label="Step" value={step} onChange={(event) => setStep(Number(event.target.value))}>
          {Array.from({ length: steps }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="ks-fx-row">
        <span>Effect</span>
        <select className="ks-select" aria-label="Effect" value={fx?.kind ?? DEFAULT} onChange={(event) => apply(event.target.value === DEFAULT ? null : withKind(fx, event.target.value as FxKind))}>
          <option value={DEFAULT}>Deck default</option>
          {GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {EFFECTS.filter((e) => e.group === group).map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {fx ? (
        <>
          {hasSide(fx.kind) ? (
            <Segmented<MotionDirection> label="Comes from" value={fx.direction ?? "down"} options={SIDES.map((s) => ({ value: s.value, label: s.label, title: `From ${s.label.toLowerCase()}` }))} onPick={(direction) => edit({ direction })} />
          ) : null}
          {fx.kind === "colour" ? (
            <label className="ks-fx-row">
              <span>Colour</span>
              <select className="ks-select" aria-label="Colour" value={fx.color ?? "accent1"} onChange={(event) => edit({ color: event.target.value })}>
                {WASHES.map((token) => (
                  <option key={token} value={token}>
                    {token.replace("accent", "Accent ")}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {fx.kind === "path" ? (
            <div className="ks-fx-pair">
              <NumberField label="Starts across" unit="units" step={10} decimals={0} width={72} value={fx.dx ?? 0} onCommit={(dx) => edit({ dx })} />
              <NumberField label="Starts down" unit="units" step={10} decimals={0} width={72} value={fx.dy ?? 0} onCommit={(dy) => edit({ dy })} />
            </div>
          ) : null}
          {fx.kind !== "appear" ? <NumberField label="Duration" unit="seconds" min={0} max={LONGEST} step={0.1} decimals={2} width={72} value={fx.duration ?? USUAL_SECONDS} onCommit={(duration) => edit({ duration })} /> : null}
          <NumberField label="Delay" unit="seconds" min={0} max={LONGEST} step={0.1} decimals={2} width={72} value={fx.delay ?? 0} onCommit={(delay) => edit({ delay: delay === 0 ? null : delay })} />
          <Segmented label="Starts" value={fx.start ?? "with"} options={STARTS.map((s) => ({ value: s.value, label: s.label, title: s.label }))} onPick={(start) => edit({ start: start === "with" ? null : start })} />
          <p className="ks-steps-hint">{entry ? "" : "This step does not change the element, so the effect draws the eye to it."}</p>
        </>
      ) : null}
    </section>
  );
}
