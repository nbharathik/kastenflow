import type { Background, SetBackground } from "@kasten-slides/wasm";
import type { JSX } from "react";

import { backgroundStyle, chooseImage, colorBackground } from "../panels/format/background.ts";
import { ColorButton, Row } from "../panels/format/controls.tsx";
import type { EditorSession } from "../session/session.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { useEditor } from "../useEditor.ts";
import type { DialogProps } from "./types.ts";
import "./dialogs.css";

/** The same background as the slide shown has, on every slide, as one step. */
export function applyBackgroundToAll(session: EditorSession): void {
  const { deck, slideId } = session.state;
  const background: Background | null = deck.slides.find((s) => s.id === slideId)?.background ?? null;
  const operations = deck.slides.map((s) => ["set_background", { slide: s.id, background }] satisfies ["set_background", SetBackground]);
  session.run(() => session.core.applyBatch(operations));
}

/** The background of the slide shown: a picture of it, and the colour, the image and the way back to the theme's, changed as chosen. */
export function BackgroundControls({ session }: { session: EditorSession }): JSX.Element {
  const { deck, slideId } = useEditor(session);
  const slide = deck.slides.find((s) => s.id === slideId);
  const background: Background | null = slide?.background ?? null;
  const { theme } = deck;

  const addImage = async () => {
    const target = slideId;
    const path = await chooseImage(session);
    if (path) session.slides.setBackground({ image: path }, target);
  };

  return (
    <>
      <div className="ks-dg-bg-preview" style={{ ...backgroundStyle(session, theme, background), aspectRatio: `${deck.size.w} / ${deck.size.h}` }} aria-hidden="true" />
      <div className="ks-dg-form">
        <Row label="Colour">
          <ColorButton
            theme={theme}
            label="Background colour"
            value={background?.color ?? null}
            emptyName={background?.image ? "Picture" : "Theme default"}
            noneLabel="Theme default"
            onPick={(picked) => session.slides.setBackground(colorBackground(picked))}
          />
        </Row>
        <Row label="Image">
          <TextButton data-autofocus="" onClick={() => void addImage()}>
            Choose image…
          </TextButton>
          {background?.image ? <span className="ks-dg-file">{background.image}</span> : null}
        </Row>
        <Row label="Reset">
          <TextButton disabled={!background} onClick={() => session.slides.setBackground(null)}>
            Use the theme's background
          </TextButton>
        </Row>
      </div>
    </>
  );
}

/** A slide's background: a colour or a picture, changed as it is chosen, and copied to the whole deck on request. */
export function BackgroundDialog({ session, onClose }: DialogProps): JSX.Element {
  return (
    <Dialog
      title="Background"
      width={420}
      onClose={onClose}
      footer={
        <>
          <TextButton className="ks-dg-left" onClick={() => applyBackgroundToAll(session)}>
            Apply to all slides
          </TextButton>
          <TextButton primary onClick={onClose}>
            Done
          </TextButton>
        </>
      }
    >
      <BackgroundControls session={session} />
    </Dialog>
  );
}
