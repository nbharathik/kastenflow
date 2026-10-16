// Milkdown's own text handler skips all escaping for text that ends in
// whitespace, so `, [[x]], ` or `# not a heading ` are written raw and change
// meaning on the next load. Kasten always escapes, and keeps trailing spaces as
// spaces rather than `&#x20;`.
//
// Dollars: remark-math would escape every `$` in text, so a price
// saved as `\$5`. Only a dollar that would open math on the next load is
// escaped; a `$$` at the start of a line still is, by remark-math's own rule.

import { remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";

import { mathOpenings } from "./blocks/math-remark";
import { citationRawRanges } from "./cite/scan";

interface Unsafe {
  character: string;
  inConstruct?: string | string[];
  atBreak?: boolean;
}

interface SafeState {
  unsafe: Unsafe[];
  safe(value: string, info: Record<string, unknown>): string;
}

/** remark-math's rule that escapes every dollar inside a line of text. */
const everyDollar = (pattern: Unsafe) => pattern.character === "$" && !pattern.atBreak && pattern.inConstruct === "phrasing";

function escapeText(value: string, state: SafeState, info: Record<string, unknown>): string {
  const unsafe = state.unsafe;
  state.unsafe = unsafe.filter((pattern) => !everyDollar(pattern));
  let out: string;
  try {
    out = state.safe(value, { ...info, encode: [] }).replace(/(?<!\\)&#x20;/g, " ");
  } finally {
    state.unsafe = unsafe;
  }
  const opens = new Set(mathOpenings(value));
  if (opens.size === 0) return out;
  // Escaping above never adds or removes a dollar, so the nth dollar written
  // is the nth dollar of the text.
  let nth = -1;
  const dollars: number[] = [];
  for (let i = 0; i < value.length; i++) if (value[i] === "$") dollars.push(i);
  return out.replace(/\\?\$/g, (dollar) => {
    nth += 1;
    return dollar === "$" && opens.has(dollars[nth]!) ? "\\$" : dollar;
  });
}

// A citation, `[@key]` or `[see @a; @b, p. 4]`, is written as it was typed: the
// escaping above would turn its bracket into `\[` (so the vault no longer
// reads it as a citation) and an underscore of a key into `\_`. The brackets
// and the keys are kept as they are; the words between are escaped as usual.
function text(node: { value: string }, _parent: unknown, state: SafeState, info: Record<string, unknown>): string {
  const { value } = node;
  const raw = citationRawRanges(value);
  if (raw.length === 0) return escapeText(value, state, info);
  const around = (from: number, to: number) => ({ ...info, before: from === 0 ? info.before : value[from - 1], after: to === value.length ? info.after : value[to] });
  let out = "";
  let at = 0;
  for (const [from, to] of raw) {
    if (from > at) out += escapeText(value.slice(at, from), state, around(at, from));
    out += value.slice(from, to);
    at = to;
  }
  return at < value.length ? out + escapeText(value.slice(at), state, around(at, value.length)) : out;
}

/** Replaces Milkdown's text handler; call from `editor.config`. */
export function configureTextEscaping(ctx: Ctx): void {
  ctx.update(remarkStringifyOptionsCtx, (prev) => ({
    ...prev,
    handlers: { ...prev.handlers, text: text as never },
  }));
}
