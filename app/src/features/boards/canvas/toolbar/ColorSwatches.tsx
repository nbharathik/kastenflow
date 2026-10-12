// The board colours as a row of swatches: none, then the nine colours (the
// keys 0 to 9 pick them). Shown only inside a panel the person opened: the
// colour dot's, a pen's, a menu's.

import { PRESETS, colorName, cssColor } from "../colors";

const same = (a: string | null, b: string) => a !== null && a.toLowerCase() === b.toLowerCase();

export function ColorSwatches({ value, onPick }: { value: string | null; onPick: (color: string | null) => void }) {
  return (
    <span className="kasten-board-swatches" role="group" aria-label="Colour">
      <button type="button" className="kasten-board-swatch is-none" aria-label="No colour" aria-pressed={!value} title="No colour (0)" onClick={() => onPick(null)} />
      {PRESETS.map((preset, at) => (
        <button
          key={preset.value}
          type="button"
          className="kasten-board-swatch"
          style={{ background: cssColor(preset.value) }}
          aria-label={colorName(preset.value)}
          aria-pressed={same(value, preset.value)}
          title={`${preset.name} (${at + 1})`}
          onClick={() => onPick(preset.value)}
        />
      ))}
    </span>
  );
}
