// A fenced code block of an answer: the language, Copy, and the code. Known
// languages (JavaScript, TypeScript, HTML, CSS) are coloured once the
// highlighter has loaded; until then, and for the rest, the code is plain.

import { useEffect, useState } from "react";

import type { Run } from "./highlight-code";

type Highlighter = typeof import("./highlight-code");

let loading: Promise<Highlighter> | null = null;
let loaded: Highlighter | null = null;

const loadHighlighter = (): Promise<Highlighter> => (loading ??= import("./highlight-code").then((m) => (loaded = m)));

/** The languages the highlighter knows, without loading it (the names are repeated here on purpose: a block in another language never loads CodeMirror). */
const KNOWN = /^(?:js|javascript|mjs|cjs|json|jsx|ts|typescript|tsx|html|xml|svg|css)$/i;

export function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const wanted = KNOWN.test(lang);
  const [coloured, setColoured] = useState<{ lang: string; text: string; runs: Run[] } | null>(null);

  useEffect(() => {
    if (!wanted) return;
    let alive = true;
    const show = (h: Highlighter) => {
      const runs = h.highlight(lang, text);
      if (alive && runs) setColoured({ lang, text, runs });
    };
    if (loaded) show(loaded);
    else void loadHighlighter().then(show);
    return () => {
      alive = false;
    };
  }, [wanted, lang, text]);

  // Colours of an older frame of a streaming block are not shown on newer text.
  const runs = coloured && coloured.lang === lang && coloured.text === text ? coloured.runs : null;
  return (
    <div className="kasten-md-code">
      <div className="kasten-md-code-bar">
        <span>{lang || "code"}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>
          {runs
            ? runs.map((run, i) =>
                run.cls ? (
                  <span key={i} className={run.cls}>
                    {run.text}
                  </span>
                ) : (
                  run.text
                ),
              )
            : text}
        </code>
      </pre>
    </div>
  );
}
