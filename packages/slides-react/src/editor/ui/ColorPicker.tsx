import type { Theme } from "@kasten-slides/wasm";
import { type KeyboardEvent, useRef, useState } from "react";

import { COLOR_TOKENS, colorOf, hexOf } from "../../theme/index.ts";
import { noteColour, recentColours } from "../chrome/recents.ts";
import { HsvArea } from "./HsvArea.tsx";
import { hexToHsv, hsvToHex, moveInGrid, normalHex, shade, standardRows } from "./color-math.ts";
import { Icon } from "./Icon.tsx";
import "./colors.css";

interface ColorPickerProps {
  theme: Theme;
  /** A theme token, a `#rrggbb` value, or null for none. */
  value: string | null;
  /** A token, a hex value, or null for "none" (or the default, when `noneLabel` says so). */
  onPick(value: string | null): void;
  noneLabel?: string;
}

interface Swatch {
  /** What is picked: a theme token or `#rrggbb`. */
  pick: string;
  /** What is drawn. */
  colour: string;
  name: string;
}

/** The rows under the theme's own colours: each mixed toward white or black, and what it is called. */
const THEME_SHADES: readonly (readonly [number, string])[] = [
  [0.6, "lighter"],
  [-0.35, "darker"],
];

/** The eyedropper of Chromium browsers (and the desktop app's web view); not there in every browser. */
interface EyeDropperApi {
  open(): Promise<{ sRGBHex: string }>;
}
const eyeDropper = (): (new () => EyeDropperApi) | null => (typeof window !== "undefined" ? ((window as unknown as { EyeDropper?: new () => EyeDropperApi }).EyeDropper ?? null) : null);

/**
 * The palette that opens from a colour button, as Google Slides lays it out: the theme's colours and their shades (a colour of the theme
 * follows the theme when it changes), the standard colours, the ones used lately, and any value: typed, picked on a colour square or
 * taken from anywhere on the screen with the eyedropper where the browser has one. Arrow keys move over the swatches.
 */
export function ColorPicker({ theme, value, onPick, noneLabel = "None" }: ColorPickerProps) {
  const [custom, setCustom] = useState("");
  const [picking, setPicking] = useState(false);
  const [recent] = useState(recentColours);
  const root = useRef<HTMLDivElement>(null);
  const current = value === null ? null : (hexOf(theme, value) ?? value);
  // Kept here, not worked out from the hex each time: a grey has no hue, and the bar must not forget where it was.
  const [hsv, setHsv] = useState(() => hexToHsv(normalHex(current ?? "") ?? "#4a86e8"));
  const dropper = eyeDropper();

  const themeRows: Swatch[][] = [
    COLOR_TOKENS.map((token) => ({ pick: token, colour: colorOf(theme, token), name: token })),
    ...THEME_SHADES.map(([by, word]) =>
      COLOR_TOKENS.map((token) => {
        const hex = shade(hexOf(theme, token) ?? "#000000", by);
        return { pick: hex, colour: hex, name: `${token}, ${word}` };
      }),
    ),
  ];
  const standard: Swatch[][] = standardRows().map((row) => row.map((hex) => ({ pick: hex, colour: hex, name: hex })));
  const lately: Swatch[][] = recent.length > 0 ? [recent.map((hex) => ({ pick: hex, colour: hex, name: `Recent ${hex}` }))] : [];
  const rows = [...themeRows, ...standard, ...lately];
  const lengths = rows.map((row) => row.length);

  /** The swatch that is the one stop of Tab: the colour in use, else the first. */
  const startAt = (() => {
    for (let r = 0; r < rows.length; r++) {
      const c = rows[r]!.findIndex((swatch) => current !== null && hexOf(theme, swatch.pick) === current);
      if (c >= 0) return { row: r, col: c };
    }
    return { row: 0, col: 0 };
  })();
  const [stop, setStop] = useState(startAt);

  const choose = (pick: string) => {
    if (!pick.startsWith("#")) return onPick(pick);
    noteColour(pick);
    onPick(pick);
  };

  const onGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.dataset.r === undefined) return;
    const to = moveInGrid(lengths, { row: Number(target.dataset.r), col: Number(target.dataset.c) }, event.key);
    if (!to) return;
    event.preventDefault();
    setStop(to);
    root.current?.querySelector<HTMLElement>(`[data-r="${to.row}"][data-c="${to.col}"]`)?.focus();
  };

  let rowAt = 0;
  const grid = (label: string, group: Swatch[][]) => {
    const first = rowAt;
    rowAt += group.length;
    return (
      <div className="ks-swatch-grid" role="group" aria-label={label} onKeyDown={onGridKey}>
        {group.map((row, r) =>
          row.map((swatch, c) => (
            <button
              key={`${first + r}-${c}`}
              type="button"
              className={`ks-swatch${current !== null && hexOf(theme, swatch.pick) === current ? " is-on" : ""}`}
              style={{ background: swatch.colour }}
              aria-label={swatch.name}
              data-tip={swatch.name}
              data-r={first + r}
              data-c={c}
              tabIndex={stop.row === first + r && stop.col === c ? 0 : -1}
              onFocus={() => setStop({ row: first + r, col: c })}
              onClick={() => choose(swatch.pick)}
            />
          )),
        )}
      </div>
    );
  };

  const typed = normalHex(custom);
  const preview = typed ?? (current ?? "#000000");

  return (
    <div className="ks-colors" ref={root}>
      <button type="button" className="ks-color-none" onClick={() => onPick(null)}>
        <span className="ks-swatch is-none" aria-hidden="true" />
        {noneLabel}
      </button>
      <div className="ks-colors-title">Theme</div>
      {grid("Theme colours", themeRows)}
      <div className="ks-colors-title">Standard</div>
      {grid("Standard colours", standard)}
      {lately.length > 0 ? (
        <>
          <div className="ks-colors-title">Recent</div>
          {grid("Recent colours", lately)}
        </>
      ) : null}
      <div className="ks-colors-title">Custom</div>
      <form
        className="ks-color-custom"
        onSubmit={(event) => {
          event.preventDefault();
          if (typed) choose(typed);
        }}
      >
        <span className="ks-swatch is-preview" style={{ background: preview }} aria-hidden="true" />
        <input
          className="ks-input"
          value={custom}
          placeholder="#1a73e8"
          aria-label="Colour as hex"
          onChange={(event) => {
            setCustom(event.target.value);
            const hex = normalHex(event.target.value);
            if (hex) setHsv(hexToHsv(hex));
          }}
        />
        <button type="submit" className="ks-btn ks-text-btn" disabled={typed === null}>
          Use
        </button>
        <button type="button" className={`ks-btn ks-icon-btn${picking ? " is-on" : ""}`} aria-label="Pick on a colour square" aria-pressed={picking} data-tip="Pick on a colour square" onClick={() => setPicking(!picking)}>
          <Icon name="palette" />
        </button>
        {dropper ? (
          <button
            type="button"
            className="ks-btn ks-icon-btn"
            aria-label="Pick from the screen"
            data-tip="Pick from the screen"
            onClick={() =>
              void new dropper()
                .open()
                .then(({ sRGBHex }) => {
                  const hex = normalHex(sRGBHex);
                  if (hex) choose(hex);
                })
                // The person pressed Escape: nothing was picked.
                .catch(() => {})
            }
          >
            <Icon name="pipette" />
          </button>
        ) : null}
      </form>
      {picking ? (
        <HsvArea
          hsv={hsv}
          onChange={(next) => {
            setHsv(next);
            setCustom(hsvToHex(next));
          }}
        />
      ) : null}
    </div>
  );
}
