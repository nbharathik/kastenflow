import type { JSX } from "react";

import { editLayout, slidesOn } from "../layouts/ops.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { NumberField, Toggle } from "../ui/Fields.tsx";
import { useEditor } from "../useEditor.ts";
import { editTheme } from "./theme-edit.ts";
import { BackgroundControls, applyBackgroundToAll } from "./BackgroundDialog.tsx";
import { ThemeLogo } from "./ThemeLogo.tsx";
import type { DialogProps } from "./types.ts";
import "./dialogs.css";
import "./master.css";

/** The text styles the master edits, in the order a person thinks of them. */
const STYLES = ["title", "subtitle", "body", "caption"] as const;

const plural =(n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * The master of the deck, in one place: what every slide shares. The background (copied to every slide on request), the logo of the theme,
 * which layouts show the theme's graphics (a header bar, the logo) and which hide them, and where the numbers and footers are set. Each
 * part is the one that was already in the editor (the background dialog, the theme dialog's logo, the layout designer's checkbox); every
 * change is made as it is chosen, can be undone, and shows on the slides at once.
 */
export function MasterDialog({ session, ui, onClose }: DialogProps): JSX.Element {
  const { deck } = useEditor(session);
  const { theme } = deck;
  const graphics = theme.master?.length ?? 0;
  const { slideNumbers } = ui.actions;

  return (
    <Dialog
      title="Master"
      width={520}
      onClose={onClose}
      footer={
        <>
          <TextButton className="ks-dg-left" onClick={() => applyBackgroundToAll(session)} title="Gives every slide the background of the slide shown">
            Use this background on all slides
          </TextButton>
          <TextButton primary onClick={onClose}>
            Done
          </TextButton>
        </>
      }
    >
      <section className="ks-dg-section" aria-label="Background">
        <h3 className="ks-dg-heading">Background</h3>
        <p className="ks-dg-note">Of the slide shown. A slide with none takes the theme's.</p>
        <BackgroundControls session={session} />
      </section>
      <section className="ks-dg-section" aria-label="Logo">
        <h3 className="ks-dg-heading">Logo</h3>
        <ThemeLogo session={session} theme={theme} />
      </section>
      <section className="ks-dg-section" aria-label="Theme graphics">
        <h3 className="ks-dg-heading">Theme graphics on each layout</h3>
        <p className="ks-dg-note">
          {graphics === 0 ? "This theme draws nothing of its own behind the slides." : `The theme draws ${plural(graphics, "graphic", "graphics")} behind every slide (a header bar, the logo).`} A slide follows its layout: hide them on the layouts that
          should be bare.
        </p>
        <ul className="ks-dg-master-layouts">
          {theme.layouts.map((layout) => {
            const used = slidesOn(session, layout.name);
            return (
              <li key={layout.name}>
                <label className="ks-toggle">
                  <input type="checkbox" checked={layout.hideMaster === true} onChange={(event) => editLayout(session, layout.name, { hideMaster: event.target.checked })} />
                  <span>{`Hide on ${layout.label}`}</span>
                </label>
                <span className="ks-dg-master-used">{used === 0 ? "no slides" : plural(used, "slide", "slides")}</span>
                <TextButton
                  onClick={() => {
                    onClose();
                    ui.openLayoutDesign(layout.name);
                  }}
                >
                  {`Edit ${layout.label}…`}
                </TextButton>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="ks-dg-section" aria-label="Text styles">
        <h3 className="ks-dg-heading">Text styles</h3>
        <p className="ks-dg-note">The look every layout starts its words from. A change shows on all the slides at once.</p>
        <ul className="ks-dg-master-layouts">
          {STYLES.filter((name) => theme.textStyles[name]).map((name) => (
            <li key={name}>
              <span>{name[0]?.toUpperCase() + name.slice(1)}</span>
              <NumberField
                label={`${name} size`}
                unit="pt"
                min={6}
                max={200}
                decimals={0}
                width={64}
                value={theme.textStyles[name]?.size ?? 18}
                onCommit={(size) => editTheme(session, { textStyles: { [name]: { size } } })}
              />
              <Toggle label="Bold" on={Boolean(theme.textStyles[name]?.bold)} onChange={(bold) => editTheme(session, { textStyles: { [name]: { bold: bold ? true : null } } })} />
            </li>
          ))}
        </ul>
      </section>
      <section className="ks-dg-section" aria-label="Footer and slide numbers">
        <h3 className="ks-dg-heading">Footer, date and slide numbers</h3>
        <p className="ks-dg-note">The footer words, the date and the slide number are set in one place, for all slides or for one.</p>
        <TextButton
          onClick={() => {
            onClose();
            ui.openDialog("header-footer");
          }}
        >
          Header & footer…
        </TextButton>
        {slideNumbers ? (
          <TextButton
            onClick={() => {
              onClose();
              slideNumbers();
            }}
          >
            Slide numbers in every deck…
          </TextButton>
        ) : null}
      </section>
    </Dialog>
  );
}
