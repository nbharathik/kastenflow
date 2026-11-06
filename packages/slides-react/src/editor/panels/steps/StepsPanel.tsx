import { type JSX, useEffect } from "react";

import type { EditorSession } from "../../session/session.ts";
import { buildScope } from "../../session/steps.ts";
import type { EditorUi } from "../../ui-state.ts";
import { TextButton } from "../../ui/Button.tsx";
import { useEditor } from "../../useEditor.ts";
import { EffectPicker } from "./EffectPicker.tsx";
import { StepGrid } from "./StepGrid.tsx";
import "./steps.css";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Steps: what appears, dims and lights up at each click. One-click builds above, and the grid under them. */
export function StepsPanel({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element {
  const state = useEditor(session);
  const steps = state.deck.slides.find((s) => s.id === state.slideId)?.steps ?? 0;
  const some = buildScope(state).length;
  const any = buildScope(state, "clear").length;

  // Leaving the tab puts the slide back as it is styled.
  useEffect(() => () => ui.setPreviewStep(null), [ui]);

  const chosen = state.selection.length;
  const scope = chosen > 0 ? `Applies to the ${plural(chosen, "selected element")}.` : some > 0 ? `Applies to all ${plural(some, "element")} but the title.` : "Nothing on this slide to build yet.";

  return (
    <div className="ks-steps">
      <section className="ks-steps-builds" aria-label="Build steps">
        <div className="ks-steps-buttons">
          <TextButton disabled={some === 0} onClick={() => session.steps.build("reveal")} title="The elements appear one by one, top to bottom and left to right. A single list appears item by item.">
            Reveal one by one
          </TextButton>
          <TextButton disabled={some === 0} onClick={() => session.steps.build("walkthrough")} title="Each element is highlighted in turn while the others are dimmed.">
            Walk through
          </TextButton>
          <TextButton disabled={some < 2} onClick={() => session.steps.build("spotlight")} title="Every element but the one in turn is dimmed.">
            Spotlight
          </TextButton>
          <TextButton disabled={any === 0} onClick={() => session.steps.build("clear")} title="Takes every step from the elements.">
            Clear steps
          </TextButton>
        </div>
        <p className="ks-steps-scope">
          {scope} <span className="ks-steps-count">{steps === 0 ? "No steps yet." : plural(steps, "step") + "."}</span>
        </p>
      </section>
      <StepGrid session={session} ui={ui} />
      <EffectPicker session={session} />
    </div>
  );
}
