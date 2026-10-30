// A part of a Home card that opens in place: the height runs from nothing to
// its own with `grid-template-rows` (home.css). While shut it is `inert`, so
// the rows in it are neither read out nor reached with Tab.

import { type ReactNode } from "react";

export function Fold({ open, id, children }: { open: boolean; id?: string; children: ReactNode }) {
  return (
    <div id={id} className="kasten-fold" data-open={open ? "true" : "false"} aria-hidden={open ? undefined : true} inert={!open}>
      <div className="kasten-fold-inner">{children}</div>
    </div>
  );
}

/** The button that opens a `Fold`: "+3 more", or "Show fewer" once open. */
export function FoldToggle({ open, label, controls, onToggle }: { open: boolean; label: string; controls?: string; onToggle(): void }) {
  return (
    <button type="button" className="kasten-dash-more" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      {open ? "Show fewer" : label}
    </button>
  );
}
