// Colour arithmetic for the palette: shades of a colour, and the hue, saturation and value of the custom picker.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsv {
  /** Degrees, 0 to 360 (360 is the same as 0). */
  h: number;
  /** 0 to 1. */
  s: number;
  /** 0 to 1. */
  v: number;
}

/** `#rrggbb` (any case) or `#rgb`, written as `#rrggbb` in lower case; null for anything else. */
export function normalHex(value: string): string | null {
  const text = value.trim();
  const full = /^#?([0-9a-f]{6})$/i.exec(text);
  if (full) return `#${full[1]!.toLowerCase()}`;
  const short = /^#?([0-9a-f]{3})$/i.exec(text);
  return short ? `#${short[1]!.toLowerCase().replace(/./g, "$&$&")}` : null;
}

export function hexToRgb(hex: string): Rgb {
  const normal = normalHex(hex) ?? "#000000";
  return { r: Number.parseInt(normal.slice(1, 3), 16), g: Number.parseInt(normal.slice(3, 5), 16), b: Number.parseInt(normal.slice(5, 7), 16) };
}

const byte = (n: number): string => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, "0");

export const rgbToHex = ({ r, g, b }: Rgb): string => `#${byte(r)}${byte(g)}${byte(b)}`;

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const delta = max - Math.min(R, G, B);
  let h = 0;
  if (delta !== 0) {
    if (max === R) h = ((G - B) / delta) % 6;
    else if (max === G) h = (B - R) / delta + 2;
    else h = (R - G) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export const hexToHsv = (hex: string): Hsv => rgbToHsv(hexToRgb(hex));

export const hsvToHex = (hsv: Hsv): string => rgbToHex(hsvToRgb(hsv));

/** Mixes a `#rrggbb` toward white (positive `by`, up to 1) or toward black (negative, down to -1). */
export function shade(hex: string, by: number): string {
  const { r, g, b } = hexToRgb(hex);
  const mix = (c: number) => (by >= 0 ? c + (255 - c) * by : c * (1 + by));
  return rgbToHex({ r: mix(r), g: mix(g), b: mix(b) });
}

/** The ten greys of the standard palette, black to white. */
export const GREYS = ["#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff"] as const;

/** A hue for each column of the standard palette, as Google Slides offers: red berry to magenta. */
export const HUES = ["#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff"] as const;

/** How far each row under the hues is mixed toward white (lighter 3, 2, 1) or black (darker 1, 2). */
export const HUE_SHADES = [0.8, 0.6, 0.4, -0.25, -0.5] as const;

/** The standard palette as rows of ten: the greys, the hues, then their shades. */
export function standardRows(): string[][] {
  return [[...GREYS], [...HUES], ...HUE_SHADES.map((by) => HUES.map((hue) => shade(hue, by)))];
}

/** Where a key moves the focus in a grid whose rows have the lengths given; null when the key is not an arrow, Home or End. */
export function moveInGrid(rows: readonly number[], from: { row: number; col: number }, key: string): { row: number; col: number } | null {
  const last = rows.length - 1;
  const length = (row: number) => rows[row] ?? 0;
  const clampCol = (row: number, col: number) => Math.max(0, Math.min(col, length(row) - 1));
  switch (key) {
    case "ArrowLeft":
      return from.col > 0 ? { row: from.row, col: from.col - 1 } : from.row > 0 ? { row: from.row - 1, col: length(from.row - 1) - 1 } : from;
    case "ArrowRight":
      return from.col < length(from.row) - 1 ? { row: from.row, col: from.col + 1 } : from.row < last ? { row: from.row + 1, col: 0 } : from;
    case "ArrowUp":
      return from.row > 0 ? { row: from.row - 1, col: clampCol(from.row - 1, from.col) } : from;
    case "ArrowDown":
      return from.row < last ? { row: from.row + 1, col: clampCol(from.row + 1, from.col) } : from;
    case "Home":
      return { row: from.row, col: 0 };
    case "End":
      return { row: from.row, col: length(from.row) - 1 };
    default:
      return null;
  }
}
