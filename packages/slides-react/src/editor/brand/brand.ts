// The brand kit: the logo, colours, fonts and default theme a vault's (or a project's) decks start from. A kit is one small JSON
// text that the host keeps (`BrandHost`); this file reads and writes it, keeping every field it does not know, and works out the
// operations that put it on a deck. A deck made from a kit holds its own colours, fonts and logo: it opens and exports without the kit.

import type { DeckEngine, JsonValue } from "@kasten-slides/wasm";

export const BRAND_FORMAT = "kasten-brand";

/** The colours of a theme a kit can set. */
export const BRAND_COLOR_KEYS = ["text1", "text2", "bg1", "bg2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"] as const;
export type BrandColorKey = (typeof BRAND_COLOR_KEYS)[number];

export interface BrandKit {
  name: string;
  /** An image in the host's image store, such as `assets/logo.png`. */
  logo: string | null;
  /** `#rrggbb` for the theme colours the brand names. */
  colors: Partial<Record<BrandColorKey, string>>;
  heading: string | null;
  body: string | null;
  /** The name of a built-in theme the deck starts from. */
  theme: string | null;
  /** The fields this version does not know, kept as they were. */
  extra: Record<string, unknown>;
}

export const emptyKit = (): BrandKit => ({ name: "Brand", logo: null, colors: {}, heading: null, body: null, theme: null, extra: {} });

/** `#rrggbb` in lower case from `#rgb`, `#rrggbb` or `#rrggbbaa`; null for anything else. */
export function normaliseHex(value: string): string | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim())?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex.slice(0, 6);
  return `#${full.toLowerCase()}`;
}

const KNOWN = new Set(["format", "formatVersion", "name", "logo", "colors", "fonts", "theme"]);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const word = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

/** The kit a text holds, or null when the text is not a brand kit. What cannot be used in it (a colour that is not a colour) is left out. */
export function parseKit(text: string): BrandKit | null {
  let found: unknown;
  try {
    found = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(found) || found.format !== BRAND_FORMAT) return null;
  const kit = emptyKit();
  kit.name = word(found.name) ?? kit.name;
  kit.logo = word(found.logo);
  if (isObject(found.colors)) {
    for (const key of BRAND_COLOR_KEYS) {
      const hex = typeof found.colors[key] === "string" ? normaliseHex(found.colors[key]) : null;
      if (hex) kit.colors[key] = hex;
    }
  }
  if (isObject(found.fonts)) {
    kit.heading = word(found.fonts.heading);
    kit.body = word(found.fonts.body);
  }
  kit.theme = word(found.theme);
  kit.extra = Object.fromEntries(Object.entries(found).filter(([key]) => !KNOWN.has(key)));
  return kit;
}

/** The kit as the text the host keeps: sorted keys, two-space indent, a newline at the end, unknown fields as they were. */
export function kitText(kit: BrandKit): string {
  const fonts = { ...(kit.heading ? { heading: kit.heading } : {}), ...(kit.body ? { body: kit.body } : {}) };
  const file: Record<string, unknown> = {
    ...kit.extra,
    format: BRAND_FORMAT,
    formatVersion: 1,
    name: kit.name.trim() || "Brand",
    colors: Object.fromEntries(BRAND_COLOR_KEYS.flatMap((key) => (kit.colors[key] ? [[key, kit.colors[key]]] : []))),
    ...(Object.keys(fonts).length > 0 ? { fonts } : {}),
    ...(kit.logo ? { logo: kit.logo } : {}),
    ...(kit.theme ? { theme: kit.theme } : {}),
  };
  const sorted = Object.fromEntries(Object.entries(file).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

/** The colours a deck is checked against: the kit's, each once. */
export const brandPalette = (kit: BrandKit): string[] => [...new Set(Object.values(kit.colors).filter((hex): hex is string => typeof hex === "string"))];

type Operations = Parameters<DeckEngine["applyBatch"]>[0];

/**
 * The operations that put a kit on a deck: the kit's theme (when `withTheme`: a deck that is being made has chosen its own), then its
 * colours and fonts as one edit of the theme, then its logo. Nothing else of the deck changes.
 */
export function brandOperations(kit: BrandKit, withTheme = true): Operations {
  const operations: Operations = [];
  if (withTheme && kit.theme) operations.push(["apply_theme", { name: kit.theme }]);
  const patch: Record<string, unknown> = {};
  if (Object.keys(kit.colors).length > 0) patch.colors = kit.colors;
  const fonts: Record<string, unknown> = {};
  if (kit.heading) fonts.heading = { family: kit.heading };
  if (kit.body) fonts.body = { family: kit.body };
  if (Object.keys(fonts).length > 0) patch.fonts = fonts;
  if (Object.keys(patch).length > 0) operations.push(["edit_theme", { patch: patch as JsonValue }]);
  if (kit.logo) operations.push(["set_logo", { src: kit.logo }]);
  return operations;
}

/** Puts a kit on a deck that is being made, before it is saved: no undo is wanted, so the engine is changed directly. Answers whether the kit changed anything. */
export function applyBrandToNewDeck(engine: DeckEngine, kit: BrandKit): boolean {
  const operations = brandOperations(kit, false);
  if (operations.length === 0) return false;
  engine.applyBatch(operations);
  return true;
}
