// An AI answer for a comparison, read line by line: what it quotes from the
// passages is set apart from what it wrote itself, and anything that does not
// check out (a quotation not found in the passages, a key that is no reference
// or was not among the papers sent) is said under the line it belongs to.

import type { AnswerLine } from "./ai-compare";

export function AnswerView({ lines }: { lines: readonly AnswerLine[] }) {
  // Runs of lines of one kind are drawn as one block, each with its name.
  const blocks: { kind: "quote" | "generated"; lines: AnswerLine[] }[] = [];
  for (const line of lines) {
    if (line.kind === "blank") {
      continue;
    }
    const last = blocks.at(-1);
    if (last && last.kind === line.kind) last.lines.push(line);
    else blocks.push({ kind: line.kind, lines: [line] });
  }
  return (
    <div className="flex flex-col gap-2" aria-label="The AI's answer">
      {blocks.map((block, i) =>
        block.kind === "quote" ? (
          <blockquote key={i} data-kind="quote" className="rounded border-l-4 border-accent bg-well px-3 py-1.5 text-13">
            <p className="text-11 font-medium text-muted">Quoted from the source</p>
            {block.lines.map((line, j) => (
              <Line key={j} line={line} />
            ))}
          </blockquote>
        ) : (
          <div key={i} data-kind="generated" className="rounded bg-soft px-3 py-1.5 text-13">
            <p className="text-11 font-medium text-muted">Written by AI, to check</p>
            {block.lines.map((line, j) => (
              <Line key={j} line={line} />
            ))}
          </div>
        ),
      )}
    </div>
  );
}

function Line({ line }: { line: AnswerLine }) {
  return (
    <div className="mt-0.5">
      <p className="whitespace-pre-wrap break-words">{line.text}</p>
      {line.problems.map((problem) => (
        <p key={problem} role="note" className="text-12 text-danger">
          {problem}
        </p>
      ))}
    </div>
  );
}
