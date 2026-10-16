// The Highlights view: the PDFs as a shelf, then
// every highlight, grouped by its PDF or newest first, filtered by colour,
// by whether it has a card yet, by the card's tags and by words. A highlight
// opens the reader at its spot, becomes a card, and drags onto a board as
// its card. PDFs come in with Import, Ctrl+O or a drop.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import type { Highlight, HighlightColor, NoteMeta } from "../../lib/vault/types";
import { Icon } from "../../ui/Icon";
import { howFrom, useWorkspace } from "../workspace/store";
import { colorOf } from "./colors";
import { count } from "./highlights/cover";
import { FilterBar, type Layout } from "./highlights/FilterBar";
import { HighlightCard } from "./highlights/HighlightCard";
import { Library } from "./highlights/Library";
import { SourceGroup } from "./highlights/SourceGroup";
import { openCompare } from "./compare/compare-state";
import { pickPdfs } from "./import";
import { readingOrder } from "./reader/HighlightList";
import { useSources } from "./store";

import "./colors.css";
import "./highlights.css";

export function HighlightsHome() {
  const list = useSources((s) => s.list);
  const highlights = useSources((s) => s.highlights);
  const notes = useWorkspace((s) => s.notes);
  const [colors, setColors] = useState<ReadonlySet<HighlightColor>>(new Set());
  const [tag, setTag] = useState("");
  const [words, setWords] = useState("");
  const [uncarded, setUncarded] = useState(false);
  const [layout, setLayout] = useState<Layout>("sources");
  const root = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const hasSources = Boolean(list && list.length > 0);

  useEffect(() => {
    void useSources.getState().loadAll();
  }, []);

  // PDFs' headings stay under the toolbar, whatever height it wraps to.
  useLayoutEffect(() => {
    const host = root.current;
    const toolbar = bar.current;
    if (!host || !toolbar || typeof ResizeObserver === "undefined") return;
    const measure = () => host.style.setProperty("--hls-bar", `${toolbar.offsetHeight}px`);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(toolbar);
    return () => watch.disconnect();
  }, [hasSources]);

  const byPath = useMemo(() => new Map(notes.map((n) => [n.path, n])), [notes]);
  const cardOf = (h: Highlight): NoteMeta | undefined => (h.card ? byPath.get(h.card) : undefined);
  const all = useMemo(() => (list ?? []).flatMap((source) => (highlights[source.path] ?? []).map((h) => ({ source, h }))), [list, highlights]);
  const tags = useMemo(() => {
    const found = new Set<string>();
    for (const { h } of all) for (const t of (h.card ? byPath.get(h.card)?.tags : undefined) ?? []) found.add(t);
    return [...found].sort((a, b) => a.localeCompare(b));
  }, [all, byPath]);
  const perColor = useMemo(() => {
    const by = new Map<HighlightColor, number>();
    for (const { h } of all) by.set(colorOf(h.color), (by.get(colorOf(h.color)) ?? 0) + 1);
    return by;
  }, [all]);

  const filtering = colors.size > 0 || tag !== "" || words.trim() !== "" || uncarded;
  const wanted = words.trim().toLowerCase();
  const keep = (h: Highlight) =>
    (colors.size === 0 || colors.has(colorOf(h.color))) &&
    (!uncarded || !h.card) &&
    (tag === "" || (cardOf(h)?.tags ?? []).some((t) => t.toLowerCase() === tag.toLowerCase())) &&
    (wanted === "" || h.text.toLowerCase().includes(wanted) || (h.comment ?? "").toLowerCase().includes(wanted));

  const groups = (list ?? []).map((source) => ({ source, all: highlights[source.path] ?? [], shown: readingOrder((highlights[source.path] ?? []).filter(keep)) }));
  const visible = groups.filter((g) => !filtering || g.shown.length > 0);
  const newest = all.filter(({ h }) => keep(h)).sort((a, b) => (b.h.created ?? "").localeCompare(a.h.created ?? ""));
  const total = (list ?? []).reduce((n, s) => n + (highlights[s.path]?.length ?? s.highlights), 0);
  const carded = all.filter(({ h }) => h.card).length;
  const kept = filtering ? new Map(groups.map((g) => [g.source.path, g.shown.length])) : undefined;
  const nothing = filtering && (layout === "newest" ? newest.length === 0 : visible.length === 0);
  const toggle = (color: HighlightColor) =>
    setColors((now) => {
      const next = new Set(now);
      if (next.has(color)) next.delete(color);
      else next.add(color);
      return next;
    });
  const clear = () => {
    setColors(new Set());
    setTag("");
    setWords("");
    setUncarded(false);
  };
  const open = (path: string, e: MouseEvent) => useWorkspace.getState().go({ view: "highlights", path }, howFrom(e));

  return (
    <div className="kasten-hls" ref={root}>
      <header className="kasten-hls-head">
        <div>
          <h1>Highlights</h1>
          <div className="kasten-hls-stats" role="group" aria-label="Summary">
            {list ? (
              <>
                <span>{count(total, "highlight")}</span>
                <span>{count(list.length, "PDF")}</span>
                {carded > 0 && <span>{count(carded, "card")}</span>}
              </>
            ) : (
              <span className="kasten-hls-reading">Reading your sources…</span>
            )}
          </div>
        </div>
        <div className="kasten-hls-head-actions">
          {list && list.length > 1 && (
            <button type="button" className="ui-btn" onClick={() => openCompare({ sources: list.map((s) => s.path) })} title="Put papers side by side in a page, with the highlights as evidence">
              Compare papers…
            </button>
          )}
          <button type="button" className="ui-btn is-primary" onClick={pickPdfs} title="Import a PDF (Ctrl+O), or drop one anywhere">
            Import PDF…
          </button>
        </div>
      </header>

      {list && list.length > 0 && <Library sources={list} highlights={highlights} kept={kept} onOpen={open} />}

      {list && list.length > 0 && (
        <FilterBar
          filters={{ colors, uncarded, tag, words }}
          perColor={perColor}
          tags={tags}
          layout={layout}
          barRef={bar}
          onColor={toggle}
          onUncarded={setUncarded}
          onTag={setTag}
          onWords={setWords}
          onLayout={setLayout}
          onClear={clear}
        />
      )}

      {list && list.length === 0 ? (
        <div className="kasten-hls-empty">
          <span aria-hidden="true">
            <Icon name="book" className="size-6" />
          </span>
          <h2>Read and highlight PDFs</h2>
          <p>Drop a PDF anywhere in KastenFlow, or import one. Select a passage to highlight it; a highlight becomes a card that links back to the exact spot.</p>
          <button type="button" className="ui-btn is-primary" onClick={pickPdfs}>
            Import PDF…
          </button>
        </div>
      ) : nothing ? (
        <div className="kasten-hls-nomatch">
          <p>No highlights match these filters.</p>
          <button type="button" className="ui-btn" onClick={clear}>
            Clear filters
          </button>
        </div>
      ) : layout === "newest" ? (
        <section className="kasten-hls-source" aria-label="Newest highlights">
          {newest.length === 0 ? (
            <p className="kasten-hls-none">Nothing highlighted yet. Open a PDF to read and highlight.</p>
          ) : (
            <ol>
              {newest.map(({ source, h }) => (
                <li key={`${source.path}#${h.id}`}>
                  <HighlightCard source={source.path} sourceTitle={source.title} highlight={h} card={cardOf(h)} showSource />
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : (
        visible.map(({ source, all: every, shown }) => <SourceGroup key={source.path} source={source} all={every} shown={shown} filtering={filtering} cardOf={cardOf} />)
      )}
    </div>
  );
}
