// A note on the board: icon and title, its first lines, and a chip for each
// of its other properties. Click opens it (Ctrl or the middle button in a
// tab, Shift on the side stack, Alt in a split); a press that travels drags
// it; a focused card answers the keys in keys.ts. Memoised: it redraws only
// when its note, the tag's properties or the card colour change.

import { memo, type MouseEvent } from "react";

import type { NoteMeta, PropDef } from "../../../../lib/vault/types";
import { chipStyle } from "../../../panel/properties/schemas";
import { CalculatedCue, RowProblems } from "../../formula/FormulaMark";
import { isFormula } from "../../formula/rows";
import { iconOf, titleOf } from "../../../workspace/names";
import { ParentChip } from "../../sub-items";
import { useBoard } from "./context";
import { cardChips, tintOf } from "./values";
import { IconOrEmoji } from "../../../../ui/IconOrEmoji";

interface CardProps {
  note: NoteMeta;
  /** The properties it shows chips for. */
  defs: readonly PropDef[];
  /** The select that colours it (the view's `color_by`), if any. */
  colorBy: PropDef | null;
  /** Today, YYYY-MM-DD, for dates in words. */
  today: string;
}

/** Keeps the middle button from starting to scroll, so it can open a tab. */
const noAutoScroll = (event: MouseEvent) => event.button === 1 && event.preventDefault();

export const Card = memo(function Card({ note, defs, colorBy, today }: CardProps) {
  const board = useBoard();
  const title = titleOf(note);
  const tint = tintOf(note, colorBy);
  const chips = cardChips(note, defs, today);
  const calculated = defs.filter(isFormula).map((d) => d.key);
  const excerpt = note.excerpt && note.excerpt !== title ? note.excerpt : "";
  return (
    <li className="kasten-kanban-slot" data-flip={note.path}>
      <div
        role="button"
        tabIndex={0}
        data-card={note.path}
        aria-label={title}
        aria-describedby={board.hint}
        className={`kasten-kanban-card${tint ? " is-tinted" : ""}`}
        style={chipStyle(tint)}
        onPointerDown={(event) => board.press(event, note.path)}
        onClick={(event) => board.open(note.path, event)}
        onMouseDown={noAutoScroll}
        onAuxClick={(event) => event.button === 1 && board.open(note.path, "tab")}
        onKeyDown={(event) => board.key(event, note.path)}
      >
        <span className="kasten-kanban-title">
          <span className={`kasten-kanban-icon${note.icon ? "" : " is-plain"}`} aria-hidden="true">
            <IconOrEmoji icon={iconOf(note)} />
          </span>
          <span className="kasten-kanban-name">{title}</span>
        </span>
        <ParentChip note={note} />
        {excerpt && <span className="kasten-kanban-excerpt">{excerpt}</span>}
        {(chips.length > 0 || calculated.length > 0) && (
          <span className="kasten-kanban-chips">
            {chips.map((chip) => (
              <span key={chip.id} title={chip.title} className={`kasten-kanban-chip is-${chip.kind}${chip.late ? " is-late" : ""}`} style={chipStyle(chip.tone)}>
                {chip.kind === "formula" && <CalculatedCue />}
                {chip.text}
              </span>
            ))}
            <RowProblems path={note.path} keys={calculated} />
          </span>
        )}
      </div>
    </li>
  );
});
