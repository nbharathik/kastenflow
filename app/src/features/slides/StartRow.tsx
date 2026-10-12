import { useState } from "react";

import { Icon } from "../../ui/Icon";
import { DeckThumb } from "./DeckThumb";
import { startDeck } from "./make-deck";
import { useTemplates } from "./TemplateGallery";

/** The templates the row offers first, when the engine has them: a light one, a dark one, and a few designed ones. */
const FEATURED = ["Light", "Dark", "Minimal", "Modern", "Pitch"];

const SIZE = { w: 960, h: 540 };

/** The cards' edge and lift: the same as the deck cards' under it. */
const CARD = "group block w-full rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-60";
const FRAME = "overflow-hidden rounded-lg border border-line bg-canvas shadow-card transition ease-standard group-hover:border-line-hover group-hover:shadow-hover motion-reduce:transition-none";

/**
 * "Start a new presentation": a blank one, and the first of the templates, each a card that makes the deck at once and opens it, with
 * the gallery (a name, a shape, the example slides) one press away. The deck is called "Untitled presentation" until it is named in the
 * editor, so starting one never asks a question first.
 */
export function StartRow({ onGallery }: { onGallery(): void }) {
  const { names, decks } = useTemplates(SIZE);
  const [making, setMaking] = useState<string | null>(null);
  const shown = FEATURED.filter((name) => names.includes(name)).concat(names.filter((name) => !FEATURED.includes(name))).slice(0, FEATURED.length);

  const make = async (key: string, template: string, examples: boolean) => {
    if (making) return;
    setMaking(key);
    try {
      await startDeck({ template, examples, size: SIZE });
    } finally {
      setMaking(null);
    }
  };

  return (
    <section aria-label="Start a new presentation" className="mt-7">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h2 className="text-12 font-medium text-muted">Start a new presentation</h2>
        <button type="button" onClick={onGallery} className="flex h-7 items-center gap-1 rounded-md px-2 text-12 text-muted outline-none transition hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60">
          Template gallery
          <Icon name="chevron" className="size-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3">
        <button type="button" disabled={making !== null} onClick={() => void make("blank", "Light", false)} className={CARD} aria-label="Blank presentation">
          <div className={`${FRAME} grid aspect-video place-items-center text-muted`}>
            <Icon name="plus" className="size-7" />
          </div>
          <div className="px-0.5 pt-1.5 text-13 font-medium">Blank</div>
        </button>
        {shown.map((name) => (
          <button key={name} type="button" disabled={making !== null} onClick={() => void make(name, name, true)} className={CARD} aria-label={`${name} presentation`}>
            <div className={FRAME}>
              <DeckThumb deck={decks.get(name) ?? null} />
            </div>
            <div className="px-0.5 pt-1.5 text-13 font-medium">{name}</div>
          </button>
        ))}
      </div>
    </section>
  );
}
