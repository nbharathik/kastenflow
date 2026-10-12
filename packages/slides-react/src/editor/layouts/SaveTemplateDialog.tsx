import { type JSX, useId, useState } from "react";

import type { DialogProps } from "../dialogs/types.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { useEditor } from "../useEditor.ts";
import "./layouts.css";

/**
 * Saves the deck's look as a template: its colours, fonts, text styles, layouts (the ones you made too), the decoration on every
 * slide and its page shape. The words of the deck stay out unless you ask for its slides as examples. The host keeps the template
 * (Kasten, as a file in the vault's templates folder) and offers it when a deck is made and in "Apply a template".
 */
export function SaveTemplateDialog({ session, onClose }: DialogProps): JSX.Element {
  const { deck } = useEditor(session);
  const templates = session.host.templates;
  const [name, setName] = useState(`${deck.title.trim() || "My"} template`);
  const [examples, setExamples] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const ok = name.trim() !== "" && templates !== undefined && !busy;

  const save = async () => {
    if (!ok || !templates) return;
    setBusy(true);
    setError(null);
    try {
      await templates.save(name.trim(), session.core.templateText(name.trim(), examples));
      session.host.notify?.(`Saved the template “${name.trim()}”. It is in New deck and in Apply a template.`);
      onClose();
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Save as template"
      width={460}
      onClose={onClose}
      footer={
        <>
          <TextButton onClick={onClose}>Cancel</TextButton>
          <TextButton primary disabled={!ok} onClick={() => void save()}>
            Save template
          </TextButton>
        </>
      }
    >
      {templates ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="ks-ls-field" htmlFor={nameId}>
            Name
            <input id={nameId} className="ks-input" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} data-autofocus="" />
          </label>
          <p className="ks-ls-hint">
            A template keeps this deck's look: colours, fonts, text styles, the layouts (the ones you made too), what every slide shows behind it, and the shape of the slides ({deck.size.w} by {deck.size.h}).
          </p>
          <div className="ks-ls-checks">
            <label className="ks-toggle">
              <input type="checkbox" checked={examples} onChange={(event) => setExamples(event.target.checked)} />
              <span>Keep this deck's {deck.slides.length === 1 ? "slide" : `${deck.slides.length} slides`} as examples</span>
            </label>
          </div>
          {error ? (
            <p role="alert" className="ks-ls-hint">
              {error}
            </p>
          ) : null}
        </form>
      ) : (
        <p className="ks-ls-hint">This editor has nowhere to keep templates.</p>
      )}
    </Dialog>
  );
}
