import { type JSX, useState } from "react";

import { DATE_FORMATS, DEFAULT_DATE_FORMAT, formatDate } from "../../render/footer.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Toggle } from "../ui/Fields.tsx";
import { useEditor } from "../useEditor.ts";
import type { DialogProps } from "./types.ts";
import "./dialogs.css";

type DateMode = "none" | "today" | "fixed";

/**
 * Header and footer: the footer words, the date (written by hand, or today's in a chosen format) and the slide number, for every slide or for
 * this one. The number is the deck's one choice (the same switch as Slide numbers); turning it off in every deck of the vault is the host's
 * own dialog, reached from here.
 */
export function HeaderFooterDialog({ session, ui, onClose }: DialogProps): JSX.Element {
  const { deck, slideId } = useEditor(session);
  const own = deck.slides.find((s) => s.id === slideId)?.footer ?? null;
  const [scope, setScope] = useState<"all" | "slide">("all");
  const shared = scope === "all" ? deck.present.headerFooter : own;
  const [footer, setFooter] = useState(shared?.footer ?? "");
  const [mode, setMode] = useState<DateMode>(shared?.date ? (shared.date.text != null ? "fixed" : "today") : "none");
  const [format, setFormat] = useState(shared?.date?.format ?? DEFAULT_DATE_FORMAT);
  const [fixed, setFixed] = useState(shared?.date?.text ?? "");
  const [hideOnTitle, setHideOnTitle] = useState(Boolean(deck.present.headerFooter?.hideOnTitle));
  const numbers = deck.present.slideNumbers;
  const { slideNumbers } = ui.actions;
  const today = new Date();

  const apply = (): void => {
    const date = mode === "today" ? { format } : mode === "fixed" ? { text: fixed } : undefined;
    session.aids.setHeaderFooter({
      ...(scope === "slide" ? { slides: [slideId] } : { hideOnTitle }),
      footer,
      ...(date ? { date } : { noDate: true }),
    });
    onClose();
  };

  return (
    <Dialog
      title="Header & footer"
      width={480}
      onClose={onClose}
      footer={
        <>
          {scope === "slide" && own ? (
            <TextButton
              className="ks-dg-left"
              onClick={() => {
                session.aids.setHeaderFooter({ slides: [slideId], reset: true });
                onClose();
              }}
            >
              Use the deck's for this slide
            </TextButton>
          ) : null}
          <TextButton onClick={onClose}>Cancel</TextButton>
          <TextButton primary onClick={apply}>
            {scope === "all" ? "Apply to all" : "Apply to this slide"}
          </TextButton>
        </>
      }
    >
      <section className="ks-dg-section" aria-label="For">
        <label className="ks-toggle">
          <input type="radio" name="hf-scope" checked={scope === "all"} onChange={() => setScope("all")} />
          <span>All slides</span>
        </label>
        <label className="ks-toggle">
          <input type="radio" name="hf-scope" checked={scope === "slide"} onChange={() => setScope("slide")} />
          <span>This slide only</span>
        </label>
      </section>
      <section className="ks-dg-section" aria-label="Footer">
        <h3 className="ks-dg-heading">Footer</h3>
        <input className="ks-input" aria-label="Footer text" placeholder="Words along the bottom of the slide" maxLength={200} value={footer} onChange={(event) => setFooter(event.target.value)} />
        {scope === "all" ? <Toggle label="Leave off the title slide" on={hideOnTitle} onChange={setHideOnTitle} /> : null}
      </section>
      <section className="ks-dg-section" aria-label="Date">
        <h3 className="ks-dg-heading">Date</h3>
        {(["none", "today", "fixed"] as const).map((choice) => (
          <label key={choice} className="ks-toggle">
            <input type="radio" name="hf-date" checked={mode === choice} onChange={() => setMode(choice)} />
            <span>{choice === "none" ? "No date" : choice === "today" ? "Today's date, always up to date" : "A date I type"}</span>
          </label>
        ))}
        {mode === "today" ? (
          <select className="ks-input" aria-label="Date format" value={format} onChange={(event) => setFormat(event.target.value)}>
            {DATE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {formatDate(f, today)}
              </option>
            ))}
          </select>
        ) : null}
        {mode === "fixed" ? <input className="ks-input" aria-label="Date text" maxLength={80} value={fixed} onChange={(event) => setFixed(event.target.value)} /> : null}
      </section>
      <section className="ks-dg-section" aria-label="Slide number">
        <h3 className="ks-dg-heading">Slide number</h3>
        <Toggle label="Show the slide number" on={numbers} onChange={(on) => session.aids.setHeaderFooter({ slideNumbers: on })} />
        {slideNumbers ? (
          <TextButton
            onClick={() => {
              onClose();
              slideNumbers();
            }}
          >
            Turn numbers off in every deck…
          </TextButton>
        ) : null}
      </section>
    </Dialog>
  );
}
