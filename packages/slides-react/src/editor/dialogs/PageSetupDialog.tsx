import { type JSX, useMemo, useState } from "react";

import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { NumberField } from "../ui/Fields.tsx";
import { useEditorValue } from "../useEditor.ts";
import { LEAST_INCHES, MOST_INCHES, inchesOf, presetOf, presetSizes, sizeText, unitsOf } from "./page-sizes.ts";
import type { DialogProps } from "./types.ts";
import "./dialogs.css";

/** The word for a choice that is none of the presets. */
const CUSTOM = "custom";

/** How big a drawn ratio is at most, in pixels, in the dialog. */
const SHAPE = 56;

/** A rectangle in the proportion of the size, so that a ratio is seen and not only read. */
function Shape({ w, h }: { w: number; h: number }): JSX.Element {
  const scale = SHAPE / Math.max(w, h, 1);
  return <span className="ks-dg-ratio" style={{ width: Math.max(w * scale, 8), height: Math.max(h * scale, 8) }} aria-hidden="true" />;
}

/**
 * Page setup: the size of the slides. A preset (16:9, 16:10, 4:3, 1:1) or a width and height of one's own, in inches. Every
 * slide, the theme's layouts and its master are refitted to it as one step of undo.
 */
export function PageSetupDialog({ session, onClose }: DialogProps): JSX.Element {
  const size = useEditorValue(session, (state) => state.deck.size);
  const presets = useMemo(() => presetSizes(), []);
  const now = presetOf(size, presets);
  const [choice, setChoice] = useState(now?.name ?? CUSTOM);
  const [custom, setCustom] = useState({ w: size.w, h: size.h });

  const picked = choice === CUSTOM ? custom : (presets.find((preset) => preset.name === choice) ?? custom);
  const unchanged = Math.abs(picked.w - size.w) < 0.01 && Math.abs(picked.h - size.h) < 0.01;
  const apply = () => {
    if (!unchanged) session.slides.setPageSize(choice === CUSTOM ? { w: custom.w, h: custom.h } : { preset: choice });
    onClose();
  };

  const options = [...presets.map((preset) => ({ value: preset.name, label: preset.name, text: sizeText(preset), shape: preset })), { value: CUSTOM, label: "Custom", text: sizeText(custom), shape: custom }];

  return (
    <Dialog
      title="Page setup"
      width={440}
      onClose={onClose}
      footer={
        <>
          <TextButton onClick={onClose}>Cancel</TextButton>
          <TextButton primary onClick={apply}>
            Apply
          </TextButton>
        </>
      }
    >
      <div className="ks-dg-form">
        <div className="ks-dg-ratios" role="radiogroup" aria-label="Slide size">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={choice === option.value}
              className={`ks-btn ks-dg-ratio-card${choice === option.value ? " is-on" : ""}`}
              {...(choice === option.value ? { "data-autofocus": "" } : {})}
              onClick={() => setChoice(option.value)}
            >
              <Shape w={option.shape.w} h={option.shape.h} />
              <span className="ks-dg-ratio-name">{option.label}</span>
              <span className="ks-dg-ratio-size">{option.text}</span>
            </button>
          ))}
        </div>
        {choice === CUSTOM ? (
          <div className="ks-dg-sizes">
            <NumberField label="Width" unit="in" min={LEAST_INCHES} max={MOST_INCHES} step={0.25} decimals={2} width={80} value={inchesOf(custom.w)} onCommit={(inches) => setCustom({ ...custom, w: unitsOf(inches) })} />
            <NumberField label="Height" unit="in" min={LEAST_INCHES} max={MOST_INCHES} step={0.25} decimals={2} width={80} value={inchesOf(custom.h)} onCommit={(inches) => setCustom({ ...custom, h: unitsOf(inches) })} />
          </div>
        ) : null}
        <p className="ks-sp-hint">
          Every slide and the theme are refitted: boxes stretch with the slide, type follows its width, and pictures, turned things and circles keep their shape. Going to another size and back can leave pictures a little smaller. You can undo it.
        </p>
      </div>
    </Dialog>
  );
}
