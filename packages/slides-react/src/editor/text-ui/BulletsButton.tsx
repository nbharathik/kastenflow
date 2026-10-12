import { type JSX, useState } from "react";

import { markerText } from "../../text/lists.ts";
import { colorOf } from "../../theme/index.ts";
import { LIST_STYLES, restartNumbering, continueList, setBulletColor, setBulletSize, setListStyle, setStartNumber } from "../commands/text-format.ts";
import { swallowKeys } from "../menus/focus.ts";
import { useDropdown } from "../menus/useDropdown.ts";
import { keepFocusExceptFields } from "../toolbar/ColorButton.tsx";
import { ToolButton } from "../toolbar/ToolButton.tsx";
import type { TextView } from "../toolbar/useTextView.ts";
import { ColorPicker } from "../ui/ColorPicker.tsx";
import { NumberField } from "../ui/Fields.tsx";
import { Popover } from "../ui/Popover.tsx";
import "./text-ui.css";

/** What a marker's size can be set to, in percent of its words' size. */
const BULLET_PERCENT = { min: 25, max: 400 } as const;

/** One style of marker drawn as it looks: its marker in front of three short lines. */
function Preview({ style, kind }: { style: (typeof LIST_STYLES)[number]["style"]; kind: "bullet" | "number" }): JSX.Element {
  return (
    <span className="ks-tui-preview" aria-hidden="true">
      {[1, 2, 3].map((n) => (
        <span key={n} className="ks-tui-line">
          <span className="ks-tui-marker">{markerText(style, kind === "number" ? n : 1)}</span>
          <span className="ks-tui-bar" />
        </span>
      ))}
    </span>
  );
}

/**
 * The bullets and numbering button: a button that opens a grid of the looks a list can have, each drawn as it will be, and
 * the counting of a numbered one ("Restart numbering", "Continue previous list", and the number it starts at). Choosing
 * a look makes the words in hand a list of that kind; "No list" takes it away. It works on the words selected in the open
 * text box, or on all the words of the selected boxes.
 */
export function BulletsButton({ view }: { view: TextView }): JSX.Element {
  const { ctx, format, can } = view;
  const dd = useDropdown("dialog");
  const [colours, setColours] = useState(false);
  const theme = ctx.session.deck.theme;
  const numbered = format.list === "number";
  /** Whether there is a marker to change: the words in hand are list items, or some of them are. */
  const listed = format.list !== null;
  const pick = (style: Parameters<typeof setListStyle>[1]) => {
    dd.close();
    setListStyle(ctx, style);
  };
  const section = (kind: "bullet" | "number", title: string): JSX.Element => (
    <div className="ks-tui-section">
      <div className="ks-tui-heading">{title}</div>
      <div className="ks-tui-grid" role="radiogroup" aria-label={title}>
        {LIST_STYLES.filter((entry) => entry.kind === kind).map(({ style, label }) => (
          <button
            key={style}
            type="button"
            role="radio"
            aria-checked={format.listStyle === style}
            aria-label={label}
            data-tip={label}
            className={`ks-tui-cell${format.listStyle === style ? " is-on" : ""}`}
            onClick={() => pick(style)}
          >
            <Preview style={style} kind={kind} />
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <>
      <ToolButton icon="list" label="Bullets and numbering" menu on={format.list !== null && format.list !== "mixed"} disabled={!can} {...dd.trigger} />
      {dd.anchor ? (
        <Popover anchor={dd.anchor} onClose={dd.close} label="Bullets and numbering">
          <div className="ks-tui ks-tui-bullets" data-ks-keep-focus="" onMouseDown={keepFocusExceptFields} onKeyDown={swallowKeys}>
            {section("bullet", "Bullets")}
            {section("number", "Numbering")}
            <div className="ks-tui-row">
              <button type="button" className="ks-btn ks-text-btn" onClick={() => pick(null)}>
                No list
              </button>
            </div>
            <div className="ks-tui-row ks-tui-counting">
              <NumberField
                label="Marker size"
                short="Size"
                value={format.bulletSize === "mixed" ? "mixed" : Math.round((format.bulletSize ?? 1) * 100)}
                min={BULLET_PERCENT.min}
                max={BULLET_PERCENT.max}
                step={5}
                decimals={0}
                unit="%"
                width={76}
                disabled={!listed}
                onCommit={(percent) => setBulletSize(ctx, percent / 100)}
              />
              <button type="button" className="ks-btn ks-text-btn" disabled={!listed || format.bulletSize === null} onClick={() => setBulletSize(ctx, null)}>
                Same as text
              </button>
            </div>
            <div className="ks-tui-row">
              <button
                type="button"
                className="ks-btn ks-text-btn ks-tui-marker-color"
                aria-expanded={colours}
                disabled={!listed}
                onClick={() => setColours((open) => !open)}
              >
                <span
                  className={`ks-tui-swatch${format.bulletColor === null ? " is-none" : format.bulletColor === "mixed" ? " is-mixed" : ""}`}
                  style={format.bulletColor !== null && format.bulletColor !== "mixed" ? { background: colorOf(theme, format.bulletColor) } : undefined}
                />
                Marker colour
              </button>
            </div>
            {colours ? (
              <ColorPicker
                theme={theme}
                value={format.bulletColor === "mixed" ? null : format.bulletColor}
                noneLabel="Same as text"
                onPick={(color) => {
                  setColours(false);
                  setBulletColor(ctx, color);
                }}
              />
            ) : null}
            <div className="ks-tui-row ks-tui-counting">
              <button
                type="button"
                className="ks-btn ks-text-btn"
                disabled={!numbered}
                onClick={() => {
                  dd.close();
                  restartNumbering(ctx);
                }}
              >
                Restart numbering
              </button>
              <button
                type="button"
                className="ks-btn ks-text-btn"
                disabled={!numbered}
                onClick={() => {
                  dd.close();
                  continueList(ctx);
                }}
              >
                Continue previous list
              </button>
            </div>
            <div className="ks-tui-row">
              <NumberField label="Start at" value={numbered ? (format.start ?? null) : null} min={1} max={99999} step={1} decimals={0} width={64} disabled={!numbered} onCommit={(n) => setStartNumber(ctx, n)} />
            </div>
          </div>
        </Popover>
      ) : null}
    </>
  );
}
