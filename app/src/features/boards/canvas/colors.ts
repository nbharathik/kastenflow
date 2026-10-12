// Board colours: the six JSON Canvas presets "1" to "6" (red, orange, yellow,
// green, cyan, purple; the canvas CSS tunes each for light and dark), then
// three of Kasten's own written as "#rrggbb", which every other app reads
// too. The colour menu lists the nine in this order, and the keys 1 to 9 pick
// them (0 for none).

import type { CSSProperties } from "react";

export const PRESETS = [
  { value: "1", name: "Red" },
  { value: "2", name: "Orange" },
  { value: "3", name: "Yellow" },
  { value: "4", name: "Green" },
  { value: "5", name: "Cyan" },
  { value: "6", name: "Purple" },
  { value: "#d6409f", name: "Pink" },
  { value: "#a0714f", name: "Brown" },
  { value: "#7a7a7a", name: "Grey" },
] as const;

/** The colour the key `1` to `9` picks, or null for `0` (none); undefined for any other key. */
export function colorForKey(key: string): string | null | undefined {
  if (key === "0") return null;
  return /^[1-9]$/.test(key) ? PRESETS[Number(key) - 1]?.value : undefined;
}

/** The key that picks a colour, if one does. */
export function keyForColor(color: string | null | undefined): string | null {
  const at = PRESETS.findIndex((p) => p.value === color);
  return at < 0 ? null : String(at + 1);
}

/** A CSS colour for a board colour, or undefined for the default. */
export function cssColor(color: string | undefined | null): string | undefined {
  if (!color) return undefined;
  if (/^[1-6]$/.test(color)) return `var(--board-c${color})`;
  return /^#[0-9a-f]{6}$/i.test(color) ? color : undefined;
}

/** Style that tints a node with its colour (the board styles read `--tint`). */
export function tint(color: string | undefined): CSSProperties | undefined {
  const css = cssColor(color);
  return css ? ({ "--tint": css } as CSSProperties) : undefined;
}

/** The colour's name, for menus and screen readers. */
export function colorName(color: string | undefined | null): string {
  if (!color) return "Default";
  return PRESETS.find((p) => p.value.toLowerCase() === color.toLowerCase())?.name ?? color;
}
