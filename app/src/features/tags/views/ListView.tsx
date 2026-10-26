// A tag's notes as a list: icon, title, first line and the values of its
// first few properties. Click opens (Ctrl for a tab, Shift for the side stack).

import { useState } from "react";
import { useShallow } from "zustand/shallow";

import type { NoteMeta, PropDef, TagSchema } from "../../../lib/vault/types";
import { CALCULATED, CalculatedCue, ProblemChip } from "../formula/FormulaMark";
import { formulaText, isFormula } from "../formula/rows";
import { useCellProblem } from "../formula/use-formula-rows";
import { relatedNote } from "../../panel/links/related";
import { asList } from "../../panel/properties/values";
import { chipStyle, optionSwatch } from "../../panel/properties/schemas";
import { iconOf, titleOf } from "../../workspace/names";
import { howFromView, useWorkspace } from "../../workspace/store";
import { valueOf } from "../model";
import { ParentChip } from "../sub-items";
import type { ViewProps } from "./types";
import { IconOrEmoji } from "../../../ui/IconOrEmoji";

/** A value as a short label: lists joined, dates as written, ticks as ✓. */
export function shortValue(value: unknown, def: PropDef | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) return value.join(", ");
  if (def?.type === "checkbox") return value === true || value === "true" ? "✓" : "";
  return String(value);
}

/** A relation's note ids as the notes' titles, as the table's relation cell
 * shows them (an id no note has stays as it is). Redrawn only when a title changes. */
function useRelationTitles(def: PropDef, value: unknown): string[] | null {
  const items = def.type === "relation" ? asList(value) : null;
  return useWorkspace(useShallow((s) => items?.map((item) => { const found = relatedNote(s.notes, item); return found ? titleOf(found) : item; }) ?? null));
}

/** A calculated value: its number or text with the "calculated" cue, or why it has none. */
function FormulaValue({ note, def }: { note: NoteMeta; def: PropDef }) {
  const why = useCellProblem(note.path, def.key);
  const text = formulaText(valueOf(note, def.key));
  if (why) return <ProblemChip sentence={why} />;
  if (!text) return null;
  return (
    <span title={`${def.key}: ${CALCULATED}`} className="kasten-tag-value is-formula">
      <CalculatedCue />
      {text}
    </span>
  );
}

function Value({ note, def }: { note: NoteMeta; def: PropDef }) {
  const value = valueOf(note, def.key);
  const titles = useRelationTitles(def, value);
  const text = titles ? titles.join(", ") : shortValue(value, def);
  if (!text) return null;
  const tinted = def.type === "select" ? chipStyle(optionSwatch(text, def.options)) : undefined;
  return (
    <span title={def.key} className={`kasten-tag-value ${tinted ? "is-tinted" : ""}`} style={tinted}>
      {text}
    </span>
  );
}

export function Values({ note, defs }: { note: NoteMeta; defs: PropDef[] }) {
  return (
    <span className="flex shrink-0 flex-wrap justify-end gap-1">
      {defs.map((def) => (isFormula(def) ? <FormulaValue key={def.key} note={note} def={def} /> : <Value key={def.key} note={note} def={def} />))}
    </span>
  );
}

/** Rows drawn at first, and added per "Show more": a tag can have thousands. */
export const LIST_PAGE = 200;

/** The properties a row or tile shows: the first three, and every calculated one. */
export const rowDefs = (schema: TagSchema | null): PropDef[] => (schema?.properties ?? []).filter((def, i) => i < 3 || isFormula(def));

export function ListView({ schema, notes }: ViewProps) {
  const defs = rowDefs(schema);
  const open = useWorkspace.getState().openPath;
  const [limit, setLimit] = useState(LIST_PAGE);
  if (notes.length === 0) return <p className="kasten-tag-empty">No notes here yet.</p>;
  const more = notes.length - limit;
  return (
    <>
      <ul className="kasten-tag-list" aria-label="Notes">
        {notes.slice(0, limit).map((note) => (
          <li key={note.path}>
            <button type="button" onClick={(e) => open(note.path, howFromView(e))} onAuxClick={(e) => e.button === 1 && open(note.path, "tab")}>
              <span aria-hidden="true" className="kasten-tag-icon">
                <IconOrEmoji icon={iconOf(note)} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {titleOf(note)} <ParentChip note={note} />
                </span>
                {note.excerpt && <span className="block truncate text-13 text-muted">{note.excerpt}</span>}
              </span>
              <Values note={note} defs={defs} />
            </button>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <button type="button" className="kasten-tag-more" onClick={() => setLimit(limit + LIST_PAGE)}>
          Show {Math.min(LIST_PAGE, more).toLocaleString()} more of {notes.length.toLocaleString()}
        </button>
      )}
    </>
  );
}
