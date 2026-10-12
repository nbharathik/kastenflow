// Small pieces the library's grid, table and bars share: a few glyphs the
// shell's icon set lacks, tag chips in their schema colours, and search
// words marked in text.

import type { ReactNode } from "react";
import { Icon } from "../../ui/Icon";
import { swatch, type Swatch } from "../panel/properties/schemas";

const GLYPHS = {
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  table: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M3.5 14.5h17M9 9.5v10" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1" />
      <path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" />
    </>
  ),
  up: <path d="M12 19V5M6.5 10.5L12 5l5.5 5.5" />,
  down: <path d="M12 5v14M6.5 13.5L12 19l5.5-5.5" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  tick: <path d="M5.5 12.5l4 4 9-9.5" />,
  move: (
    <>
      <path d="M4 12h13" />
      <path d="M13 7l5 5-5 5" />
    </>
  ),
} as const;

export type GlyphName = keyof typeof GLYPHS;

/** A stroke glyph in the style of the shell's `Icon`. */
export function Glyph({ name, className = "" }: { name: GlyphName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "tick" ? 2.5 : 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {GLYPHS[name]}
    </svg>
  );
}

const GRAY = swatch("gray")!;
/** One object per colour, so chips that memoise on it redraw only when it changes. */
const swatches = new Map<string, Swatch>();

/** A tag schema's colour as text and background colours: the Tag Database's
 * own function (`swatch`, so teal and #hex colours read the same here), gray
 * for a colour it does not know and null for none. */
export function tagSwatch(color: string | null | undefined): Swatch | null {
  const name = color?.trim().toLowerCase();
  if (!name) return null;
  let found = swatches.get(name);
  if (!found) swatches.set(name, (found = swatch(name) ?? GRAY));
  return found;
}

/** How a tag's chip is coloured: its schema colour, or, with none, as the
 * Tag Database draws such a tag (a soft well, plain ink). */
export function tagChipColors(color: string | null | undefined): { background: string; color: string } {
  const tone = tagSwatch(color);
  return tone ? { background: tone.bg, color: tone.fg } : { background: "var(--color-soft)", color: "var(--color-ink)" };
}

/** Tags as coloured chips, the first `max` of them and a count of the rest. */
export function TagChips({ tags, colors, max = 4, small = false }: { tags: readonly string[]; colors: Record<string, string>; max?: number; small?: boolean }) {
  if (tags.length === 0) return null;
  const size = small ? "px-1.5 py-px text-11" : "px-2 py-0.5 text-12";
  return (
    <span className="flex min-w-0 flex-wrap gap-1">
      {tags.slice(0, max).map((tag, i) => {
        return (
          <span
            // A note may list a tag twice.
            key={`${i}:${tag}`}
            className={`max-w-[10rem] truncate rounded font-medium leading-[1.4] ${size}`}
            style={tagChipColors(colors[tag.toLowerCase()])}
          >
            {tag}
          </span>
        );
      })}
      {tags.length > max && <span className={`rounded bg-well text-muted ${size}`}>+{tags.length - max}</span>}
    </span>
  );
}

/** The note has agent writing no one has edited or accepted yet; its page shows where. */
export function AgentStar() {
  return (
    <span
      role="img"
      aria-label="Agent writing to review"
      title="An agent wrote some of this, not yet edited or accepted"
      className="inline-grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-(--kasten-agent-bg) px-1 text-11 leading-none text-(--kasten-agent)"
    >
      <Icon name="agent" className="size-3" />
    </span>
  );
}

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `text` with each search word marked. */
export function Marked({ text, words }: { text: string; words: readonly string[] }): ReactNode {
  const shown = words.filter((w) => w.trim());
  if (shown.length === 0 || !text) return text;
  const pattern = new RegExp(`(${[...shown].sort((a, b) => b.length - a.length).map(escape).join("|")})`, "gi");
  return text.split(pattern).map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded-[3px] bg-accent/15 px-px text-inherit">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

/** "1 card", "12 cards". */
export const cards = (n: number) => `${n.toLocaleString()} card${n === 1 ? "" : "s"}`;

// One formatter for every card: making one per call is slow.
const FULL = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** "24 Sept 2026, 15:02", for tooltips. */
export const fullDate = (millis: number) => FULL.format(millis);
