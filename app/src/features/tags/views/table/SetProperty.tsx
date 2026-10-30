// "Set property" on the selection bar: pick a property, then its value. Choices
// (select, checkbox) are a list; the rest is typed and read by the property's
// type, the way a pasted cell is. A value that does not fit is said, and the
// box stays open to try again.

import { useState, type RefObject } from "react";

import type { PropDef } from "../../../../lib/vault/types";
import { Picker, type PickerOption } from "../../../library/Picker";
import { useWorkspace } from "../../../workspace/store";
import { parseCell } from "./paste-plan";

const CLEAR = "\u0000clear";
const TYPE_WORDS: Record<string, string> = { text: "text", number: "number", select: "choice", multi_select: "choices", date: "date", checkbox: "checkbox", url: "link" };

/** The properties a bar can set: not calculated ones, and not links between notes. */
export const settable = (properties: readonly PropDef[]) => properties.filter((p) => p.type !== "formula" && p.type !== "relation" && p.key !== "title");

const A_THING: Record<string, string> = { number: "a number", date: "a date such as 2026-10-02 or 2 Oct 2026", url: "a link starting with https://", checkbox: "yes or no" };

interface Props {
  properties: readonly PropDef[];
  within: RefObject<HTMLElement | null>;
  /** The value to store on every picked row (null clears it), and how to say it. */
  onSet(def: PropDef, value: unknown, said: string): void;
  onClose(): void;
}

export function SetProperty({ properties, within, onSet, onClose }: Props) {
  const [def, setDef] = useState<PropDef | null>(null);
  if (!def) {
    return (
      <Picker
        key="property"
        label="Set property"
        placeholder="Find a property…"
        options={properties.map((p) => ({ key: p.key, label: p.key, detail: TYPE_WORDS[p.type] ?? p.type }))}
        onPick={(key) => setDef(properties.find((p) => p.key === key) ?? null)}
        empty="This database has no property to set yet"
        within={within}
        onClose={onClose}
      />
    );
  }
  const clear: PickerOption = { key: CLEAR, label: `Clear ${def.key}`, detail: "empty" };
  const choices: PickerOption[] | null =
    def.type === "select" || def.type === "multi_select"
      ? def.options.map((o) => ({ key: o, label: o }))
      : def.type === "checkbox"
        ? [
            { key: "true", label: "Checked" },
            { key: "false", label: "Not checked" },
          ]
        : null;
  const typed = (text: string) => {
    const parsed = parseCell(def, text);
    if (parsed.value === undefined) {
      useWorkspace.getState().toast(`“${text.trim()}” is not ${A_THING[def.type] ?? "a value this property takes"}.`);
      return;
    }
    onSet(def, parsed.value, parsed.value === null ? "" : text.trim());
  };
  const pick = (key: string) => {
    if (key === CLEAR) return onSet(def, null, "");
    if (def.type === "checkbox") return onSet(def, key === "true", key === "true" ? "checked" : "not checked");
    onSet(def, def.type === "multi_select" ? [key] : key, key);
  };
  return (
    <Picker
      key="value"
      label={`Set ${def.key}`}
      placeholder={choices ? `Find a value for ${def.key}…` : `Type ${A_THING[def.type]?.split(" such")[0] ?? "a value"}, then Enter`}
      options={[...(choices ?? []), clear]}
      onPick={pick}
      create={choices ? undefined : { label: (text) => (text ? `Set to “${text}”` : null), run: typed }}
      empty="Nothing matches"
      within={within}
      onClose={onClose}
    />
  );
}
