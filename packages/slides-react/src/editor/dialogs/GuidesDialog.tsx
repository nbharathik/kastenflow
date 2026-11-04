import type { JSX } from "react";

import { UNITS_PER_INCH } from "../aids/ruler.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { NumberField, Toggle } from "../ui/Fields.tsx";
import { useEditor } from "../useEditor.ts";
import type { DialogProps } from "./types.ts";
import "./dialogs.css";

const inches = (units: number): number => Math.round((units / UNITS_PER_INCH) * 1000) / 1000;

/**
 * Rulers, grid and guides, with numbers: the keyboard's way to what dragging out of a ruler does. The distances are in inches, as the page
 * is. Each change is one step of undo.
 */
export function GuidesDialog({ session, onClose }: DialogProps): JSX.Element {
  const { deck } = useEditor(session);
  const guides = deck.present.guides;
  const lines = guides?.lines ?? [];
  const { w, h } = deck.size;
  return (
    <Dialog
      title="Rulers, grid and guides"
      width={480}
      onClose={onClose}
      footer={
        <>
          <TextButton className="ks-dg-left" disabled={lines.length === 0} onClick={() => session.aids.clearGuides()}>
            Clear all guides
          </TextButton>
          <TextButton primary onClick={onClose}>
            Done
          </TextButton>
        </>
      }
    >
      <section className="ks-dg-section" aria-label="Rulers and grid">
        <Toggle label="Show rulers" on={Boolean(guides?.rulers)} onChange={(on) => session.aids.setRulers(on)} />
        <Toggle label="Show gridlines" on={Boolean(guides?.showGrid)} onChange={(on) => session.aids.setShowGrid(on)} />
        <NumberField label="Grid spacing" unit="in" min={inches(4)} max={inches(480)} step={0.125} decimals={3} width={80} value={inches(guides?.grid ?? 48)} onCommit={(value) => session.aids.setGrid(Math.round(value * UNITS_PER_INCH))} />
        <p className="ks-dg-note">Boxes snap to the grid, and to the guides, while they are dragged; Alt held switches it off. Neither is shown when presenting or exported.</p>
      </section>
      <section className="ks-dg-section" aria-label="Guides">
        <h3 className="ks-dg-heading">Guides</h3>
        <div>
          <TextButton onClick={() => session.aids.addGuide("vertical", w / 2)}>Add vertical guide</TextButton>
          <TextButton onClick={() => session.aids.addGuide("horizontal", h / 2)}>Add horizontal guide</TextButton>
        </div>
        <ul className="ks-dg-master-layouts">
          {lines.map((guide, index) => (
            <li key={index}>
              <NumberField
                label={`${guide.axis === "vertical" ? "Vertical" : "Horizontal"} guide ${index + 1}, from the ${guide.axis === "vertical" ? "left" : "top"}`}
                unit="in"
                step={0.125}
                decimals={3}
                width={90}
                value={inches(guide.at)}
                onCommit={(value) => session.aids.moveGuide(index, value * UNITS_PER_INCH)}
              />
              <span className="ks-dg-master-used">{guide.axis === "vertical" ? "vertical" : "horizontal"}</span>
              <TextButton onClick={() => session.aids.moveGuide(index, null)}>Delete</TextButton>
            </li>
          ))}
          {lines.length === 0 ? <li className="ks-dg-note">No guides yet. Drag one out of a ruler, or add one here.</li> : null}
        </ul>
      </section>
    </Dialog>
  );
}
