// What a kanban card says about a note's properties: a small chip per value,
// in the schema's order. Dates read as words near today ("Tomorrow") and
// briefly otherwise, selects carry their option's colour, ticked boxes a ✓,
// and a deadline gone by on an unfinished card shows as late. Pure, tested.

import { daysBetween, longDay } from "../../../../lib/dates";
import type { NoteMeta, PropDef } from "../../../../lib/vault/types";
import { asDay } from "../../../calendar/dates";
import { formulaText } from "../../formula/rows";
import { optionSwatch, type Swatch } from "../../../panel/properties/schemas";
import { propOf } from "../../../panel/properties/values";

export type ChipKind = "select" | "date" | "check" | "number" | "formula" | "text" | "url" | "relation" | "more";

export interface CardChip {
  /** Unique on the card: the property's key, with the item's place for lists. */
  id: string;
  kind: ChipKind;
  text: string;
  /** The property and its whole value, for the tooltip. */
  title: string;
  /** An option's colour. */
  tone: Swatch | null;
  /** A deadline gone by on a card not yet done. */
  late?: boolean;
}

/** Chips a card shows before the rest fold into "+N". */
export const MAX_CHIPS = 6;
const TEXT_MAX = 32;
/** Date properties that say when something is due. */
const DEADLINE = /^(due|deadline|due[_ ]?date)$/i;

// One formatter each: making them per call is slow across a thousand cards.
const BRIEF = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const BRIEF_YEAR = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
const WORDS = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const NUMBER = new Intl.NumberFormat();

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const dateOf = (day: string) => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));

/** "Today", "Tomorrow", "Yesterday"; else "Oct 2", with the year when it is not `today`'s. */
export function dateText(day: string, today: string): string {
  const offset = daysBetween(today, day);
  if (Math.abs(offset) <= 1) return capital(WORDS.format(offset, "day"));
  return (day.slice(0, 4) === today.slice(0, 4) ? BRIEF : BRIEF_YEAR).format(dateOf(day));
}

/** Whether a note's status says it is finished (as the calendar reads it). */
const finished = (note: NoteMeta) => {
  const status = note.props.status;
  return (typeof status === "string" && /^(done|completed?|finished)$/i.test(status.trim())) || note.props.done === true;
};

const blank = (value: unknown) => value === null || value === undefined || (typeof value === "string" && !value.trim());
const short = (text: string) => (text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX).trimEnd()}…` : text);
const spelled = (value: string, def: PropDef) => def.options.find((o) => o.toLowerCase() === value.trim().toLowerCase()) ?? value.trim();

function host(value: string): string {
  try {
    return new URL(value).host.replace(/^www\./, "") || short(value);
  } catch {
    return short(value);
  }
}

/** The chips one property's value makes (several for a multi-select). */
function chipsOf(note: NoteMeta, def: PropDef, today: string): CardChip[] {
  const value = propOf(note.props, def.key);
  if (blank(value) || (Array.isArray(value) && value.every(blank))) return [];
  const one = (kind: ChipKind, text: string, whole = text, tone: Swatch | null = null): CardChip[] => [{ id: def.key, kind, text, title: `${def.key}: ${whole}`, tone }];
  switch (def.type) {
    case "select":
    case "multi_select": {
      const items = (Array.isArray(value) ? value : [value]).filter((v) => !blank(v)).map((v) => spelled(String(v), def));
      return items.map((text, i) => ({ id: `${def.key}#${i}`, kind: "select", text, title: `${def.key}: ${items.join(", ")}`, tone: optionSwatch(text, def.options) }));
    }
    case "date": {
      const day = asDay(value);
      if (!day) return [];
      const [chip] = one("date", dateText(day, today), longDay(day));
      return [{ ...chip!, late: DEADLINE.test(def.key) && day < today && !finished(note) }];
    }
    case "checkbox":
      return value === true || value === "true" ? one("check", `✓ ${def.key}`, "yes") : [];
    case "number":
      return one("number", `${def.key} ${typeof value === "number" ? NUMBER.format(value) : String(value)}`, String(value));
    case "formula": {
      const text = formulaText(value);
      return text ? one("formula", `${def.key} ${short(text)}`, `${text} (calculated)`) : [];
    }
    case "url":
      return one("url", host(String(value)), String(value));
    case "relation": {
      const count = Array.isArray(value) ? value.filter((v) => !blank(v)).length : 1;
      return one("relation", `↔ ${count}`, `${count} ${count === 1 ? "note" : "notes"}`);
    }
    default: {
      const text = Array.isArray(value) ? value.join(", ") : String(value);
      return one("text", short(text.trim()), text.trim());
    }
  }
}

/** A card's chips for `defs`: empty values skipped, the ones past
 * MAX_CHIPS folded into a "+N" whose tooltip lists them. */
export function cardChips(note: NoteMeta, defs: readonly PropDef[], today: string): CardChip[] {
  const all = defs.flatMap((def) => chipsOf(note, def, today));
  if (all.length <= MAX_CHIPS + 1) return all;
  const rest = all.slice(MAX_CHIPS);
  const titles = [...new Set(rest.map((chip) => chip.title))];
  return [...all.slice(0, MAX_CHIPS), { id: "more", kind: "more", text: `+${rest.length}`, title: titles.join("\n"), tone: null }];
}

/** A card's colour by the select `def` (the view's `color_by`), or null. */
export function tintOf(note: NoteMeta, def: PropDef | null): Swatch | null {
  if (!def) return null;
  const raw = propOf(note.props, def.key);
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.trim() ? optionSwatch(value.trim(), def.options) : null;
}
