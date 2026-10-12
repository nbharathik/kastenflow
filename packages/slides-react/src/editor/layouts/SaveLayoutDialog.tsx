import type { Element } from "@kasten-slides/wasm";
import { type JSX, useId, useState } from "react";

import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { useEditor } from "../useEditor.ts";
import type { DialogProps } from "../dialogs/types.ts";
import { saveSlideAsLayout } from "./ops.ts";
import { SLOT_KINDS, type SlotKind, kindOfRole, slotLabel } from "./slots.ts";
import "./layouts.css";

/** A line saying what an element is: its first words, or what kind of thing it is. */
function describe(element: Element): { icon: IconName; what: string } {
  const named = element.name?.trim();
  switch (element.type) {
    case "text":
    case "shape": {
      const words = element.text?.paragraphs.map((p) => p.runs.map((r) => r.t).join("")).find((line) => line.trim() !== "")?.trim();
      const fallback = element.placeholder ? `${slotLabel(kindOfRole(element.placeholder))} (empty)` : element.type === "text" ? "Empty text box" : `Shape (${element.shape})`;
      return { icon: element.type === "text" ? "type" : "shapes", what: named ?? (words ? (words.length > 36 ? `${words.slice(0, 35)}…` : words) : fallback) };
    }
    case "image":
      return { icon: "image", what: named ?? element.alt?.trim() ?? "Picture" };
    case "group":
      return { icon: "group", what: named ?? "Group" };
    case "line":
    case "connector":
      return { icon: "minus", what: named ?? "Line" };
    case "table":
      return { icon: "table", what: named ?? "Table" };
    default:
      return { icon: "square", what: named ?? element.type };
  }
}

/** The kinds an element can be a slot of: words fill any but a picture slot, and a picture only its own. */
function kindsFor(element: Element): readonly SlotKind[] {
  if (element.type === "text") return SLOT_KINDS.filter((choice) => choice.kind !== "picture").map((choice) => choice.kind);
  if (element.type === "image") return ["picture"];
  return [];
}

/** A name for the layout that no layout has: "My layout", then "My layout 2" ... */
function suggested(labels: readonly string[]): string {
  if (!labels.includes("My layout")) return "My layout";
  for (let n = 2; ; n++) if (!labels.includes(`My layout ${n}`)) return `My layout ${n}`;
}

/**
 * Saves the slide shown as a layout of its own: it is named, and each element says what it is to be: decoration that every slide of
 * the layout shows behind its own, or a slot (title, body, picture ...) that each slide fills in. The layout appears with the others in
 * the New slide menu and the Layout menu.
 */
export function SaveLayoutDialog({ session, onClose }: DialogProps): JSX.Element {
  const { deck } = useEditor(session);
  const slide = session.slide;
  const [label, setLabel] = useState(() => suggested(deck.theme.layouts.map((layout) => layout.label)));
  const [roles, setRoles] = useState<Record<string, SlotKind | "">>({});
  const [useForSlide, setUseForSlide] = useState(true);
  const [newSlideDefault, setNewSlideDefault] = useState(false);
  const nameId = useId();
  const ok = label.trim() !== "";

  const save = () => {
    if (!ok) return;
    const chosen = Object.fromEntries(Object.entries(roles).filter((entry): entry is [string, SlotKind] => entry[1] !== ""));
    const made = saveSlideAsLayout(session, { label, roles: chosen, useForSlide, newSlideDefault });
    if (made) {
      session.host.notify?.(`Saved the layout “${label.trim()}”. It is in the New slide menu.`);
      onClose();
    }
  };

  return (
    <Dialog
      title="Save slide as layout"
      width={520}
      onClose={onClose}
      footer={
        <>
          <TextButton onClick={onClose}>Cancel</TextButton>
          <TextButton primary disabled={!ok} onClick={save}>
            Save layout
          </TextButton>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label className="ks-ls-field" htmlFor={nameId}>
          Name
          <input id={nameId} className="ks-input" value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} data-autofocus="" />
        </label>
        <p className="ks-ls-hint">What is on this slide becomes part of the layout. Make something a slot when each new slide should fill it in with its own words or picture.</p>
        <ul className="ks-ls-list" aria-label="What is on the slide">
          {slide.elements.length === 0 ? <li className="ks-ls-hint">The slide is empty, so the layout will be too.</li> : null}
          {slide.elements.map((element) => {
            const { icon, what } = describe(element);
            const kinds = kindsFor(element);
            const own = element.placeholder ? slotLabel(kindOfRole(element.placeholder)) : null;
            return (
              <li key={element.id} className="ks-ls-row">
                <Icon name={icon} size={16} />
                <span className="ks-ls-what">{what}</span>
                {own ? (
                  <span className="ks-ls-fixed">{own} slot, as it is</span>
                ) : kinds.length === 0 ? (
                  <span className="ks-ls-fixed">Decoration</span>
                ) : (
                  <select className="ks-select" aria-label={`What “${what}” is`} value={roles[element.id] ?? ""} onChange={(event) => setRoles({ ...roles, [element.id]: event.target.value as SlotKind | "" })}>
                    <option value="">Decoration</option>
                    {SLOT_KINDS.filter((choice) => kinds.includes(choice.kind)).map((choice) => (
                      <option key={choice.kind} value={choice.kind}>
                        {choice.label} slot
                      </option>
                    ))}
                  </select>
                )}
              </li>
            );
          })}
        </ul>
        <div className="ks-ls-checks">
          <label className="ks-toggle">
            <input type="checkbox" checked={useForSlide} onChange={(event) => setUseForSlide(event.target.checked)} />
            <span>Put this slide on the new layout</span>
          </label>
          <label className="ks-toggle">
            <input type="checkbox" checked={newSlideDefault} onChange={(event) => setNewSlideDefault(event.target.checked)} />
            <span>Start new slides from it</span>
          </label>
        </div>
      </form>
    </Dialog>
  );
}
