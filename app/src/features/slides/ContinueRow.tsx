import { useMemo, useSyncExternalStore } from "react";

import type { DeckInfo } from "../../lib/vault/types";
import { howFrom, useWorkspace } from "../workspace/store";
import { deckAiSource } from "./ai-status";
import { CardThumb, editedAgo, slidesOf } from "./DeckCard";
import { continueDeck, deckToContinue } from "./return-to-slides";
import { useDecks } from "./store";

const SAYS = { working: "The assistant is working on it", paused: "The assistant paused and can go on", failed: "The assistant's last request failed", idle: "" } as const;

/** How many decks the row offers. */
const MOST = 4;

function ContinueCard({ info, open }: { info: DeckInfo; open: boolean }) {
  const source = useMemo(() => deckAiSource(info.path), [info.path]);
  const says = SAYS[useSyncExternalStore(source.subscribe, source.current)];
  const meta = [open ? "Open in a tab" : "", slidesOf(info.slides), editedAgo(info.modified), says].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      aria-label={`Continue: ${info.title}`}
      onClick={(event) => continueDeck(info.path, howFrom(event))}
      className="group block min-w-0 rounded-xl border border-line bg-canvas p-3 text-left shadow-card outline-none transition ease-standard hover:border-line-hover hover:shadow-hover focus-visible:ring-2 focus-visible:ring-accent/60 motion-reduce:transition-none"
    >
      <CardThumb info={info} />
      <span className="mt-2.5 block truncate text-14 font-semibold">{info.title}</span>
      <span className="mt-0.5 block truncate text-12 text-muted">{meta}</span>
    </button>
  );
}

/**
 * "Continue" at the top of the Slides home: the few decks worked on last, as cards with their first slide, name, slide count and when they
 * were edited. The deck open in a tab (else the one opened last) comes first, and one click goes back to it, in its tab if it has one.
 */
export function ContinueRow() {
  const layout = useWorkspace((s) => s.layout);
  const recent = useWorkspace((s) => s.recent);
  const list = useDecks((s) => s.list);
  const target = useMemo(() => deckToContinue(), [layout, recent, list]);
  const shown = useMemo(() => {
    const readable = list.filter((deck) => !deck.problem);
    const first = target ? (readable.find((deck) => deck.path === target.path) ?? null) : null;
    const rest = readable.filter((deck) => deck.path !== first?.path).sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0));
    return (first ? [first, ...rest] : rest).slice(0, MOST);
  }, [list, target]);
  if (shown.length === 0) return null;
  return (
    <section aria-label="Continue" className="mt-7">
      <h2 className="mb-2.5 text-12 font-medium text-muted">Continue</h2>
      <div className="sh-continue">
        {shown.map((deck) => (
          <ContinueCard key={deck.path} info={deck} open={Boolean(target?.open && target.path === deck.path)} />
        ))}
      </div>
    </section>
  );
}
