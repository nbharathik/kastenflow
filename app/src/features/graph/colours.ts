// The theme's colours as the graph's canvas needs them: a canvas cannot read
// the style sheet's variables, so they are read once from the page (and again
// when the theme changes) and turned into numbers to mix: a node's own
// colour with the ink around it, a link faint against the page.

export interface Ink {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** A colour as the style sheet writes it: `#rgb`, `#rrggbb`, `rgb(r g b / a)` or `rgba(r, g, b, a)`. */
export function parseColour(text: string): Ink | null {
  const value = text.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value);
  if (hex) {
    const digits = hex[1]!.length === 3 ? [...hex[1]!].map((d) => d + d).join("") : hex[1]!;
    const n = parseInt(digits, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[/,]\s*([\d.]+)(%?))?\s*\)$/.exec(value);
  if (!fn) return null;
  const alpha = fn[4] === undefined ? 1 : fn[5] ? Number(fn[4]) / 100 : Number(fn[4]);
  return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a: alpha };
}

/** A canvas colour string. */
export const css = (c: Ink, alpha = c.a): string => `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${Math.round(alpha * 1000) / 1000})`;

/** `a` toward `b` by `t` (0 is a, 1 is b); the alpha follows. */
export function mix(a: Ink, b: Ink, t: number): Ink {
  const at = (x: number, y: number) => x + (y - x) * t;
  return { r: at(a.r, b.r), g: at(a.g, b.g), b: at(a.b, b.b), a: at(a.a, b.a) };
}

export interface Palette {
  canvas: Ink;
  ink: Ink;
  muted: Ink;
  line: Ink;
  accent: Ink;
  /** The highlight colours by name (`blue`, `yellow`…): what kinds and projects are drawn in. */
  highlight: Record<string, Ink>;
}

const HIGHLIGHTS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;

/** What to draw in when the page gives no usable colours (a test, an unstyled page). */
const FALLBACK: Palette = {
  canvas: { r: 255, g: 255, b: 255, a: 1 },
  ink: { r: 49, g: 48, b: 46, a: 1 },
  muted: { r: 100, g: 97, b: 92, a: 1 },
  line: { r: 0, g: 0, b: 0, a: 0.085 },
  accent: { r: 0, g: 117, b: 222, a: 1 },
  highlight: Object.fromEntries(HIGHLIGHTS.map((name) => [name, { r: 200, g: 200, b: 200, a: 1 }])),
};

/** The palette the page is wearing now. */
export function readPalette(root: Element = document.documentElement): Palette {
  const style = getComputedStyle(root);
  const read = (name: string, fallback: Ink): Ink => parseColour(style.getPropertyValue(name)) ?? fallback;
  return {
    canvas: read("--color-canvas", FALLBACK.canvas),
    ink: read("--color-ink", FALLBACK.ink),
    muted: read("--color-muted", FALLBACK.muted),
    line: read("--color-line", FALLBACK.line),
    accent: read("--color-accent", FALLBACK.accent),
    highlight: Object.fromEntries(HIGHLIGHTS.map((name) => [name, read(`--color-highlight-${name}`, FALLBACK.highlight[name]!)])),
  };
}
