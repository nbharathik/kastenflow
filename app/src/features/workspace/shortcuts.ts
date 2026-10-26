// App-wide shortcuts. Keys
// come from the person's keymap (features/shortcuts); the editor sees keys
// first, and anything it handled arrives here prevented.

import { useEffect } from "react";

import { useShell } from "../../lib/store";
import { bindingOf, isMac } from "../shortcuts/keymap";
import { useKeys } from "../shortcuts/store";
import { usePlugins } from "../../plugins/registry";
import { allCommands } from "./overlays/commands";
import { toggleFoldOfOpenPage } from "./page/properties-fold";
import { useWorkspace } from "./store";

function editable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA"));
}

/** What keys do that the palette's commands do not, or do differently. */
const KEY_ACTIONS: Record<string, () => void> = {
  palette: () => useShell.getState().setPalette(!useShell.getState().paletteOpen),
  shortcuts: () => useShell.getState().setShortcuts(!useShell.getState().shortcutsOpen),
  back: () => useWorkspace.getState().goBack(),
  forward: () => useWorkspace.getState().goForward(),
  "next-tab": () => useWorkspace.getState().cycleTab(1),
  "prev-tab": () => useWorkspace.getState().cycleTab(-1),
  "toggle-properties": toggleFoldOfOpenPage,
};

let commands: Map<string, () => void> | null = null;

// A plugin turned on or off adds or takes away its commands' keys.
usePlugins.subscribe((state, before) => {
  if (state.loaded !== before.loaded) commands = null;
});

/** What a command id runs. */
export function runFor(id: string): (() => void) | null {
  commands ??= new Map(allCommands().map((c) => [c.id, c.run]));
  return KEY_ACTIONS[id] ?? commands.get(id) ?? null;
}

/** The action for a key press, or null. Exported for tests. */
export function actionFor(event: KeyboardEvent): (() => void) | null {
  const shell = useShell.getState();
  if (event.key === "Escape" && shell.focusMode && !editable(event.target)) return shell.toggleFocus;
  const mac = isMac();
  const binding = bindingOf(event, mac);
  if (!binding) return null;
  const { lookup } = useKeys.getState();
  // On macOS Ctrl works as Cmd too, unless a command has that Ctrl key.
  const id = lookup.get(binding) ?? (mac && binding.startsWith("Ctrl+") ? lookup.get(`Mod+${binding.slice(5)}`) : undefined);
  if (!id) return null;
  // An open dialog keeps keys to itself; the key that opened the palette or
  // the shortcut sheet still closes it.
  if (document.querySelector('[aria-modal="true"]') && !((id === "palette" && shell.paletteOpen) || (id === "shortcuts" && shell.shortcutsOpen))) return null;
  // On macOS Option types characters and Option+arrow moves by word.
  if (mac && editable(event.target) && /^(?:Alt|Shift)/.test(binding)) return null;
  return runFor(id);
}

export function useGlobalShortcuts(): void {
  useEffect(() => {
    // A key pressed while the vault is still opening (Ctrl+N the moment the
    // window appears) runs once it is open, rather than finding no vault.
    let held: (() => void) | null = null;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const action = actionFor(event);
      if (!action) return;
      event.preventDefault();
      if (useWorkspace.getState().ready) action();
      else held = action;
    };
    const stop = useWorkspace.subscribe((state) => {
      if (!state.ready || !held) return;
      const action = held;
      held = null;
      action();
    });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      stop();
    };
  }, []);
}
