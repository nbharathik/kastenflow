// Shortcut commands in the settings search: "present" finds "Present this page"
// in the Keyboard shortcuts group, with a line that opens the key editor at that
// command's row. The commands are the ones the editor lists (KEY_SECTIONS).

import { KEY_SECTIONS, commandLabel } from "../../../shortcuts/catalog";
import type { Found } from "./index";
import { hasWords } from "./search";

/** The prefix of a command's row id (`shortcuts.key.<command>`), as an entry id names a setting's row. */
const ROW = "shortcuts.key.";

/** The row id of a command in the key editor. */
export const commandRowId = (command: string): string => `${ROW}${command}`;

/** The command a row id names, or null when it names something else. */
export function commandOfRow(row: string): string | null {
  return row.startsWith(ROW) && row.length > ROW.length ? row.slice(ROW.length) : null;
}

/** The commands whose names every word finds, in the order the key editor lists them. */
export function commandHits(words: readonly string[]): string[] {
  if (words.length === 0) return [];
  const seen = new Set<string>();
  const hits: string[] = [];
  for (const section of KEY_SECTIONS) {
    for (const id of section.ids) {
      if (seen.has(id) || !hasWords(words, commandLabel(id))) continue;
      seen.add(id);
      hits.push(id);
    }
  }
  return hits;
}

/** What the settings search found, with the commands the words also find. The Keyboard shortcuts
 * group counts them and the answer lists them; the settings found are left as they were. */
export function withCommands(found: Found, words: readonly string[]): Found {
  const commands = commandHits(words);
  if (commands.length === 0) return found;
  const byGroup = new Map(found.byGroup);
  byGroup.set("shortcuts", (byGroup.get("shortcuts") ?? 0) + commands.length);
  return { ids: found.ids, byGroup, total: found.total + commands.length, commands };
}
