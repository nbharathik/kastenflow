// The list the font picker shows: the fonts used lately, the theme's own, then the common ones, narrowed by what is typed. A name that is
// in none of them can still be used: the last row offers whatever was typed.

/** Families that most computers have or that the editor brings, offered after the theme's own. */
export const COMMON_FONTS = ["Arial", "Calibri", "Cambria", "Courier New", "Georgia", "Helvetica", "Inter", "Lato", "Montserrat", "Open Sans", "Roboto", "Roboto Mono", "Times New Roman", "Trebuchet MS", "Verdana"];

export const FONT_ROLES = [
  { role: "heading", label: "Heading font" },
  { role: "body", label: "Body font" },
  { role: "code", label: "Code font" },
] as const;

export type FontRole = (typeof FONT_ROLES)[number]["role"];

export const isRole = (font: string): font is FontRole => FONT_ROLES.some((r) => r.role === font);

/** The family name to show for a font: a theme role is spelled out as the family the theme gives it. */
export function familyOf(font: string, families: Record<string, { family: string }>): string {
  return isRole(font) ? (families[font]?.family ?? font) : font;
}

export interface FontOption {
  /** Unique in the list. */
  id: string;
  label: string;
  /** What setting the font passes on: a theme role or a family name. */
  value: string;
  /** What the row is drawn in. */
  family: string;
  /** The family behind a theme role, shown after its name. */
  hint?: string;
  checked: boolean;
}

export interface FontGroup {
  title: string;
  options: FontOption[];
}

interface Inputs {
  query: string;
  /** The font of the words in hand: a role, a family, or "mixed". */
  current: string;
  /** Families used lately, the newest first. */
  recents: readonly string[];
  fonts: Record<string, { family: string }>;
  common?: readonly string[];
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The groups of rows to show for what has been typed so far. */
export function fontGroups({ query, current, recents, fonts, common = COMMON_FONTS }: Inputs): FontGroup[] {
  const text = query.trim().toLowerCase();
  const has = (...names: string[]) => text === "" || names.some((name) => name.toLowerCase().includes(text));
  const isCurrent = (family: string) => current !== "mixed" && !isRole(current) && same(current, family);

  const roles: FontOption[] = FONT_ROLES.map(({ role, label }) => ({
    id: `role-${role}`,
    label,
    value: role,
    family: fonts[role]?.family ?? role,
    hint: fonts[role]?.family ?? "",
    checked: current === role,
  })).filter((option) => has(option.label, option.hint));
  const lately: FontOption[] = text === "" ? recents.filter((family) => !isRole(family)).map((family) => ({ id: `recent-${family}`, label: family, value: family, family, checked: isCurrent(family) })) : [];
  const all: FontOption[] = common.filter((family) => has(family)).map((family) => ({ id: `font-${family}`, label: family, value: family, family, checked: isCurrent(family) }));

  const groups: FontGroup[] = [
    { title: "Recent", options: lately },
    { title: "Theme fonts", options: roles },
    { title: "Fonts", options: all },
  ].filter((group) => group.options.length > 0);

  const typed = query.trim();
  const known = [...roles, ...all].some((option) => same(option.label, typed) || same(option.family, typed));
  if (typed !== "" && !known) groups.push({ title: "", options: [{ id: "custom", label: `Use “${typed}”`, value: typed, family: typed, checked: false }] });
  return groups;
}
