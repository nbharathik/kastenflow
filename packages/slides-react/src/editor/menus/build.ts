// Building menu rows from the command list. A row is the command's label,
// icon and keys, disabled when the command cannot be done now, checked when
// the command is on, and running it runs the command. Menus, dropdowns and
// context menus all read the same commands through here.

import type { ReactNode } from "react";

import { type CommandContext, commandOf, isEnabled, keysOf, runCommand } from "../commands/index.ts";
import type { IconName } from "../ui/Icon.tsx";
import type { MenuItem } from "../ui/Menu.tsx";

/** A menu row that can be clicked, as opposed to a separator or a heading. */
export type Row = Extract<MenuItem, { id: string }>;

export const SEPARATOR: MenuItem = { kind: "separator" };

/** What a menu changes about a command's own row. */
export interface Tweak {
  label?: string;
  /** `null` draws no icon. */
  icon?: IconName | null;
  /** `null` shows no keys. */
  keys?: string | null;
  /** Disabled even where the command itself could be done. */
  disabledIf?: boolean;
  /** Replaces the command's own check mark; `null` draws none. */
  checked?: boolean | null;
  trailing?: ReactNode;
  /** A line under the label that says what the row makes. */
  description?: string;
  /** Does this instead of running the command. */
  run?: () => void;
}

/** A row that runs the command called `id`. */
export function commandItem(id: string, ctx: CommandContext, tweak: Tweak = {}): Row {
  const command = commandOf(id);
  const icon = tweak.icon === undefined ? command.icon : (tweak.icon ?? undefined);
  const keys = tweak.keys === undefined ? keysOf(id) : (tweak.keys ?? undefined);
  const checked = tweak.checked === undefined ? command.checked?.(ctx.session.state, ctx.ui.state) : (tweak.checked ?? undefined);
  return {
    id,
    label: tweak.label ?? command.label,
    ...(icon ? { icon } : {}),
    ...(keys ? { keys } : {}),
    ...(checked === undefined ? {} : { checked }),
    ...(tweak.trailing ? { trailing: tweak.trailing } : {}),
    ...(tweak.description ? { description: tweak.description } : {}),
    disabled: !isEnabled(command, ctx) || Boolean(tweak.disabledIf),
    run: tweak.run ?? (() => void runCommand(id, ctx)),
  };
}

/** A row of a menu that is not a command: a zoom level, a line spacing. */
export function plainItem(id: string, label: string, run: () => void, extra: Partial<Omit<Row, "id" | "label" | "run">> = {}): Row {
  return { id, label, run, ...extra };
}

/** A row that opens a sub-menu; it is disabled when nothing in it can be done. */
export function submenu(id: string, label: string, items: MenuItem[], icon?: IconName): Row {
  const rows = items.filter((item): item is Row => item.kind === undefined || item.kind === "item");
  return { id, label, ...(icon ? { icon } : {}), items, disabled: rows.length > 0 && rows.every((row) => row.disabled) };
}

/** The lists joined with a separator between each, leaving out the ones with nothing in them. */
export function groups(...lists: (MenuItem[] | false | null | undefined)[]): MenuItem[] {
  const filled = lists.filter((list): list is MenuItem[] => Array.isArray(list) && list.length > 0);
  return filled.flatMap((list, i) => (i === 0 ? list : [SEPARATOR, ...list]));
}
