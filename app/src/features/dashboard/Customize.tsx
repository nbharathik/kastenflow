// "Customize" on a dashboard: a small popover to turn sections on and off and
// put them in order (drag a row by its grip, or use the arrows), with the usual
// set a click away. `extra` adds actions at the foot, such as hiding a
// project's home.

import { useRef, useState, type ReactNode } from "react";

import { IconButton } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { Popup } from "../pages/page/Popup";
import { moved, sameList, shifted, toggled, type SectionDef } from "./sections";

interface CustomizeProps<Id extends string> {
  /** What is customized, e.g. "Project home". */
  label: string;
  defs: readonly SectionDef<Id>[];
  sections: readonly Id[];
  defaults: readonly Id[];
  onChange(next: Id[]): void;
  extra?: ReactNode;
  /** The words of the button that puts the usual set back. */
  resetLabel?: string;
}

export function Customize<Id extends string>({ label, defs, sections, defaults, onChange, extra, resetLabel = "Reset to the usual" }: CustomizeProps<Id>) {
  const [open, setOpen] = useState(false);
  // The row being dragged, and the one it is over.
  const [drag, setDrag] = useState<{ id: Id; over: Id | null } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  // Shown sections first, in their order, then the rest as defs has them.
  const rows = [...sections.map((id) => defs.find((d) => d.id === id)!).filter(Boolean), ...defs.filter((d) => !sections.includes(d.id))];
  return (
    <span className="relative inline-flex">
      <IconButton ref={button} icon="sliders" label={`Customize ${label.toLowerCase()}`} size="sm" active={open} onClick={() => setOpen((o) => !o)} />
      {open && (
        <Popup label={`Customize ${label.toLowerCase()}`} anchor={button} onClose={() => setOpen(false)} className="kasten-dash-customize">
          <p className="kasten-dash-customize-title">{label}: show and arrange</p>
          <ul>
            {rows.map((def) => {
              const on = sections.includes(def.id);
              const at = sections.indexOf(def.id);
              return (
                <li
                  key={def.id}
                  className={`${on ? "is-on" : ""}${drag?.over === def.id && drag.id !== def.id ? " is-over" : ""}`}
                  draggable={on}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", def.id);
                    setDrag({ id: def.id, over: null });
                  }}
                  onDragOver={(event) => {
                    if (!drag || !on) return;
                    event.preventDefault();
                    if (drag.over !== def.id) setDrag({ id: drag.id, over: def.id });
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (drag && on && drag.id !== def.id) onChange(moved(sections, drag.id, def.id));
                    setDrag(null);
                  }}
                  onDragEnd={() => setDrag(null)}
                >
                  <span className="kasten-dash-customize-grip" aria-hidden="true">
                    {on && <Icon name="grip" className="size-3.5" />}
                  </span>
                  <label title={def.hint}>
                    <input type="checkbox" checked={on} onChange={() => onChange(toggled(sections, def.id, defs))} />
                    <Icon name={def.icon} className="size-[15px] text-muted" />
                    <span className="min-w-0 flex-1 truncate text-13 font-medium">{def.label}</span>
                    {def.zone === "side" && (
                      <span aria-hidden="true" className="text-11 text-faint">
                        Side
                      </span>
                    )}
                  </label>
                  {on && (
                    <span className="kasten-dash-customize-move">
                      <IconButton icon="chevron-up" label={`Move ${def.label} up`} size="sm" disabled={at === 0} onClick={() => onChange(shifted(sections, def.id, -1))} />
                      <IconButton icon="chevron-down" label={`Move ${def.label} down`} size="sm" disabled={at === sections.length - 1} onClick={() => onChange(shifted(sections, def.id, 1))} />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="kasten-dash-customize-foot">
            <button type="button" className="ui-btn is-quiet is-sm" disabled={sameList(sections, defaults)} onClick={() => onChange([...defaults])}>
              {resetLabel}
            </button>
            {extra}
          </div>
        </Popup>
      )}
    </span>
  );
}
