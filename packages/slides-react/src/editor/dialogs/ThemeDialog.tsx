import type { JSX } from "react";

import type { ImageUrl } from "../../render/index.ts";
import { SlideThumb } from "../filmstrip/SlideThumb.tsx";
import { stopAt, walkOptions } from "../panels/format/roving.ts";
import { themeChoices } from "../panels/format/themes.ts";
import { ThemeStrip } from "../panels/format/ThemeStrip.tsx";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Icon } from "../ui/Icon.tsx";
import { useEditor } from "../useEditor.ts";
import { ThemeColors } from "./ThemeColors.tsx";
import { ThemeFonts } from "./ThemeFonts.tsx";
import { ThemeLogo } from "./ThemeLogo.tsx";
import type { DialogProps } from "./types.ts";
import "./dialogs.css";

/** A theme's sample slides carry no pictures. */
const NO_PICTURES: ImageUrl = () => undefined;

/** The width a theme card draws its sample slide at. */
const CARD_WIDTH = 128;

/** The deck's theme: one of the built-in ones, and its colours, typefaces and logo. Each change is made as it is chosen and can be undone. */
export function ThemeDialog({ session, onClose }: DialogProps): JSX.Element {
  const { theme } = useEditor(session).deck;
  return (
    <Dialog title="Theme" width={660} onClose={onClose} footer={<TextButton primary onClick={onClose}>Done</TextButton>}>
      <section className="ks-dg-section" aria-label="Built-in themes">
        <h3 className="ks-dg-heading">Themes</h3>
        <div className="ks-dg-themes" role="listbox" aria-label="Built-in themes" onKeyDown={(event) => walkOptions(event, 4)}>
          {themeChoices().map((choice, i, all) => {
            const on = choice.name === theme.name;
            return (
              <button
                key={choice.name}
                type="button"
                role="option"
                aria-selected={on}
                tabIndex={stopAt(i, all.findIndex((c) => c.name === theme.name))}
                className={`ks-btn ks-dg-theme${on ? " is-on" : ""}`}
                {...(on ? { "data-autofocus": "" } : {})}
                onClick={() => !on && session.slides.applyTheme(choice.name)}
              >
                {choice.sample?.slides[0] ? (
                  <span className="ks-dg-theme-thumb" aria-hidden="true">
                    <SlideThumb deck={choice.sample} slide={choice.sample.slides[0]} number={1} count={choice.sample.slides.length} width={CARD_WIDTH} imageUrl={NO_PICTURES} />
                  </span>
                ) : null}
                <ThemeStrip colors={choice.colors} />
                <span className="ks-dg-theme-line">
                  <span>{choice.name}</span>
                  {on ? <Icon name="check" size={14} /> : null}
                </span>
              </button>
            );
          })}
        </div>
        <p className="ks-sp-hint">Switching keeps every slide's words and layout.</p>
      </section>
      <section className="ks-dg-section" aria-label="Colours">
        <h3 className="ks-dg-heading">Colours</h3>
        <ThemeColors session={session} theme={theme} />
      </section>
      <section className="ks-dg-section" aria-label="Fonts">
        <h3 className="ks-dg-heading">Fonts</h3>
        <ThemeFonts session={session} theme={theme} />
      </section>
      <section className="ks-dg-section" aria-label="Logo">
        <h3 className="ks-dg-heading">Logo</h3>
        <ThemeLogo session={session} theme={theme} />
      </section>
    </Dialog>
  );
}
