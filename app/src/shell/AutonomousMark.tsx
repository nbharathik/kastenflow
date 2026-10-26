import "./auto-mark.css";

import { useEffect, useId, useRef, useState } from "react";

import { autonomousOn, scopeWords, untilWords } from "../features/agents/policy";
import { useAgentMode } from "../features/agents/store";
import { openSettingsAt } from "../features/workspace/views/settings/jump";
import { useWorkspace } from "../features/workspace/store";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";

/** A project's folder name as words. */
const titleOf = (folder: string) => folder.replace(/[-_]+/g, " ");

/** How often the clock is looked at, so a time box that ends takes the mark away. */
const TICK_MS = 30_000;

/** The sentence for where, with a capital: "All your notes", "note taking, thesis". */
const capital = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

/** A small mark in the top bar while any scope is autonomous, and nothing
 * otherwise. Hovering it, focusing it or clicking it opens what is on: where,
 * until when, a button that turns it off and a way to the settings. The core
 * says what holds; this reads it when the vault opens and when the window
 * comes back, and watches the clock for the time box. */
export function AutonomousMark() {
  const client = useWorkspace((s) => s.client);
  const view = useAgentMode((s) => s.view);
  const [now, setNow] = useState(() => Date.now());
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    void useAgentMode.getState().load();
  }, [client]);

  useEffect(() => {
    const look = () => {
      setNow(Date.now());
      void useAgentMode.getState().load();
    };
    window.addEventListener("focus", look);
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      window.removeEventListener("focus", look);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!pinned) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setPinned(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [pinned]);

  if (!view || !autonomousOn(view, now)) return null;
  const open = pinned || hover || focus;
  const close = () => {
    setPinned(false);
    setHover(false);
    setFocus(false);
  };

  return (
    <span
      ref={box}
      className="kasten-auto"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(event) => {
        if (!box.current?.contains(event.relatedTarget as Node | null)) setFocus(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        close();
      }}
    >
      <button type="button" className="ui-icon-btn kasten-auto-button" aria-label="Autonomous agents are on" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setPinned((was) => !was)}>
        <Icon name="agent" />
        <span className="kasten-auto-dot" aria-hidden="true" />
      </button>
      {open && (
        <div id={id} role="group" aria-label="Autonomous agents" className="kasten-auto-pop">
          <p className="kasten-auto-title">Autonomous agents are on</p>
          <dl className="kasten-auto-facts">
            <dt>Where</dt>
            <dd>{capital(scopeWords(view, titleOf))}</dd>
            <dt>For</dt>
            <dd>{capital(untilWords(view.until, now))}</dd>
          </dl>
          <div className="kasten-auto-actions">
            <Button size="sm" onClick={() => void useAgentMode.getState().turnOff()}>
              Turn off
            </Button>
            <button
              type="button"
              className="kasten-auto-link"
              onClick={() => {
                close();
                openSettingsAt({ group: "agents", row: "agents.mode" });
              }}
            >
              Agent settings
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
