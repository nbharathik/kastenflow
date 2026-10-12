import type { Slide } from "@kasten-slides/wasm";
import { useEffect, useRef } from "react";

import { TextButton } from "../../ui/Button.tsx";
import { Toggle } from "../../ui/Fields.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { useEditor } from "../../useEditor.ts";
import { backgroundStyle, chooseImage, colorBackground } from "./background.ts";
import { ColorButton, Row } from "./controls.tsx";
import { applyLayout } from "./layout.ts";
import { PanelSection } from "./PanelSection.tsx";
import { stopAt, walkOptions } from "./roving.ts";
import type { PanelProps } from "./types.ts";
import { themeChoices } from "./themes.ts";
import { ThemeStrip } from "./ThemeStrip.tsx";
import { Wireframe } from "./Wireframe.tsx";
import "./slide-options.css";

const KINDS = { none: "None", fade: "Fade", slide: "Slide", morph: "Morph" } as const;

/** What arrives with the slide, in a few words. */
function transitionName(slide: Slide): string {
  const transition = slide.transition;
  if (!transition || transition.kind === "none") return KINDS.none;
  // A kind a newer build wrote is shown as it is written.
  const name = KINDS[transition.kind] ?? transition.kind;
  return transition.duration ? `${name}, ${transition.duration} s` : name;
}

/** Options for the slide itself, shown when nothing on it is selected: background, layout, transition, theme. */
export function SlideOptions({ session, ui }: PanelProps) {
  const state = useEditor(session);
  const { deck } = state;
  const slide = deck.slides.find((s) => s.id === state.slideId);
  const list = useRef<HTMLDivElement>(null);
  const layout = slide?.layout;

  // The list shows only a few layouts at once: bring the slide's own into view, in the list and not by moving the panel.
  useEffect(() => {
    const box = list.current;
    const row = box?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!box || !row) return;
    const above = row.getBoundingClientRect().top - box.getBoundingClientRect().top;
    if (above < 0) box.scrollTop += above;
    else if (above + row.offsetHeight > box.clientHeight) box.scrollTop += above + row.offsetHeight - box.clientHeight;
  }, [layout, slide?.id]);

  if (!slide) return null;
  const { theme } = deck;
  const background = slide.background;

  const addImage = async () => {
    // The slide that was shown when the button was pressed gets the picture, even if the person moves on while choosing.
    const target = slide.id;
    const path = await chooseImage(session);
    if (path) session.slides.setBackground({ image: path }, target);
  };

  return (
    <>
      <PanelSection id="background" title="Background">
        <div className="ks-sp-bg-preview" style={{ ...backgroundStyle(session, theme, background), aspectRatio: `${deck.size.w} / ${deck.size.h}` }} aria-hidden="true" />
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
        <div className="ks-sp-actions">
          <TextButton onClick={() => void addImage()}>Add image…</TextButton>
          <TextButton disabled={!background} onClick={() => session.slides.setBackground(null)}>
            Reset
          </TextButton>
        </div>
      </PanelSection>

      <PanelSection id="layout" title="Layout">
        <div ref={list} className="ks-sp-layouts" role="listbox" aria-label="Layouts" onKeyDown={(event) => walkOptions(event)}>
          {theme.layouts.map((layout, i) => (
            <button
              key={layout.name}
              type="button"
              role="option"
              aria-selected={layout.name === slide.layout}
              tabIndex={stopAt(i, theme.layouts.findIndex((l) => l.name === slide.layout))}
              className={`ks-btn ks-sp-layout${layout.name === slide.layout ? " is-on" : ""}`}
              onClick={() => applyLayout(session, layout.name)}
            >
              <span className="ks-sp-thumb">
                <Wireframe layout={layout} size={deck.size} />
              </span>
              <span className="ks-sp-layout-name">{layout.label}</span>
              {layout.name === slide.layout ? <Icon name="check" size={14} /> : null}
            </button>
          ))}
        </div>
      </PanelSection>

      <PanelSection id="transition" title="Transition">
        <Row label="Transition">
          <span className="ks-sp-value">{transitionName(slide)}</span>
          <TextButton onClick={() => ui.openPanel("transitions")}>Change…</TextButton>
        </Row>
      </PanelSection>

      <PanelSection id="numbers" title="Slide numbers">
        <Toggle label="Show slide numbers" on={deck.present.slideNumbers} onChange={(on) => session.slides.setSlideNumbers(on)} />
        <p className="ks-sp-hint">For every slide of the deck: in the editor, when presenting and in exported files.</p>
      </PanelSection>

      <PanelSection id="theme" title="Theme">
        <div className="ks-sp-themes" role="listbox" aria-label="Theme" onKeyDown={(event) => walkOptions(event, 2)}>
          {themeChoices().map((choice, i, all) => {
            const on = choice.name === theme.name;
            return (
              <button
                key={choice.name}
                type="button"
                role="option"
                aria-selected={on}
                tabIndex={stopAt(i, all.findIndex((c) => c.name === theme.name))}
                className={`ks-btn ks-sp-theme${on ? " is-on" : ""}`}
                onClick={() => !on && session.slides.applyTheme(choice.name)}
              >
                <ThemeStrip colors={choice.colors} />
                <span className="ks-sp-theme-line">
                  <span className="ks-sp-theme-name">{choice.name}</span>
                  {on ? <Icon name="check" size={14} /> : null}
                </span>
              </button>
            );
          })}
        </div>
        <div className="ks-sp-actions">
          <TextButton onClick={() => ui.openDialog("theme")}>Edit theme…</TextButton>
        </div>
      </PanelSection>
    </>
  );
}
