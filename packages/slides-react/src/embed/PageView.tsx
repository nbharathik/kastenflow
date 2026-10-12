// A page of the host drawn as a page: its words, lists, quotes, code, formulas, pictures and tables, in the deck's own fonts and
// colours. It is made from the blocks the engine reads out of the page's Markdown, with React's own elements: nothing the page says is
// ever put in as HTML (a formula is KaTeX's output for LaTeX that is not trusted), and no script can come of it.

import "katex/dist/katex.min.css";
import type { Block, Run, Theme } from "@kasten-slides/wasm";
import { pageBlocks } from "@kasten-slides/wasm";
import { type CSSProperties, type JSX, type KeyboardEvent, type ReactNode } from "react";

import type { ImageUrl } from "../render/index.ts";
import { renderMath } from "../render/math.ts";
import { safeLink } from "../text/links.ts";
import { colorOf, fontStack } from "../theme/index.ts";
import "./embed.css";

export interface PageViewProps {
  markdown: string;
  /** The deck's theme, whose fonts and colours the page is set in. Without one the page takes the colours and fonts round it (`--pv-ink` and the like can be set on a parent). */
  theme?: Theme | undefined;
  imageUrl?: ImageUrl | undefined;
  /** The page may be scrolled (it is being used, not just looked at). */
  scroll?: boolean;
  /** A link of the page was followed: its address (`page:...`, a web address, or `slide:...`). */
  onLink?: ((href: string) => void) | undefined;
}

const MARKS = (run: Run): CSSProperties => ({
  ...(run.b ? { fontWeight: 700 } : {}),
  ...(run.i ? { fontStyle: "italic" } : {}),
  ...((run.u || run.s) && !run.link ? { textDecoration: [run.u ? "underline" : "", run.s ? "line-through" : ""].filter(Boolean).join(" ") } : {}),
  ...(run.s && run.link ? { textDecoration: "underline line-through" } : {}),
});

function Runs({ runs, theme, onLink }: { runs: readonly Run[]; theme: Theme | undefined; onLink: PageViewProps["onLink"] }): JSX.Element {
  return (
    <>
      {runs.map((run, i) => {
        if (run.math) {
          const made = renderMath(run.t, true);
          return made.ok ? <span key={i} dangerouslySetInnerHTML={{ __html: made.html }} /> : <code key={i}>{run.t}</code>;
        }
        const style: CSSProperties = { ...MARKS(run), ...(run.color && theme ? { color: colorOf(theme, run.color) } : {}) };
        const body: ReactNode = run.code ? <code className="ks-pv-code">{run.t}</code> : run.t;
        // Only addresses that may be followed make a link (a page of the vault, the web, mail, a slide): a script is only words.
        const link = safeLink(run.link);
        if (link && onLink) {
          const open = () => onLink(link);
          return (
            <span
              key={i}
              role="link"
              tabIndex={0}
              className="ks-pv-link"
              data-href={link}
              style={style}
              onClick={(event) => {
                event.stopPropagation();
                open();
              }}
              onKeyDown={(event: KeyboardEvent) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  open();
                }
              }}
            >
              {body}
            </span>
          );
        }
        return Object.keys(style).length > 0 ? (
          <span key={i} style={style}>
            {body}
          </span>
        ) : (
          <span key={i}>{body}</span>
        );
      })}
    </>
  );
}

/** The marker at the start of an item: a bullet, its number among the items of its list, or a box for a to-do. */
function markOf(block: Extract<Block, { type: "item" }>, number: number): string {
  if (block.checked !== null && block.checked !== undefined) return block.checked ? "☑" : "☐";
  if (!block.ordered) return block.level === 0 ? "•" : block.level === 1 ? "◦" : "▪";
  return `${number || 1}.`;
}

/** Numbers each ordered item among its siblings: a list starts again at 1 after anything that is not an item, and a deeper list after its parent. */
function numbering(blocks: readonly Block[]): number[] {
  const counts: number[] = [];
  const numbers: number[] = [];
  for (const block of blocks) {
    if (block.type !== "item") {
      counts.length = 0;
      numbers.push(0);
      continue;
    }
    counts.length = block.level + 1;
    counts[block.level] = block.ordered ? (counts[block.level] ?? 0) + 1 : 0;
    numbers.push(counts[block.level] ?? 0);
  }
  return numbers;
}

/** The page as a page. */
export function PageView({ markdown, theme, imageUrl, scroll = false, onLink }: PageViewProps): JSX.Element {
  const blocks = pageBlocks(markdown);
  const numbers = numbering(blocks);
  const vars = (
    theme
      ? {
          "--pv-ink": colorOf(theme, "text1"),
          "--pv-muted": colorOf(theme, "text2"),
          "--pv-accent": colorOf(theme, "accent1"),
          "--pv-line": colorOf(theme, "text2", 0.4),
          "--pv-wash": colorOf(theme, "text2", 0.12),
          "--pv-mono": fontStack(theme, "code"),
          background: colorOf(theme, "bg1"),
          fontFamily: fontStack(theme, "body"),
        }
      : {}
  ) as CSSProperties;
  const runs = (list: readonly Run[]) => <Runs runs={list} theme={theme} onLink={onLink} />;
  return (
    <div className="ks-pv" style={vars} data-scroll={scroll || undefined} data-testid="page-view">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "heading": {
            const Tag = `h${Math.min(Math.max(block.level, 1), 6)}` as "h1";
            return (
              <Tag key={i} style={theme ? { fontFamily: fontStack(theme, "heading") } : undefined}>
                {runs(block.runs)}
              </Tag>
            );
          }
          case "paragraph":
            return <p key={i}>{runs(block.runs)}</p>;
          case "item":
            return (
              <div key={i} className="ks-pv-item" style={{ marginLeft: `${block.level * 1.4}em` }}>
                <span className="ks-pv-mark" aria-hidden="true">
                  {markOf(block, numbers[i] ?? 1)}
                </span>
                <span>{runs(block.runs)}</span>
              </div>
            );
          case "quote":
            return (
              <blockquote key={i} className="ks-pv-quote" data-callout={block.callout ?? undefined}>
                {runs(block.runs)}
              </blockquote>
            );
          case "code":
            return (
              <pre key={i} data-language={block.language || undefined}>
                <code>{block.code}</code>
              </pre>
            );
          case "math": {
            const made = renderMath(block.latex, false);
            return made.ok ? <div key={i} className="ks-pv-math" dangerouslySetInnerHTML={{ __html: made.html }} /> : <pre key={i}>{block.latex}</pre>;
          }
          case "image": {
            const url = imageUrl?.(block.src);
            return url ? <img key={i} src={url} alt={block.alt} /> : null;
          }
          case "table":
            return (
              <table key={i}>
                <tbody>
                  {block.rows.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, c) => {
                        const Cell = block.header && r === 0 ? "th" : "td";
                        return <Cell key={c}>{runs(cell)}</Cell>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          case "rule":
            return <hr key={i} />;
        }
      })}
    </div>
  );
}
