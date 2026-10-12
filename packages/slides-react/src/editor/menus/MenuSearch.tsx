import { type JSX, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import { chromeOf, useChromeValue } from "../chrome/chrome.ts";
import { type CommandContext, keysOf } from "../commands/index.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { Icon } from "../ui/Icon.tsx";
import { Popover } from "../ui/Popover.tsx";
import { barMenus } from "./bar-menus.ts";
import { swallowKeys } from "./focus.ts";
import { type MenuHit, flattenMenus, placeOf, searchMenus } from "./search.ts";
import { useDropdown } from "./useDropdown.ts";
import "./menus.css";

/**
 * "Menus": a box that finds any row of any menu by its name, as Google Slides' does, and runs it. Alt+/ opens it from anywhere (the
 * `view.menu-search` command asks the chrome, and the button here answers); Up and Down choose, Enter runs, Escape puts the focus back.
 */
export function MenuSearch({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element {
  const dd = useDropdown("dialog");
  const asked = useChromeValue(ui, (state) => state.menuSearch);
  const button = useRef<HTMLButtonElement | null>(null);
  const ctx = useMemo<CommandContext>(() => ({ session, ui }), [session, ui]);
  const keys = keysOf("view.menu-search");

  // The command is a request: the box opens, and the request is answered.
  useEffect(() => {
    if (!asked) return;
    chromeOf(ui).openMenuSearch(false);
    if (button.current && !dd.anchor) dd.openFrom(button.current);
  }, [asked, ui, dd]);

  return (
    <>
      <button
        type="button"
        className="ks-btn ks-menu-search"
        aria-label="Search the menus"
        data-tip={keys ? `Search the menus (${keys})` : "Search the menus"}
        data-ks-keep-focus=""
        onMouseDown={(event) => event.preventDefault()}
        {...dd.trigger}
        ref={(node) => {
          button.current = node;
          dd.trigger.ref.current = node;
        }}
      >
        <Icon name="search" size={14} />
        <span>Menus</span>
      </button>
      {dd.anchor ? (
        <Popover anchor={dd.anchor} onClose={dd.close} label="Search the menus">
          <div className="ks-menu-find" data-ks-keep-focus="" onKeyDown={swallowKeys}>
            <FindPanel ctx={ctx} onDone={dd.close} />
          </div>
        </Popover>
      ) : null}
    </>
  );
}

function FindPanel({ ctx, onDone }: { ctx: CommandContext; onDone(): void }): JSX.Element {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // Every row of every menu as it is when the box opens: what is on or off now is what is shown.
  const all = useMemo(() => flattenMenus(barMenus(ctx)), [ctx]);
  const found = searchMenus(all, query);
  const at = Math.min(active, Math.max(found.length - 1, 0));
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>("[data-active]")?.scrollIntoView?.({ block: "nearest" });
  }, [at, query]);

  const run = (hit: MenuHit | undefined) => {
    if (!hit || hit.disabled) return;
    onDone();
    hit.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = found.length - 1;
    if (event.key === "ArrowDown") setActive(at >= last ? 0 : at + 1);
    else if (event.key === "ArrowUp") setActive(at <= 0 ? last : at - 1);
    else if (event.key === "Enter") run(found[at]);
    else return;
    event.preventDefault();
  };

  return (
    <>
      <div className="ks-menu-find-field">
        <Icon name="search" size={14} />
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-label="Search the menus"
          aria-expanded="true"
          aria-controls="ks-menu-hits"
          aria-activedescendant={found[at] ? `ks-menu-hit-${at}` : undefined}
          placeholder="Search the menus"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div ref={list} id="ks-menu-hits" className="ks-menu-hits" role="listbox" aria-label="Matching menu items">
        {found.map((hit, i) => (
          <div
            key={`${placeOf(hit)}-${hit.label}-${i}`}
            id={`ks-menu-hit-${i}`}
            role="option"
            aria-selected={i === at}
            aria-disabled={hit.disabled || undefined}
            data-active={i === at ? "" : undefined}
            className={`ks-menu-hit${i === at ? " is-active" : ""}${hit.disabled ? " is-disabled" : ""}`}
            onMouseMove={() => active !== i && setActive(i)}
            onClick={() => run(hit)}
          >
            <span className="ks-menu-mark">{hit.checked ? <Icon name="check" size={14} /> : hit.icon ? <Icon name={hit.icon} size={14} /> : null}</span>
            <span className="ks-menu-hit-text">
              <span className="ks-menu-hit-label">{hit.label}</span>
              <span className="ks-menu-hit-place">{placeOf(hit)}</span>
            </span>
            {hit.keys ? <kbd className="ks-kbd">{hit.keys}</kbd> : null}
          </div>
        ))}
        {query.trim() === "" ? <div className="ks-menu-hits-note">Type to find a command, such as “bold” or “page setup”.</div> : null}
        {query.trim() !== "" && found.length === 0 ? <div className="ks-menu-hits-note">Nothing in the menus is called that.</div> : null}
      </div>
    </>
  );
}
