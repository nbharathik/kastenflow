// Settings → AI → Chat panel: whether selected text is added to the chat by
// itself, what happens to the chat when you switch pages, how many chats the
// list keeps and how many may work at once. The first two are this window's
// (browser storage); the last two are the backend's (chat_limits), which
// refuses a number out of range with a sentence.

import { useEffect, useState } from "react";

import { CHAT_LIMIT_RANGES, DEFAULT_CHAT_LIMITS, type ChatLimits } from "../../../chat/agent-types";
import { PANEL_DEFAULTS, usePanelPrefs, type AssistantLinks, type OnSwitch, type SelectedText } from "../../../chat/panel-prefs";
import { useChat } from "../../../chat/store";
import { useWorkspace } from "../../store";
import { Group, resetOf, Row } from "./parts";

const SELECTED: { id: SelectedText; label: string }[] = [
  { id: "auto", label: "Add automatically" },
  { id: "manual", label: "Only with “Add to chat”" },
  { id: "never", label: "Never" },
];

const SWITCH: { id: OnSwitch; label: string }[] = [
  { id: "keep", label: "Keep this chat and follow the page" },
  { id: "bound", label: "Use that page’s chat" },
  { id: "new", label: "Start a new chat" },
];

const LINKS: { id: AssistantLinks; label: string }[] = [
  { id: "beside", label: "Beside the deck" },
  { id: "tab", label: "In a new tab" },
  { id: "here", label: "In the deck’s tab" },
];

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

type Key = keyof ChatLimits;

const LIMIT_ROWS: { key: Key; id: string; unit: string; label: string }[] = [
  { key: "listSize", id: "ai.listSize", unit: "chats", label: "Chats in the list" },
  { key: "maxConcurrent", id: "ai.maxConcurrent", unit: "at once", label: "Agents working at once" },
];

export function ChatPanelSettings() {
  const prefs = usePanelPrefs();
  const toast = useWorkspace((s) => s.toast);
  const [limits, setLimits] = useState<ChatLimits | null>(null);

  useEffect(() => {
    let live = true;
    useChat
      .getState()
      .ensure()
      .limits()
      .then(
        (found) => live && setLimits(found),
        () => {},
      );
    return () => {
      live = false;
    };
  }, []);

  const save = async (key: Key, typed: number) => {
    if (!limits || !Number.isFinite(typed)) return;
    const { min, max } = CHAT_LIMIT_RANGES[key];
    const value = Math.min(max, Math.max(min, Math.round(typed)));
    if (value === limits[key]) return;
    try {
      const next = await useChat.getState().ensure().setLimits({ ...limits, [key]: value });
      setLimits(next);
      toast("Saved");
    } catch (err) {
      toast(message(err));
    }
  };

  return (
    <Group title="Chat panel" sub>
      <Row id="ai.selectedText" {...resetOf(prefs.selectedText, PANEL_DEFAULTS.selectedText, (selectedText) => prefs.set({ selectedText }))}>
        <select aria-label="Selected text" value={prefs.selectedText} onChange={(event) => prefs.set({ selectedText: event.target.value as SelectedText })} className="ui-field kasten-set-select">
          {SELECTED.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </Row>
      <Row id="ai.onSwitch" {...resetOf(prefs.onSwitch, PANEL_DEFAULTS.onSwitch, (onSwitch) => prefs.set({ onSwitch }))}>
        <select aria-label="When I switch pages" value={prefs.onSwitch} onChange={(event) => prefs.set({ onSwitch: event.target.value as OnSwitch })} className="ui-field kasten-set-select">
          {SWITCH.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </Row>
      <Row id="ai.assistantLinks" {...resetOf(prefs.assistantLinks, PANEL_DEFAULTS.assistantLinks, (assistantLinks) => prefs.set({ assistantLinks }))}>
        <select aria-label="Links from the assistant open" value={prefs.assistantLinks} onChange={(event) => prefs.set({ assistantLinks: event.target.value as AssistantLinks })} className="ui-field kasten-set-select">
          {LINKS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </Row>
      {LIMIT_ROWS.map(({ key, id, unit, label }) => {
        const shown = limits?.[key] ?? DEFAULT_CHAT_LIMITS[key];
        return (
          <Row
            key={key}
            id={id}
            {...(key === "maxConcurrent" ? { detail: "A chat that has to wait says “Waiting for another chat to finish”." } : {})}
            {...(limits ? resetOf(shown, DEFAULT_CHAT_LIMITS[key], (usual) => void save(key, usual)) : {})}
          >
            <label className="flex items-center gap-1.5 text-13 text-muted">
              <input
                // Drawn again once the saved value is read, or after a reset.
                key={`${limits ? "read" : "reading"}:${shown}`}
                type="number"
                min={CHAT_LIMIT_RANGES[key].min}
                max={CHAT_LIMIT_RANGES[key].max}
                disabled={!limits}
                aria-label={label}
                defaultValue={shown}
                className="ui-field kasten-set-number"
                onBlur={(event) => {
                  // An empty box keeps what was there.
                  if (event.currentTarget.value.trim() === "") event.currentTarget.value = String(shown);
                  else void save(key, Number(event.currentTarget.value));
                }}
                onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
              />
              {unit}
            </label>
          </Row>
        );
      })}
    </Group>
  );
}
