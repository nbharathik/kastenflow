// A run of tool rows in an answer. Up to four show as they are; a longer run
// folds into one line ("12 steps · 1 waiting") that opens on a click. The
// steps that need the person's eye stay in sight: a failed one, one that did
// not finish or is under way, one that waits for review.

import { useRef, useState } from "react";

import { useFlip } from "../../../lib/flip";
import { Icon } from "../../../ui/Icon";
import type { Part } from "../thread";
import { needsEye, ToolRow, waitsForReview } from "./ToolRow";

type ToolPart = Extract<Part, { kind: "tool" }>;

/** More steps in a row than this fold. */
export const FOLD_OVER = 4;

/** The line a folded run shows: how many steps, and what needs a look. */
export function runSummary(parts: ToolPart[]): string {
  const waiting = parts.filter(waitsForReview).length;
  const failed = parts.filter((p) => p.result && !p.result.ok).length;
  return [`${parts.length} steps`, waiting ? `${waiting} waiting` : "", failed ? `${failed} failed` : ""].filter(Boolean).join(" · ");
}

export function ToolRun({ parts, live }: { parts: ToolPart[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const rows = (list: ToolPart[]) => list.map((part, i) => <ToolRow key={part.call.id || i} part={part} live={live} />);
  const kept = parts.length <= FOLD_OVER ? parts : parts.filter(needsEye);
  // Rows that stay in sight slide up as others fold away or finish.
  useFlip(box, `${open}|${kept.map((p) => p.call.id).join(",")}`);
  if (parts.length <= FOLD_OVER) return <>{rows(parts)}</>;
  return (
    <div ref={box} className="kasten-chat-run" data-open={open}>
      <button type="button" className="kasten-chat-run-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="chevron" className="kasten-chat-run-chevron size-3.5" />
        <span>{runSummary(parts)}</span>
      </button>
      {open ? <div className="kasten-chat-run-rows is-entering">{rows(parts)}</div> : rows(kept)}
    </div>
  );
}
