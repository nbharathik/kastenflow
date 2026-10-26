// The two completion sources of the LaTeX editor. `commandSource` answers after
// a backslash from the static list (filtered by CodeMirror as the word grows,
// never rebuilt). `argumentSource` answers inside braces: labels, citation
// keys, files, environment names, packages. Both look only at the cursor's line
// before the cursor and say nothing in comments, so a keystroke costs a regex.

import { type Completion, type CompletionContext, type CompletionResult, snippet, snippetCompletion } from "@codemirror/autocomplete";

import { assist } from "./binding";
import { allCommands } from "./commands";
import { argContext, commandBeingTyped, inComment, openEnvironments } from "./context";
import { ENVIRONMENTS, environmentNamed, environmentTail, environmentTemplate } from "./environments";
import { CLASSES, PACKAGES } from "./packages";

let commandOptions: Completion[] | null = null;

/** The completion options for every command and `\begin{environment}`, built on first use. */
export function commands(): Completion[] {
  if (commandOptions) return commandOptions;
  commandOptions = [
    ...allCommands().map((c) => snippetCompletion(c.template, { label: `\\${c.name}`, detail: c.detail, type: c.kind === "constant" ? "constant" : c.kind === "keyword" ? "keyword" : "function" })),
    ...ENVIRONMENTS.map((e) => snippetCompletion(environmentTemplate(e), { label: `\\begin{${e.name}}`, detail: "environment", type: "type", boost: -1 })),
  ];
  return commandOptions;
}

const lineBefore = (context: CompletionContext): { from: number; before: string } => {
  const line = context.state.doc.lineAt(context.pos);
  return { from: line.from, before: line.text.slice(0, context.pos - line.from) };
};

export function commandSource(context: CompletionContext): CompletionResult | null {
  const { from, before } = lineBefore(context);
  if (inComment(before)) return null;
  const typed = commandBeingTyped(before);
  if (!typed || (typed.name === "" && !context.explicit)) return null;
  return { from: from + typed.from, options: commands(), validFor: /^\\[A-Za-z@]*$/ };
}

const plain = (names: readonly string[], type: string): Completion[] => names.map((label) => ({ label, type }));

/** Completes an environment name after `\begin{`: the name, its closing brace, a body and the matching `\end`. */
function beginOptions(): Completion[] {
  return ENVIRONMENTS.map((e) => ({
    label: e.name,
    type: "type",
    apply: (view, completion, from, to) => {
      const end = view.state.sliceDoc(to, to + 1) === "}" ? to + 1 : to;
      snippet(environmentTail(environmentNamed(e.name)))(view, completion, from, end);
    },
  }));
}

export async function argumentSource(context: CompletionContext): Promise<CompletionResult | null> {
  const { from: lineFrom, before } = lineBefore(context);
  if (inComment(before)) return null;
  const arg = argContext(before);
  if (!arg) return null;
  const from = lineFrom + arg.from;
  const index = assist.current?.index;
  const valid = /^[^{},\s]*$/;
  switch (arg.kind) {
    case "ref": {
      if (!index) return null;
      const labels = await index.labels();
      return { from, validFor: valid, options: labels.map((l) => ({ label: l.key, detail: `${l.file}:${l.line}`, info: l.context || undefined, type: "variable" })) };
    }
    case "cite": {
      if (!index) return null;
      const cites = await index.cites();
      return { from, validFor: valid, options: cites.map((c) => ({ label: c.key, detail: c.detail, info: c.title || undefined, type: "text" })) };
    }
    case "environment": {
      if (arg.command === "begin") return { from, validFor: valid, options: beginOptions() };
      // `\end{`: the open environments first, the innermost on top.
      const open = openEnvironments(context.state.sliceDoc(0, lineFrom));
      const rest = ENVIRONMENTS.map((e) => e.name).filter((n) => !open.includes(n));
      return { from, validFor: valid, options: [...open.reverse().map((label, at) => ({ label, type: "type", boost: 99 - at })), ...plain(rest, "type")] };
    }
    case "image":
      return index ? { from, validFor: valid, options: plain(index.files("image"), "file") } : null;
    case "tex":
      return index ? { from, validFor: valid, options: plain(index.files("tex"), "file") } : null;
    case "bib":
      return index ? { from, validFor: valid, options: plain(index.files("bib", arg.command === "addbibresource"), "file") } : null;
    case "package":
      return { from, validFor: valid, options: plain(PACKAGES, "namespace") };
    case "class":
      return { from, validFor: valid, options: plain(CLASSES, "namespace") };
  }
}
