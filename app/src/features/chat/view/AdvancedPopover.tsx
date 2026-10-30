// The thread's generation settings, in a popover beside the model: only the
// controls the model takes (capabilities.ts), so a ChatGPT plan model shows
// no temperature and a local server no reasoning. Each is optional; left
// empty, the provider's own default applies.

import { useEffect, useRef, useState } from "react";

import { Icon } from "../../../ui/Icon";
import { Segmented } from "../../../ui/Segmented";
import { Popup } from "../../pages/page/Popup";
import { allowed, anyControl, capabilitiesOf, type Allowed, type ModelCapabilities, type Range } from "../capabilities";
import { learnedEffort, savedSettings, type ModelChoice } from "../prefs";
import { describe, inRange, isSet, setting } from "../settings";
import { useChat } from "../store";
import type { ComposerThread } from "../thread";
import type { Effort, GenerationSettings } from "../types";

const EFFORT_LABELS: Record<Effort, string> = { minimal: "Minimal", low: "Low", medium: "Medium", high: "High" };

/** What the model of `provider` takes, once the backend has said. */
export function useCapabilities(provider: string, model: string): ModelCapabilities | null {
  const [caps, setCaps] = useState<ModelCapabilities | null>(null);
  useEffect(() => {
    let live = true;
    setCaps(null);
    void capabilitiesOf(useChat.getState().ensure(), provider, model).then((found) => live && setCaps(found));
    return () => {
      live = false;
    };
  }, [provider, model]);
  return caps;
}

/** The settings in force for a thread: its own, else the ones last used with its model. */
export const settingsOf = (thread: Pick<ComposerThread, "settings">, choice: ModelChoice): GenerationSettings => thread.settings ?? savedSettings(choice.provider, choice.model);

/** A number typed in, held to its range when the field is left or Enter is pressed. */
function NumberField({ label, value, range, whole, step, onCommit }: { label: string; value: number | undefined; range: Range; whole: boolean; step: number; onCommit: (value: number | undefined) => void }) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => {
    setText(value === undefined ? "" : String(value));
  }, [value]);
  const commit = () => {
    const held = inRange(text, range, whole);
    setText(held === undefined ? "" : String(held));
    if (held !== value) onCommit(held);
  };
  return (
    <label className="kasten-chat-setting">
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        aria-label={label}
        value={text}
        min={range.min}
        max={range.max}
        step={step}
        placeholder="Default"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          commit();
        }}
      />
    </label>
  );
}

function Controls({ controls, settings, change }: { controls: Allowed; settings: GenerationSettings; change: (next: GenerationSettings) => void }) {
  const { thinking } = controls;
  return (
    <>
      {controls.efforts.length > 0 && (
        <div className="kasten-chat-setting">
          <span>Reasoning effort</span>
          <Segmented
            radio
            label="Reasoning effort"
            value={settings.reasoningEffort ?? "default"}
            choices={[{ value: "default", label: "Default" }, ...controls.efforts.map((e) => ({ value: e, label: EFFORT_LABELS[e] }))]}
            onChange={(value) => change(setting(settings, "reasoningEffort", value === "default" ? undefined : (value as Effort)))}
          />
          {controls.effortTried && <small>Tried the first time you use it. If the model does not take it, the question is sent without, and this is remembered.</small>}
        </div>
      )}
      {thinking && (
        <>
          <label className="kasten-chat-setting kasten-chat-setting-check">
            <input type="checkbox" checked={settings.thinkingBudget !== undefined} onChange={(e) => change(setting(setting(settings, "thinkingBudget", e.target.checked ? thinking.default : undefined), "temperature", undefined))} />
            <span>Extended thinking</span>
          </label>
          {settings.thinkingBudget !== undefined && (
            <>
              <NumberField label="Thinking budget (tokens)" value={settings.thinkingBudget} range={thinking} whole step={256} onCommit={(v) => change(setting(settings, "thinkingBudget", v ?? thinking.default))} />
              <small>Claude takes no temperature while it thinks.</small>
            </>
          )}
        </>
      )}
      {controls.temperature && <NumberField label="Temperature" value={settings.temperature} range={controls.temperature} whole={false} step={0.1} onCommit={(v) => change(setting(settings, "temperature", v))} />}
      {controls.maxOutput && <NumberField label="Longest answer (tokens)" value={settings.maxOutputTokens} range={controls.maxOutput} whole step={256} onCommit={(v) => change(setting(settings, "maxOutputTokens", v))} />}
    </>
  );
}

export function AdvancedPopover({ thread, choice }: { thread: ComposerThread; choice: ModelChoice }) {
  const caps = useCapabilities(choice.provider, choice.model);
  // A turn that tried an effort may have found the model takes none: read it again.
  useChat((s) => s.learned);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const settings = settingsOf(thread, choice);
  const controls = allowed(caps, settings, learnedEffort(choice.provider, choice.model));
  if (!anyControl(controls)) return null;
  const summary = describe(settings);

  return (
    <>
      <button
        ref={button}
        type="button"
        className="kasten-chat-model-button kasten-chat-settings-button"
        aria-label="Generation settings"
        aria-expanded={open}
        title={summary ? `Generation settings: ${summary}` : "Generation settings"}
        data-set={isSet(settings) ? "" : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="sliders" className="size-3.5" />
      </button>
      {open && (
        <Popup label="Generation settings" anchor={button} onClose={() => setOpen(false)} className="kasten-chat-model-menu kasten-chat-settings">
          <p className="kasten-chat-setting-head">
            {choice.model}
            <small>Only what this model takes. Left empty, {choice.provider} decides.</small>
          </p>
          <Controls controls={controls} settings={settings} change={(next) => useChat.getState().setSettings(thread.id, next)} />
          {isSet(settings) && (
            <button type="button" className="kasten-chat-model-manage" onClick={() => useChat.getState().setSettings(thread.id, {})}>
              Use the defaults
            </button>
          )}
        </Popup>
      )}
    </>
  );
}
