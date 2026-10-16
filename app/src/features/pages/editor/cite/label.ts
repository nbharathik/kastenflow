// The words a citation chip shows in place of `[@key]`: "(Vaswani et al., 2017)",
// "(see Vaswani et al., 2017, p. 4; Devlin and Chang, 2019)", "(2017)" for a
// suppressed author. The words around the keys stay as written; a key that
// names no reference is shown as the key.

export interface LabelItem {
  key: string;
  /** Where the `@` (or the `-` before it) is, counting from the group's `[`. */
  at: number;
  /** Just after the key, counting from the group's `[`. */
  keyTo: number;
  suppress: boolean;
}

/** `source` is the whole group, brackets included. `name` says who and when a key's work is, or null when it has none. */
export function groupLabel(source: string, items: readonly LabelItem[], name: (key: string) => { who: string; year: string } | null): string {
  let out = "";
  let from = 1;
  for (const item of items) {
    out += source.slice(from, item.at);
    const named = name(item.key);
    out += named ? (item.suppress ? named.year || named.who : [named.who, named.year].filter(Boolean).join(", ")) : item.key;
    from = item.keyTo;
  }
  out += source.slice(from, source.length - 1);
  return `(${out.trim()})`;
}
