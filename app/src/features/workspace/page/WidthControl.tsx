// The page width as three choices side by side: normal, wide, full. Used in
// the page menu's style and shared with the Settings default. Arrow keys move
// the choice, as in any radio group.

import type { KeyboardEvent } from "react";

import { PAGE_WIDTHS, type PageWidth } from "../prefs";

const CHOICES: Record<PageWidth, { short: string; name: string }> = {
  normal: { short: "Normal", name: "Normal width" },
  wide: { short: "Wide", name: "Wide" },
  full: { short: "Full", name: "Full width" },
};

export function WidthControl({ value, onChange, className = "" }: { value: PageWidth; onChange: (width: PageWidth) => void; className?: string }) {
  const move = (event: KeyboardEvent<HTMLButtonElement>, from: PageWidth) => {
    // Inside a menu, Up and Down leave the group for the next row.
    const inMenu = event.currentTarget.closest('[role="menu"]') !== null;
    const step = (inMenu ? { ArrowRight: 1, ArrowLeft: -1 } : { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 })[event.key as "ArrowRight"];
    if (step === undefined) return;
    event.preventDefault();
    const next = PAGE_WIDTHS[(PAGE_WIDTHS.indexOf(from) + step + PAGE_WIDTHS.length) % PAGE_WIDTHS.length]!;
    onChange(next);
    const radios = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    radios?.[PAGE_WIDTHS.indexOf(next)]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Page width" className={`ui-seg ${className}`}>
      {PAGE_WIDTHS.map((width) => (
        <button
          key={width}
          type="button"
          role="radio"
          aria-checked={width === value}
          aria-label={CHOICES[width].name}
          tabIndex={width === value ? 0 : -1}
          onClick={() => onChange(width)}
          onKeyDown={(event) => move(event, width)}
        >
          {CHOICES[width].short}
        </button>
      ))}
    </div>
  );
}
