// Every command the editor has, and the keys that run them. Menus, the
// toolbar, context menus and the shortcut handler all read this one list, so
// a command is named, enabled and bound in one place.

import { agentCommands } from "./agent.ts";
import { arrangeCommands } from "./arrange.ts";
import { chromeCommands } from "./chrome.ts";
import { compositesCommands } from "./composites.ts";
import { diagramCommands } from "./diagram.ts";
import { editCommands } from "./edit.ts";
import { embedCommands } from "./embed.ts";
import { fileCommands } from "./file.ts";
import { formatCommands } from "./format.ts";
import { importingCommands } from "./importing.ts";
import { insertCommands } from "./insert.ts";
import { comboOf, showCombo } from "./keys.ts";
import { layoutCommands } from "./layouts.ts";
import { lintCommands } from "./lint.ts";
import { pageCommands } from "./pages.ts";
import { paintCommands } from "./paint.ts";
import { presentCommands } from "./present.ts";
import { slideCommands } from "./slides.ts";
import { stepsCommands } from "./steps.ts";
import { tableCommands } from "./table.ts";
import { textFormatCommands } from "./text-format.ts";
import type { Command, CommandContext, Commands, KeyScope } from "./types.ts";
import { viewCommands } from "./view.ts";

export type { Command, CommandContext, Commands, KeyScope } from "./types.ts";
export { comboOf, showCombo } from "./keys.ts";
export * as textFormat from "./format.ts";
export * as textExtras from "./text-format.ts";
export { insertImageFiles } from "./insert.ts";

const ALL: Command[] = [
  ...editCommands,
  ...slideCommands,
  ...arrangeCommands,
  ...formatCommands,
  ...textFormatCommands,
  ...paintCommands,
  ...tableCommands,
  // Before the view's zoom: the same keys zoom the page of a selected embed, and the slide when none is selected.
  ...embedCommands,
  ...viewCommands,
  ...fileCommands,
  ...insertCommands,
  // Each of these is one file, so the work that fills one does not touch another.
  ...chromeCommands,
  ...compositesCommands,
  ...diagramCommands,
  ...pageCommands,
  ...stepsCommands,
  ...presentCommands,
  ...importingCommands,
  ...layoutCommands,
  ...lintCommands,
  ...agentCommands,
];

export const COMMANDS: Commands = new Map(ALL.map((command) => [command.id, command]));

/** A command by id; a menu or button that names one that does not exist is a bug, so this throws. */
export function commandOf(id: string): Command {
  const command = COMMANDS.get(id);
  if (!command) throw new Error(`No editor command called ${id}`);
  return command;
}

export function isEnabled(command: Command, context: CommandContext): boolean {
  return command.enabled ? command.enabled(context.session.state, context.ui.state, context.session.host, context) : true;
}

/** Runs the command called `id` if it can be done now. */
export async function runCommand(id: string, context: CommandContext): Promise<void> {
  const command = commandOf(id);
  if (isEnabled(command, context)) await command.run(context);
}

/** How the keys for a command read on this system, or undefined when it has none. */
export function keysOf(id: string): string | undefined {
  const first = commandOf(id).keys?.[0];
  return first ? showCombo(first) : undefined;
}

let bound: Map<string, Command[]> | null = null;

function bindings(): Map<string, Command[]> {
  if (!bound) {
    bound = new Map();
    for (const command of ALL) {
      for (const combo of command.keys ?? []) bound.set(combo, [...(bound.get(combo) ?? []), command]);
    }
  }
  return bound;
}

/**
 * Where the key was pressed: on the slide itself (`stage`), anywhere else in the editor that took no key of its own
 * (`canvas`: a toolbar button, a panel), in the filmstrip, in a text box being edited, or in a field (the notes, a name).
 */
export type KeyArea = "stage" | "canvas" | "filmstrip" | "text" | "field";

/**
 * Runs the command a key press stands for, if there is one that applies where
 * it was pressed. Resolves to whether the key was used. In a text box only the
 * commands with a modifier key run, since the rest are typing; in a field only
 * the ones that say they work there (`inFields`), so undo and select all stay the field's own.
 */
export function dispatchKey(event: KeyboardEvent, context: CommandContext, area: KeyArea): boolean {
  const combo = comboOf(event);
  const candidates = bindings().get(combo) ?? [];
  const usable = candidates.filter((command) => {
    const scope: KeyScope = command.scope ?? "global";
    if (area === "field") return command.inFields === true && /^(Mod|Ctrl)\+/.test(combo);
    if (area === "text") return scope === "global" && /^(Mod|Ctrl)\+/.test(combo);
    return scope === "global" || scope === area || (area === "stage" && scope === "canvas");
  });
  const command = usable.find((candidate) => isEnabled(candidate, context));
  if (!command) return false;
  // The browser's own keys (copy, cut, paste) are not taken: the event it makes of them is what runs the command.
  if (command.native) {
    if (typeof command.native === "function") command.native();
    return false;
  }
  event.preventDefault();
  // A key held down adds nothing more than once.
  if (event.repeat && command.byKey) return true;
  void (command.byKey ? command.byKey(context) : command.run(context));
  return true;
}
