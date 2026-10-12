import { type JSX, Fragment, useMemo, useState } from "react";

import { BIG_NUDGE, NUDGE } from "../canvas/nudge.ts";
import { COMMANDS, showCombo } from "../commands/index.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import type { DialogProps } from "./types.ts";
import "./dialogs.css";

/** What each family of commands is called, by the start of the ids. Ids from a family not listed here are named after it. */
const AREAS: [prefix: string, name: string][] = [
  ["edit", "Edit"],
  ["text", "Text"],
  ["slide", "Slides"],
  ["steps", "Steps"],
  ["arrange", "Arrange"],
  ["view", "View"],
  ["embed", "Embedded page"],
  ["file", "File"],
  ["insert", "Insert"],
  ["help", "Help"],
];

const areaOf = (id: string): string => {
  const prefix = id.split(".")[0] ?? id;
  return AREAS.find(([known]) => known === prefix)?.[1] ?? prefix.charAt(0).toUpperCase() + prefix.slice(1);
};

/** Every command that has keys, in groups by area. */
export function shortcutGroups(): { area: string; rows: { id: string; label: string; combos: string[] }[] }[] {
  const groups = new Map<string, { id: string; label: string; combos: string[] }[]>();
  for (const command of COMMANDS.values()) {
    if (!command.keys?.length) continue;
    const area = areaOf(command.id);
    groups.set(area, [...(groups.get(area) ?? []), { id: command.id, label: command.label, combos: command.keys.map((combo) => showCombo(combo)) }]);
  }
  const order = AREAS.map(([, name]) => name);
  return [...groups]
    .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    .map(([area, rows]) => ({ area, rows }));
}

/** The keys, by area, with a box to narrow them by name. */
export function ShortcutsDialog({ onClose }: DialogProps): JSX.Element {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => shortcutGroups(), []);
  const wanted = query.trim().toLowerCase();
  const shown = groups.map((group) => ({ ...group, rows: group.rows.filter((row) => row.label.toLowerCase().includes(wanted)) })).filter((group) => group.rows.length > 0);
  return (
    <Dialog title="Keyboard shortcuts" width={560} onClose={onClose} footer={<TextButton onClick={onClose}>Close</TextButton>}>
      <input className="ks-input" type="search" aria-label="Search shortcuts" placeholder="Search shortcuts" data-autofocus="" value={query} onChange={(event) => setQuery(event.target.value)} />
      <p className="ks-dg-note">{`Drag the move handle to move a block; arrow keys nudge by ${NUDGE}, Shift+arrow by ${BIG_NUDGE}`}</p>
      <div className="ks-dg-keys">
        {shown.length === 0 ? <p className="ks-dg-note">No shortcut has that name.</p> : null}
        {shown.map((group) => (
          <section key={group.area} className="ks-dg-keys-group" aria-label={group.area}>
            <h3 className="ks-dg-keys-area">{group.area}</h3>
            <ul>
              {group.rows.map((row) => (
                <li key={row.id}>
                  <span className="ks-dg-keys-label">{row.label}</span>
                  <span className="ks-dg-keys-combos">
                    {row.combos.map((combo, i) => (
                      <Fragment key={combo}>
                        {i > 0 ? <span className="ks-dg-or">or</span> : null}
                        <kbd className="ks-kbd ks-dg-kbd">{combo}</kbd>
                      </Fragment>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
