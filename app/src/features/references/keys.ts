// The rules for a citation key, the same as the vault's: the core checks them
// again, but a form that says what is wrong as the key is typed saves a trip.

const INNER = new Set(["_", "-", ":", ".", "/", "+", "?", "<", ">", "~", "&", "$"]);
const LONGEST = 128;

const isWordChar = (c: string) => /^[\p{L}\p{N}_]$/u.test(c);

/** Why `key` cannot be a citation key, in words; null when it can. */
export function keyProblem(key: string): string | null {
  if (key === "") return "Write a key, such as vaswani2017attention.";
  if ([...key].length > LONGEST) return `A key is at most ${LONGEST} characters.`;
  for (const c of key) {
    if (c === " ") return "A key cannot hold a space.";
    if (!isWordChar(c) && !INNER.has(c)) return `A key cannot hold “${c}”: use letters, digits and - _ : . / +.`;
  }
  const chars = [...key];
  if (!isWordChar(chars[0]!)) return "A key must start with a letter, a digit or _.";
  if (!isWordChar(chars.at(-1)!)) return "A key must end with a letter, a digit or _.";
  return null;
}
