// Glyphs for a column's type, in the header and the "+" menu, drawn like
// the shell's stroke icons.

import type { ReactNode } from "react";

import { own } from "./format";

const TYPES: Record<string, ReactNode> = {
  text: <path d="M5 7h14M5 12h14M5 17h9" />,
  number: <path d="M10 4.5 8 19.5M16 4.5l-2 15M5 9.5h14.5M4.5 14.5H19" />,
  select: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M9 11l3 3 3-3" />
    </>
  ),
  multi_select: (
    <>
      <path d="M9.5 7h10M9.5 12h10M9.5 17h10" />
      <circle cx="5.5" cy="7" r="1" />
      <circle cx="5.5" cy="12" r="1" />
      <circle cx="5.5" cy="17" r="1" />
    </>
  ),
  date: (
    <>
      <rect x="4" y="5.5" width="16" height="14" rx="2.5" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </>
  ),
  checkbox: (
    <>
      <rect x="4.5" y="4.5" width="15" height="15" rx="3" />
      <path d="M8.5 12.2l2.5 2.5 4.6-5.2" />
    </>
  ),
  url: (
    <>
      <path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1" />
      <path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" />
    </>
  ),
  relation: <path d="M7 17 17 7M9.5 7H17v7.5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  up: <path d="M12 19V5M6.5 10.5 12 5l5.5 5.5" />,
  down: <path d="M12 5v14M6.5 13.5 12 19l5.5-5.5" />,
  left: <path d="M19 12H5M10.5 6.5 5 12l5.5 5.5" />,
  right: <path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" />,
  hide: (
    <>
      <path d="M4 12s3-6 8-6c1.4 0 2.6.4 3.7 1M20 12s-3 6-8 6c-1.4 0-2.6-.4-3.7-1" />
      <path d="M5 19 19 5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M7 7l10 10M17 7 7 17" />,
  tick: <path d="M5.5 12.5l4 4 9-9.5" />,
};

export type GlyphName = keyof typeof TYPES;

/** A glyph by name; a column's type draws its own, the built-in dates a clock. */
export function Glyph({ name, className = "" }: { name: string; className?: string }) {
  const paths = own(TYPES, name) ?? (name === "created" || name === "updated" || name === "modified" ? TYPES.clock : name === "tags" ? TYPES.multi_select : name === "project" || name === "type" ? TYPES.select : TYPES.text);
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`kasten-table-glyph ${className}`}
    >
      {paths}
    </svg>
  );
}

/** The title column's mark, as Notion draws it. */
export function TitleMark() {
  return (
    <span aria-hidden="true" className="kasten-table-aa">
      Aa
    </span>
  );
}
