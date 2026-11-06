import { type ReactNode, useState } from "react";

import type { NoteMeta } from "../../lib/vault/types";
import { Icon, type IconName } from "../../ui/Icon";
import { ImportButton } from "./ImportButton";
import { NotePicker } from "./NotePicker";
import { startDeck } from "./make-deck";
import { startFromNote, startFromOutline } from "./start-from";
import { TemplateCards } from "./TemplateCards";

const SIZE = { w: 960, h: 540 };

/** The ways to begin share one look: a mark, a name and one line on what happens. */
const WAY = "sh-way group flex items-center gap-3 rounded-xl border border-line bg-canvas p-3 text-left shadow-card outline-none transition ease-standard hover:border-line-hover hover:shadow-hover focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-60 motion-reduce:transition-none";

function WayFace({ icon, name, hint }: { icon: IconName; name: string; hint: string }): ReactNode {
  return (
    <>
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-well text-muted group-hover:text-ink">
        <Icon name={icon} className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-14 font-semibold">{name}</span>
        <span className="block truncate text-12 text-muted">{hint}</span>
      </span>
    </>
  );
}

/**
 * "Start a new presentation": a blank one, one from a page or an outline, a PowerPoint file brought in, and the templates as a gallery
 * with their first slides drawn. Each card makes the deck at once and opens it, with the New deck form (a name, a shape, your own
 * templates) one press away. The deck is called "Untitled presentation" until it is named in the editor, so starting one never asks
 * a question first.
 */
export function StartRow({ onGallery }: { onGallery(): void }) {
  const [making, setMaking] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const make = async (key: string, job: () => Promise<unknown>) => {
    if (making) return;
    setMaking(key);
    try {
      await job();
    } finally {
      setMaking(null);
    }
  };
  const fromNote = (note: NoteMeta) => {
    setPicking(false);
    void make("note", () => startFromNote(note));
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
      <div className="sh-ways">
        <button type="button" disabled={making !== null} onClick={() => void make("blank", () => startDeck({ template: "Light", examples: false, size: SIZE }))} className={WAY} aria-label="Blank presentation">
          <WayFace icon="plus" name="Blank" hint="One empty slide" />
        </button>
        <button type="button" disabled={making !== null} aria-expanded={picking} onClick={() => setPicking((on) => !on)} className={WAY}>
          <WayFace icon="page" name="From a note" hint="A page, a slide for each section" />
        </button>
        <button type="button" disabled={making !== null} onClick={() => void make("outline", startFromOutline)} className={WAY}>
          <WayFace icon="list" name="From an outline" hint="Type a list, get the slides" />
        </button>
        <ImportButton project={null} className={WAY}>
          <WayFace icon="import" name="Import PowerPoint" hint="Bring in a .pptx file" />
        </ImportButton>
      </div>
      {picking && <NotePicker onPick={fromNote} onClose={() => setPicking(false)} />}
      <TemplateCards busy={making !== null} onMake={(name) => void make(name, () => startDeck({ template: name, examples: true, size: SIZE }))} />
    </section>
  );
}
