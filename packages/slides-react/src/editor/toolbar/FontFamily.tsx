import { type JSX, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import { noteFont, recentFonts } from "../chrome/recents.ts";
import { type CommandContext, textFormat } from "../commands/index.ts";
import { swallowKeys } from "../menus/focus.ts";
import { useDropdown } from "../menus/useDropdown.ts";
import type { EditorUi } from "../ui-state.ts";
import { Icon } from "../ui/Icon.tsx";
import { Popover } from "../ui/Popover.tsx";
import { keepFocusExceptFields } from "./ColorButton.tsx";
import { type FontOption, familyOf, fontGroups, isRole } from "./fonts.ts";
import { ToolButton } from "./ToolButton.tsx";
import type { TextView } from "./useTextView.ts";

/** The font of the words in hand: a button with its name that opens a searchable list, the theme's fonts and the ones used lately first. */
export function FontFamily({ view }: { view: TextView; ui: EditorUi }): JSX.Element {
  const { ctx, format, can, base } = view;
  const { fonts } = ctx.session.deck.theme;
  const current = format.font ?? base.font;
  const shown = current === "mixed" ? "Mixed" : familyOf(current, fonts);
  const dd = useDropdown("dialog");
  return (
    <>
      <ToolButton label="Font" menu className="ks-tb-font" text={shown} disabled={!can} {...dd.trigger} />
      {dd.anchor ? (
        <Popover anchor={dd.anchor} onClose={dd.close} label="Fonts">
          <div className="ks-fonts" data-ks-keep-focus="" onMouseDown={keepFocusExceptFields} onKeyDown={swallowKeys}>
            <FontList ctx={ctx} current={current} fonts={fonts} onDone={dd.close} />
          </div>
        </Popover>
      ) : null}
    </>
  );
}

interface FontListProps {
  ctx: CommandContext;
  current: string;
  fonts: Record<string, { family: string }>;
  onDone(): void;
}

/** A search box over the list of fonts, each drawn in its own face. Up and Down move, Enter uses the one marked, Escape closes. */
function FontList({ ctx, current, fonts, onDone }: FontListProps): JSX.Element {
  const [query, setQuery] = useState("");
  const recents = useMemo(recentFonts, []);
  const groups = fontGroups({ query, current, recents, fonts });
  const options = groups.flatMap((group) => group.options);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((option) => option.checked)));
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const at = Math.min(active, Math.max(options.length - 1, 0));

  // The search box has the keys at once. The popover is hidden until it is placed, so the focus comes a frame later.
  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);
  // The row marked stays in view as the keys move it.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>("[data-active]")?.scrollIntoView?.({ block: "nearest" });
  }, [at, query]);

  const use = (option: FontOption | undefined) => {
    if (!option) return;
    textFormat.setFont(ctx, option.value);
    if (!isRole(option.value)) noteFont(option.value);
    onDone();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = options.length - 1;
    if (event.key === "ArrowDown") setActive(at >= last ? 0 : at + 1);
    else if (event.key === "ArrowUp") setActive(at <= 0 ? last : at - 1);
    else if (event.key === "Home" && event.ctrlKey) setActive(0);
    else if (event.key === "End" && event.ctrlKey) setActive(last);
    else if (event.key === "Enter") use(options[at]);
    else return;
    event.preventDefault();
  };

  let index = -1;
  return (
    <>
      <div className="ks-fonts-search">
        <Icon name="search" size={14} />
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-label="Search fonts"
          aria-expanded="true"
          aria-controls="ks-font-options"
          aria-activedescendant={options[at] ? `ks-font-${options[at].id}` : undefined}
          placeholder="Search fonts"
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
      <div ref={list} id="ks-font-options" className="ks-fonts-list" role="listbox" aria-label="Fonts">
        {groups.map((group) => (
          <div key={group.title || "custom"} role="group" aria-label={group.title || "Typed name"}>
            {group.title ? <div className="ks-fonts-title">{group.title}</div> : null}
            {group.options.map((option) => {
              index += 1;
              const mine = index;
              return (
                <div
                  key={option.id}
                  id={`ks-font-${option.id}`}
                  role="option"
                  aria-selected={option.checked}
                  data-active={mine === at ? "" : undefined}
                  className={`ks-font-opt${mine === at ? " is-active" : ""}${option.checked ? " is-on" : ""}`}
                  onMouseMove={() => active !== mine && setActive(mine)}
                  onClick={() => use(option)}
                >
                  <span className="ks-font-mark">{option.checked ? <Icon name="check" size={14} /> : null}</span>
                  <span className="ks-font-name" style={{ fontFamily: `"${option.family}", var(--ks-font)` }}>
                    {option.label}
                  </span>
                  {option.hint ? <span className="ks-tb-hint">{option.hint}</span> : null}
                </div>
              );
            })}
          </div>
        ))}
        {options.length === 0 ? <div className="ks-fonts-empty">No font by that name</div> : null}
      </div>
    </>
  );
}
