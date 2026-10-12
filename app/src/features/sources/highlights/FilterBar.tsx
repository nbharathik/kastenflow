// The Highlights view's toolbar: search, colours, "No card yet", the card's
// tag, and how the highlights are laid out; under it, the filters that are on
// as chips that take themselves off, and a way to clear them all. It stays at
// the top while the highlights scroll.

import type { RefObject } from "react";

import type { HighlightColor } from "../../../lib/vault/types";
import { Icon } from "../../../ui/Icon";
import { Segmented } from "../../../ui/Segmented";
import { Dropdown } from "../../library/Dropdown";
import { COLOR_NAMES, HIGHLIGHT_COLORS } from "../colors";

import "../colors.css";
import "./filters.css";

export type Layout = "sources" | "newest";

export interface Filters {
  colors: ReadonlySet<HighlightColor>;
  uncarded: boolean;
  tag: string;
  words: string;
}

interface Props {
  filters: Filters;
  /** How many highlights have each colour. */
  perColor: ReadonlyMap<HighlightColor, number>;
  /** The tags the highlights' cards have. */
  tags: readonly string[];
  layout: Layout;
  barRef: RefObject<HTMLDivElement | null>;
  onColor(color: HighlightColor): void;
  onUncarded(on: boolean): void;
  onTag(tag: string): void;
  onWords(words: string): void;
  onLayout(layout: Layout): void;
  onClear(): void;
}

export function FilterBar({ filters, perColor, tags, layout, barRef, onColor, onUncarded, onTag, onWords, onLayout, onClear }: Props) {
  const { colors, uncarded, tag, words } = filters;
  const active = [
    ...HIGHLIGHT_COLORS.filter((c) => colors.has(c)).map((c) => ({ key: c, label: COLOR_NAMES[c], swatch: c, off: () => onColor(c) })),
    ...(uncarded ? [{ key: "uncarded", label: "No card yet", swatch: undefined, off: () => onUncarded(false) }] : []),
    ...(tag ? [{ key: "tag", label: `#${tag}`, swatch: undefined, off: () => onTag("") }] : []),
    ...(words.trim() ? [{ key: "words", label: `“${words.trim()}”`, swatch: undefined, off: () => onWords("") }] : []),
  ];

  return (
    <div className="kasten-hls-bar" ref={barRef}>
      <div className="kasten-hls-filters" role="toolbar" aria-label="Filters">
        <div className="kasten-hls-search">
          <Icon name="search" className="kasten-hls-search-icon size-4" />
          <input className="kasten-hls-find" type="search" value={words} placeholder="Find in highlights…" aria-label="Find in highlights" onChange={(e) => onWords(e.target.value)} />
          {words !== "" && (
            <button type="button" className="kasten-hls-search-clear" aria-label="Clear search" title="Clear search" onClick={() => onWords("")}>
              <Icon name="close" className="size-3.5" />
            </button>
          )}
        </div>
        <div className="kasten-hls-colors" role="group" aria-label="Colours">
          {HIGHLIGHT_COLORS.map((color) => (
            <button key={color} type="button" className="kasten-hls-chip" aria-label={COLOR_NAMES[color]} aria-pressed={colors.has(color)} title={COLOR_NAMES[color]} onClick={() => onColor(color)}>
              <span className={`kasten-hl-swatch is-${color}`} aria-hidden="true" />
              {perColor.get(color) ? <span className="kasten-hls-chip-count">{perColor.get(color)}</span> : null}
            </button>
          ))}
        </div>
        <button type="button" className="kasten-hls-toggle" aria-pressed={uncarded} onClick={() => onUncarded(!uncarded)}>
          No card yet
        </button>
        {tags.length > 0 && <Dropdown label="Tag" value={tag} active={tag !== ""} display={tag ? `#${tag}` : "All tags"} options={[{ value: "", label: "All tags" }, ...tags.map((t) => ({ value: t, label: `#${t}` }))]} onChange={onTag} />}
        <span className="kasten-hls-spacer" />
        <Segmented label="Show" value={layout} onChange={onLayout} choices={[{ value: "sources", label: "By PDF" }, { value: "newest", label: "Newest" }]} />
      </div>
      {active.length > 0 && (
        <ul className="kasten-hls-active" aria-label="Filters on">
          {active.map((chip) => (
            <li key={chip.key}>
              <button type="button" className="kasten-hls-active-chip" aria-label={`Remove filter: ${chip.label}`} onClick={chip.off}>
                {chip.swatch && <span className={`kasten-hl-swatch is-${chip.swatch}`} aria-hidden="true" />}
                {chip.label}
                <Icon name="close" className="size-3" />
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="kasten-hls-clear" onClick={onClear}>
              Clear all
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
