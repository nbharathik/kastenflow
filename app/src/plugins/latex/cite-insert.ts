// What to write at the caret for a chosen reference: `\cite{key}`, or, when
// the caret is already inside the braces of a citation command, just the key
// (with the commas a list needs), so a second pick extends the citation.

const IN_CITE = /\\[A-Za-z]*cite[A-Za-z]*\*?(?:\[[^\]]*\]){0,2}\{([^{}]*)$/;

/** `before` and `after` are the text of the caret's line on each side of it. */
export function citationText(before: string, after: string, key: string): string {
  const open = IN_CITE.exec(before);
  const closes = /^[^{}]*\}/.test(after);
  if (!open || !closes) return `\\cite{${key}}`;
  const arg = open[1] ?? "";
  const rest = /^[^{}]*/.exec(after)?.[0] ?? "";
  const commaBefore = arg.trim() !== "" && !arg.trimEnd().endsWith(",");
  const commaAfter = rest.trim() !== "" && !rest.trimStart().startsWith(",");
  return `${commaBefore ? "," : ""}${key}${commaAfter ? "," : ""}`;
}
