// Searching Settings: the words typed, a setting's text to look in, and the
// words to mark in what is shown. Plain functions, so the page, the navigation
// and the palette find the same settings.

/** The words of a query: lower case, split on spaces, empty ones dropped. */
export function wordsOf(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

/** Whether every word of the query appears somewhere in `text`. */
export function hasWords(words: readonly string[], text: string): boolean {
  if (words.length === 0) return false;
  const lower = text.toLowerCase();
  return words.every((word) => lower.includes(word));
}

/** A piece of a text, and whether the search words matched it. */
export interface Piece {
  text: string;
  hit: boolean;
}

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `text` cut into pieces, the parts the words match flagged. With no words
 * the text is one piece. */
export function pieces(text: string, words: readonly string[]): Piece[] {
  if (words.length === 0 || text === "") return [{ text, hit: false }];
  const pattern = new RegExp(`(${[...words].sort((a, b) => b.length - a.length).map(escape).join("|")})`, "gi");
  const out: Piece[] = [];
  let last = 0;
  for (const found of text.matchAll(pattern)) {
    const at = found.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), hit: false });
    out.push({ text: found[0], hit: true });
    last = at + found[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out.length > 0 ? out : [{ text, hit: false }];
}
