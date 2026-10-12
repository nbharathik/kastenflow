import type { Deck } from "@kasten-slides/wasm";
import { type JSX, useEffect, useRef, useState } from "react";

import type { ImageUrl } from "../../../render/index.ts";
import { SlideThumb } from "../../filmstrip/SlideThumb.tsx";
import { TextButton } from "../../ui/Button.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { useEditor } from "../../useEditor.ts";
import { useElementSize } from "../../useElementSize.ts";
import { PanelCommands } from "../../layouts/PanelCommands.tsx";
import { PanelSection } from "../format/PanelSection.tsx";
import { applyLayout } from "../format/layout.ts";
import { stopAt, walkOptions } from "../format/roving.ts";
import { knownThemeChoices, themeChoices, themeNames } from "../format/themes.ts";
import type { PanelProps } from "../format/types.ts";
import { Wireframe } from "../format/Wireframe.tsx";
import "./themes.css";

/** A theme's sample slides carry no pictures. */
const NO_PICTURES: ImageUrl = () => undefined;

/** The width a theme card draws its sample slide at before it knows how wide the card is. */
const THUMB = 124;

/** A theme's sample title slide, drawn as wide as its card is (the panel can be dragged wider or narrower). */
function ThemeThumb({ sample }: { sample: Deck }): JSX.Element | null {
  const box = useRef<HTMLSpanElement>(null);
  const { w } = useElementSize(box);
  const first = sample.slides[0];
  return (
    <span ref={box} className="ks-th-thumb" aria-hidden="true">
      {first ? <SlideThumb deck={sample} slide={first} number={1} count={sample.slides.length} width={w || THUMB} imageUrl={NO_PICTURES} /> : null}
    </span>
  );
}

/**
 * Themes and layouts, as Google Slides' side panel has them: every built-in theme as a small drawing of its title slide (picking one
 * restyles the deck and keeps every slide's words), and the layouts of the deck's theme as drawings of where their slots sit.
 */
export function ThemesPanel({ session, ui }: PanelProps): JSX.Element {
  const state = useEditor(session);
  const { deck } = state;
  const { theme } = deck;
  const current = deck.slides.find((slide) => slide.id === state.slideId)?.layout;
  // Drawing every theme's title slide takes a deck for each: the first time, the cards show their names at once and their drawings
  // come a moment later, so opening the panel never waits for them.
  const [choices, setChoices] = useState(() => knownThemeChoices() ?? themeNames());
  useEffect(() => {
    if (knownThemeChoices()) return setChoices(knownThemeChoices()!);
    const timer = window.setTimeout(() => setChoices(themeChoices()), 40);
    return () => window.clearTimeout(timer);
  }, []);
  const chosenTheme = choices.findIndex((choice) => choice.name === theme.name);
  const chosenLayout = theme.layouts.findIndex((layout) => layout.name === current);

  return (
    <>
      <PanelSection id="themes" title="Themes">
        <div className="ks-th-grid" role="listbox" aria-label="Themes" onKeyDown={(event) => walkOptions(event, 2)}>
          {choices.map((choice, i) => {
            const on = choice.name === theme.name;
            return (
              <button
                key={choice.name}
                type="button"
                role="option"
                aria-selected={on}
                tabIndex={stopAt(i, chosenTheme)}
                className={`ks-btn ks-th-card${on ? " is-on" : ""}`}
                onClick={() => !on && session.slides.applyTheme(choice.name)}
              >
                {choice.sample ? <ThemeThumb sample={choice.sample} /> : <span className="ks-th-thumb is-pending" aria-hidden="true" />}
                <span className="ks-th-line">
                  <span className="ks-th-name">{choice.name}</span>
                  {on ? <Icon name="check" size={14} /> : null}
                </span>
              </button>
            );
          })}
        </div>
        <div className="ks-sp-actions">
          <TextButton onClick={() => ui.openDialog("theme")}>Colours, fonts and logo…</TextButton>
        </div>
        {/* The deck's look as a template of your own, and a template put on this deck. */}
        <PanelCommands session={session} ui={ui} ids={["deck.save-template", "deck.apply-template"]} />
      </PanelSection>

      <PanelSection id="layouts" title="Layouts">
        <div className="ks-th-grid" role="listbox" aria-label="Layouts" onKeyDown={(event) => walkOptions(event, 2)}>
          {theme.layouts.map((layout, i) => {
            const on = layout.name === current;
            return (
              <button
                key={layout.name}
                type="button"
                role="option"
                aria-selected={on}
                tabIndex={stopAt(i, chosenLayout)}
                className={`ks-btn ks-th-card${on ? " is-on" : ""}`}
                onClick={() => applyLayout(session, layout.name)}
              >
                <span className="ks-th-wire" aria-hidden="true">
                  <Wireframe layout={layout} size={deck.size} />
                </span>
                <span className="ks-th-line">
                  <span className="ks-th-name">{layout.label}</span>
                  {on ? <Icon name="check" size={14} /> : null}
                </span>
              </button>
            );
          })}
        </div>
        <p className="ks-sp-hint">A layout is applied to the slide shown, or to the slides picked in the filmstrip.</p>
        <PanelCommands session={session} ui={ui} ids={["slide.save-as-layout", "layout.manage"]} />
      </PanelSection>
    </>
  );
}
