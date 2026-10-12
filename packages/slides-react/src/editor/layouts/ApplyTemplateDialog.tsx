import type { Deck } from "@kasten-slides/wasm";
import { type JSX, useEffect, useState } from "react";

import type { ImageUrl } from "../../render/index.ts";
import { SlideThumb } from "../filmstrip/SlideThumb.tsx";
import { stopAt, walkOptions } from "../panels/format/roving.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { useEditor } from "../useEditor.ts";
import type { DialogProps } from "../dialogs/types.ts";
import { applyTemplateTheme } from "./ops.ts";
import type { TemplateInfo } from "./templates-host.ts";
import "./layouts.css";

/** A template's sample slide carries no pictures. */
const NO_PICTURES: ImageUrl = () => undefined;

interface Loaded {
  info: TemplateInfo;
  deck: Deck | null;
}

/** The templates of the host with each one's deck, read to draw its first slide. A template that cannot be read is still offered by name. */
function useTemplates(session: DialogProps["session"]): { state: "loading" | "ready" | "none"; items: Loaded[] } {
  const [loaded, setLoaded] = useState<{ state: "loading" | "ready" | "none"; items: Loaded[] }>({ state: session.host.templates ? "loading" : "none", items: [] });
  useEffect(() => {
    const host = session.host.templates;
    if (!host) return;
    let live = true;
    void host.list().then(async (list) => {
      const items = await Promise.all(
        list.map(async (info): Promise<Loaded> => {
          try {
            return { info, deck: JSON.parse(await host.read(info.id)) as Deck };
          } catch {
            return { info, deck: null };
          }
        }),
      );
      if (live) setLoaded({ state: "ready", items });
    }, () => live && setLoaded({ state: "ready", items: [] }));
    return () => {
      live = false;
    };
  }, [session]);
  return loaded;
}

/**
 * Puts one of your templates on this deck: its colours, fonts, text styles, layouts and what every slide shows behind it. Every
 * slide keeps its words and everything on it; it is one step of undo. A template made for another shape of slide is fitted to this
 * deck's, unless you ask for the deck to take its shape too.
 */
export function ApplyTemplateDialog({ session, onClose }: DialogProps): JSX.Element {
  const { deck } = useEditor(session);
  const { state, items } = useTemplates(session);
  const [chosen, setChosen] = useState<string | null>(null);
  const [resize, setResize] = useState(false);
  const picked = items.find((item) => item.info.id === chosen) ?? null;
  const differs = picked?.deck ? picked.deck.size.w !== deck.size.w || picked.deck.size.h !== deck.size.h : false;
  const shape = (size: { w: number; h: number }) => `${Math.round(size.w)} by ${Math.round(size.h)}`;

  const apply = () => {
    if (!picked?.deck) return;
    if (applyTemplateTheme(session, { theme: picked.deck.theme, size: picked.deck.size }, resize)) {
      session.host.notify?.(`Applied the template “${picked.info.title}”. Your slides keep their words.`);
      onClose();
    }
  };

  return (
    <Dialog
      title="Apply a template"
      width={640}
      onClose={onClose}
      footer={
        <>
          <TextButton onClick={onClose}>Cancel</TextButton>
          <TextButton primary disabled={!picked?.deck} onClick={apply}>
            Apply to this deck
          </TextButton>
        </>
      }
    >
      {state === "none" ? <p className="ks-tm-empty">This editor has no templates to offer.</p> : null}
      {state === "loading" ? <p className="ks-tm-empty">Looking for your templates…</p> : null}
      {state === "ready" && items.length === 0 ? <p className="ks-tm-empty">You have no templates yet. Choose File, Save as template to keep this deck's look.</p> : null}
      {items.length > 0 ? (
        <div className="ks-tm-grid" role="listbox" aria-label="Your templates" onKeyDown={(event) => walkOptions(event, 3)}>
          {items.map((item, i) => {
            const on = item.info.id === chosen;
            const first = item.deck?.slides[0];
            return (
              <button
                key={item.info.id}
                type="button"
                role="option"
                aria-selected={on}
                tabIndex={stopAt(i, items.findIndex((other) => other.info.id === chosen))}
                className={`ks-btn ks-tm-card${on ? " is-on" : ""}`}
                onClick={() => setChosen(item.info.id)}
              >
                {item.deck && first ? <SlideThumb deck={item.deck} slide={first} number={1} count={item.deck.slides.length} width={150} imageUrl={NO_PICTURES} /> : null}
                <span className="ks-tm-name">{item.info.title}</span>
                <span className="ks-tm-meta">{item.deck ? `${shape(item.deck.size)}, ${item.deck.theme.layouts.length} layouts` : "Could not be read"}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {differs && picked?.deck ? (
        <div className="ks-ls-checks">
          <label className="ks-toggle">
            <input type="checkbox" checked={resize} onChange={(event) => setResize(event.target.checked)} />
            <span>
              Make the slides {shape(picked.deck.size)} like the template (now {shape(deck.size)})
            </span>
          </label>
        </div>
      ) : null}
      <p className="ks-ls-hint">Your slides keep their words and everything on them. Layouts you made stay, after the template's own.</p>
    </Dialog>
  );
}
