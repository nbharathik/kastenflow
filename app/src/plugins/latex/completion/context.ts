// Where the cursor is, for completion: after a backslash, or inside the braces
// of a command that takes a label, a citation key, a file or an environment
// name. Only the text of the cursor's line before the cursor is looked at, so
// the cost does not depend on the size of the document.

export type ArgKind = "ref" | "cite" | "environment" | "image" | "tex" | "bib" | "package" | "class";

export interface ArgContext {
  kind: ArgKind;
  command: string;
  /** Offset in the line where the text being completed starts (after `{` or the last comma). */
  from: number;
  /** What is typed of it so far. */
  prefix: string;
}

const REF = new Set(["ref", "eqref", "autoref", "pageref", "nameref", "cref", "Cref", "vref", "Vref", "labelcref", "cpageref", "hyperref"]);
const IMAGE = new Set(["includegraphics", "includepdf"]);
const TEX = new Set(["input", "include", "subfile", "includeonly", "subimport"]);
const BIB = new Set(["bibliography", "addbibresource"]);

function kindOf(command: string): ArgKind | null {
  if (REF.has(command)) return "ref";
  if (command === "begin" || command === "end") return "environment";
  if (IMAGE.has(command)) return "image";
  if (TEX.has(command)) return "tex";
  if (BIB.has(command)) return "bib";
  if (command === "usepackage" || command === "RequirePackage") return "package";
  if (command === "documentclass") return "class";
  if (command.includes("cite") && !command.startsWith("new") && !command.startsWith("declare")) return "cite";
  return null;
}

/** The argument being typed at the end of `before` (the line up to the cursor), or null. */
export function argContext(before: string): ArgContext | null {
  const m = /\\([A-Za-z]+)\*?(?:\[[^\]]*\])*(?:\{[^{}]*\})*\{([^{}]*)$/.exec(before);
  if (!m) return null;
  const command = m[1]!;
  const kind = kindOf(command);
  if (!kind) return null;
  const typed = m[2]!;
  const listed = kind === "cite" || kind === "tex" || kind === "bib" || kind === "package";
  const comma = listed ? typed.lastIndexOf(",") : -1;
  const lead = comma >= 0 ? typed.slice(comma + 1).length - typed.slice(comma + 1).trimStart().length : 0;
  const start = before.length - typed.length + (comma >= 0 ? comma + 1 + lead : 0);
  return { kind, command, from: start, prefix: before.slice(start) };
}

/** The cursor is after a `%` that starts a comment. */
export const inComment = (before: string): boolean => /(^|[^\\])%/.test(before);

/** The `\command` being typed at the end of `before`, without the backslash, or null (also null after `\\`). */
export function commandBeingTyped(before: string): { from: number; name: string } | null {
  const m = /\\([A-Za-z@]*)$/.exec(before);
  if (!m) return null;
  const at = before.length - m[0].length;
  if (at > 0 && before[at - 1] === "\\") return null;
  return { from: at, name: m[1]! };
}

/** Environments opened and not yet closed in `text`, innermost last. Reads the last `limit` characters only. */
export function openEnvironments(text: string, limit = 40_000): string[] {
  const part = text.length > limit ? text.slice(text.length - limit) : text;
  const stack: string[] = [];
  for (const m of part.matchAll(/(?<!\\)\\(begin|end)\{([^{}]+)\}/g)) {
    if (m[1] === "begin") stack.push(m[2]!);
    else {
      const at = stack.lastIndexOf(m[2]!);
      if (at >= 0) stack.length = at;
    }
  }
  return stack;
}
