// Settings → Keyboard shortcuts: every command with its keys. Click a key to
// record another; Backspace removes it and Escape cancels. A key another
// command had moves here, and the row says which.

import { useMemo, useState, type KeyboardEvent } from "react";

import { useShell } from "../../lib/store";
import { Button, IconButton } from "../../ui/Button";
import { commandHits, commandRowId } from "../workspace/views/settings/command-search";
import { rowDomId } from "../workspace/views/settings/index";
import { Block, Group, Row } from "../workspace/views/settings/parts";
import { useSettingsView } from "../workspace/views/settings/view";
import { KEY_SECTIONS, commandLabel } from "./catalog";
import { CommandHits } from "./CommandHits";
import { bindingOf, canBind, formatBinding, isMac } from "./keymap";
import { keyLabel, useKeys } from "./store";

export function ShortcutSettings() {
  const keymap = useKeys((s) => s.keymap);
  const overrides = useKeys((s) => s.overrides);
  const [recording, setRecording] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; text: string } | null>(null);
  const [filter, setFilter] = useState("");
  // While Settings is searched, the commands whose names the words find are lines that open their row.
  const view = useSettingsView();
  const hits = useMemo(() => (view.matching === null ? [] : commandHits(view.words)), [view.matching, view.words]);

  const sections = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const shown = (id: string) => !q || commandLabel(id).toLowerCase().includes(q) || keyLabel(keymap, id).toLowerCase().includes(q);
    return KEY_SECTIONS.map((s) => ({ ...s, ids: s.ids.filter(shown) })).filter((s) => s.ids.length > 0);
  }, [filter, keymap]);

  const changed = Object.keys(overrides).length;
  const sheetKey = keyLabel(keymap, "shortcuts");
  return (
    <Group title="Keyboard shortcuts" found={hits.length > 0}>
      <Row id="shortcuts.sheet" detail={sheetKey ? `Also ${sheetKey}` : undefined}>
        <Button size="sm" icon="keyboard" onClick={() => useShell.getState().setShortcuts(true)}>
          Show
        </Button>
      </Row>
      {hits.length > 0 && <CommandHits ids={hits} />}
      <Block id="shortcuts.editor" titled>
        <div className="kasten-set-filter">
          <input
            type="search"
            aria-label="Find a command"
            placeholder="Find a command or key"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="ui-field kasten-set-find"
          />
          {changed > 0 && (
            <Button
              size="sm"
              icon="undo"
              onClick={() => {
                useKeys.getState().resetAll();
                setNote(null);
              }}
            >
              Reset all ({changed})
            </Button>
          )}
        </div>
        {sections.map((section) => (
          <div key={section.title} role="group" aria-label={section.title}>
            <div className="kasten-set-keys-title">{section.title}</div>
            {section.ids.map((id) => (
              <KeyRow
                key={id}
                id={id}
                keys={keymap[id] ?? []}
                changed={id in overrides}
                recording={recording === id}
                note={note?.id === id ? note.text : null}
                onRecord={(on) => {
                  setRecording(on ? id : null);
                  if (on) setNote(null);
                }}
                onNote={(text) => setNote(text ? { id, text } : null)}
              />
            ))}
          </div>
        ))}
        {sections.length === 0 && <p className="kasten-set-quiet">No command matches “{filter.trim()}”.</p>}
      </Block>
    </Group>
  );
}

interface KeyRowProps {
  id: string;
  keys: readonly string[];
  changed: boolean;
  recording: boolean;
  note: string | null;
  onRecord(on: boolean): void;
  onNote(text: string | null): void;
}

function KeyRow({ id, keys, changed, recording, note, onRecord, onNote }: KeyRowProps) {
  const mac = isMac();
  const label = commandLabel(id);
  // A search can open the editor at this command's row, and the row is marked for a moment.
  const row = commandRowId(id);
  const flash = useSettingsView().flash === row;
  const record = (event: KeyboardEvent<HTMLButtonElement>) => {
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    // Tab still moves on, which ends recording.
    if (plain && event.key === "Tab") return;
    event.preventDefault();
    event.stopPropagation();
    if (plain && event.key === "Escape") return onRecord(false);
    if (plain && (event.key === "Backspace" || event.key === "Delete")) {
      useKeys.getState().set(id, null);
      return onRecord(false);
    }
    const binding = bindingOf(event.nativeEvent, mac);
    if (!binding) return;
    if (!canBind(binding)) return onNote(`${formatBinding(binding, mac)} would run while typing; add ${mac ? "⌘, ⌃ or ⌥" : "Ctrl or Alt"}`);
    const took = useKeys.getState().set(id, binding);
    onRecord(false);
    onNote(took.length ? `Taken from ${took.map(commandLabel).join(", ")}` : null);
  };
  return (
    <div id={rowDomId(row)} className={`kasten-set-key${flash ? " is-flash" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-13">{label}</div>
        {note && (
          <div role="status" className="text-12 text-muted">
            {note}
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label={`Change the key for ${label}`}
        aria-pressed={recording}
        ref={(el) => {
          if (recording) el?.focus();
        }}
        onClick={() => onRecord(!recording)}
        onKeyDown={recording ? record : undefined}
        onBlur={() => recording && onRecord(false)}
        className={`flex min-h-7 min-w-[92px] flex-wrap items-center justify-end gap-1 rounded-md px-1.5 py-0.5 text-12 transition-colors ${recording ? "bg-soft text-accent ring-1 ring-accent/60" : "hover:bg-hover"}`}
      >
        {recording ? (
          "Press keys…"
        ) : keys.length ? (
          keys.map((k) => (
            <kbd key={k} className="ui-kbd">
              {formatBinding(k, mac)}
            </kbd>
          ))
        ) : (
          <span className="text-muted">Add key</span>
        )}
      </button>
      <span className="flex w-14 justify-end gap-0.5">
        {keys.length > 0 && !recording && <IconButton icon="close" label={`Remove the key for ${label}`} title="Remove" size="sm" onClick={() => useKeys.getState().set(id, null)} />}
        {changed && !recording && (
          <IconButton
            icon="undo"
            label={`Reset ${label}`}
            title="Back to the default"
            size="sm"
            onClick={() => {
              const took = useKeys.getState().set(id, undefined);
              onNote(took.length ? `Taken from ${took.map(commandLabel).join(", ")}` : null);
            }}
          />
        )}
      </span>
    </div>
  );
}
