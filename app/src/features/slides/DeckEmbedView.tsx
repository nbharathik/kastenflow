// A deck inside a page (`![[talk.deck]]`): its current slide, drawn as the
// Slides home draws a thumbnail but at the width of the page, with arrows and
// a count to look through it, Present, and Open. Nothing here edits the deck.

import { SlideView } from "@kasten-slides/react";
import type { Deck } from "@kasten-slides/wasm";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { fileUrl } from "../../lib/vault/file-url";
import { Button, IconButton } from "../../ui/Button";
import { useWorkspace } from "../workspace/store";
import { presentFrom } from "./embed-present";
import { useDecks } from "./store";

const imageUrl = (path: string) => fileUrl(path) ?? undefined;

type Loaded = { status: "loading" } | { status: "failed"; message: string } | { status: "ready"; deck: Deck };

/** The deck at `path`, read again when its file changes. */
function useDeck(path: string): Loaded {
  const client = useWorkspace((s) => s.client);
  // The decks list is read again whenever a deck file changes.
  const modified = useDecks((s) => s.list.find((d) => d.path === path)?.modified);
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  useEffect(() => {
    if (!client) return;
    let live = true;
    client.deck(path).then(
      (file) => {
        if (!live) return;
        try {
          setLoaded({ status: "ready", deck: JSON.parse(file.text) as Deck });
        } catch {
          setLoaded({ status: "failed", message: "This deck could not be read." });
        }
      },
      (err: unknown) => live && setLoaded({ status: "failed", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      live = false;
    };
  }, [client, path, modified]);
  return loaded;
}

/** The slide, scaled to the width it is given. */
function Slide({ deck, at }: { deck: Deck; at: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const read = () => setWidth(element.clientWidth);
    read();
    const watcher = new ResizeObserver(read);
    watcher.observe(element);
    return () => watcher.disconnect();
  }, []);
  const slide = deck.slides[at];
  return (
    <div ref={box} className="relative w-full overflow-hidden bg-canvas" style={{ aspectRatio: `${deck.size.w} / ${deck.size.h}` }} aria-hidden="true">
      {slide && width > 0 && (
        <div style={{ width: deck.size.w, height: deck.size.h, transform: `scale(${width / deck.size.w})`, transformOrigin: "0 0" }}>
          <SlideView deck={deck} slide={slide} number={at + 1} count={deck.slides.length} mode="thumbnail" imageUrl={imageUrl} />
        </div>
      )}
    </div>
  );
}

export function DeckEmbedView({ path }: { path: string }) {
  const loaded = useDeck(path);
  const [index, setIndex] = useState(0);
  if (loaded.status === "loading") return <p className="px-3 py-6 text-center text-13 text-muted">Opening the deck…</p>;
  if (loaded.status === "failed") return <p className="px-3 py-6 text-center text-13 text-muted">{loaded.message}</p>;
  const { deck } = loaded;
  const count = deck.slides.length;
  if (count === 0) return <p className="px-3 py-6 text-center text-13 text-muted">An empty deck.</p>;
  // The deck may have lost slides since the one shown was chosen.
  const at = Math.min(index, count - 1);
  const go = (to: number) => setIndex(Math.max(0, Math.min(count - 1, to)));
  const { client, openPath, toast } = useWorkspace.getState();
  return (
    <div
      className="kasten-deck-view"
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        go(at + (event.key === "ArrowRight" ? 1 : -1));
      }}
    >
      <Slide deck={deck} at={at} />
      <div className="flex h-8 items-center gap-1 border-t border-line px-2 text-13 text-muted">
        <IconButton icon="chevron-left" label="Previous slide" size="sm" disabled={at === 0} onClick={() => go(at - 1)} />
        <span className="min-w-12 text-center tabular-nums" aria-live="polite">
          {at + 1} / {count}
        </span>
        <IconButton icon="chevron" label="Next slide" size="sm" disabled={at === count - 1} onClick={() => go(at + 1)} />
        <span className="flex-1" />
        <Button tone="quiet" size="sm" icon="present" onClick={() => client && void presentFrom(client, path, deck, at, toast)}>
          Present
        </Button>
        <Button tone="quiet" size="sm" icon="external" onClick={() => openPath(path)}>
          Open
        </Button>
      </div>
    </div>
  );
}
