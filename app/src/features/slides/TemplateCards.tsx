import { useState } from "react";

import { Icon } from "../../ui/Icon";
import { DeckThumb } from "./DeckThumb";
import { useTemplates } from "./TemplateGallery";

/** The templates shown first, when the engine has them: a light one, a dark one, and a few designed ones. */
const FEATURED = ["Light", "Dark", "Minimal", "Modern", "Pitch"];

const SIZE = { w: 960, h: 540 };

/** The first slides drawn for each template: the title slide large, the next two beside it. */
const SHOWN = [0, 1, 2] as const;

/**
 * The built-in templates as a gallery. Each card draws its first three slides, so a template says what a deck made from it looks like,
 * and makes that deck (with its example slides) in one press. The first few are shown; the rest are one press away.
 */
export function TemplateCards({ busy, onMake }: { busy: boolean; onMake(name: string): void }) {
  const { names, decks } = useTemplates(SIZE);
  const [all, setAll] = useState(false);
  const ordered = FEATURED.filter((name) => names.includes(name)).concat(names.filter((name) => !FEATURED.includes(name)));
  const shown = all ? ordered : ordered.slice(0, FEATURED.length);
  return (
    <div className="mt-6">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h3 className="text-12 font-medium text-muted">Templates</h3>
        {ordered.length > FEATURED.length && (
          <button
            type="button"
            aria-expanded={all}
            onClick={() => setAll((on) => !on)}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-12 text-muted outline-none transition hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            {all ? "Fewer templates" : `All ${ordered.length} templates`}
            <Icon name={all ? "chevron-up" : "chevron-down"} className="size-3.5" />
          </button>
        )}
      </div>
      <div className="sh-templates">
        {shown.map((name) => {
          const deck = decks.get(name) ?? null;
          return (
            <button
              key={name}
              type="button"
              disabled={busy}
              onClick={() => onMake(name)}
              aria-label={`${name} presentation`}
              className="group rounded-xl border border-line bg-canvas p-2 text-left shadow-card outline-none transition ease-standard hover:border-line-hover hover:shadow-hover focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-60 motion-reduce:transition-none"
            >
              <span className="grid grid-cols-[3fr_2fr] items-start gap-1.5 rounded-md bg-panel/70 p-1.5">
                <span className="block overflow-hidden rounded border border-line shadow-card">
                  <DeckThumb deck={deck} index={SHOWN[0]} />
                </span>
                <span className="grid gap-1.5">
                  {SHOWN.slice(1).map((index) => (
                    <span key={index} className="block overflow-hidden rounded border border-line">
                      <DeckThumb deck={deck} index={index} />
                    </span>
                  ))}
                </span>
              </span>
              <span className="block truncate px-1 pb-0.5 pt-2 text-13 font-medium">{name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
