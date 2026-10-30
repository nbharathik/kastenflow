// An answer's Markdown as React elements. Everything is built from the
// parsed blocks and inlines, never from HTML, so markup in an answer shows
// as text. [[Wiki links]] open the page they name; web links open outside,
// with the site they go to beside them when their words don't name it.
// While an answer streams, only the blocks whose source changed draw again.

import "./markdown.css";

import { Fragment, memo, useMemo, useRef, type MouseEvent, type ReactNode } from "react";

import { howFrom, type OpenHow } from "../../workspace/store";
import type { Block, SourcedBlock } from "./blocks";
import { CodeBlock } from "./CodeBlock";
import { parseInline, unsaidDestination, type Inline } from "./inline";
import { MathView } from "./Math";
import { blocksOfParsed, parseMore, type Parsed } from "./stream-blocks";

/** Opens a page by title, as a wiki link asks. */
export type OpenTitle = (title: string, how: OpenHow) => void;

interface Props {
  text: string;
  onOpenTitle: OpenTitle;
}

/** The blocks of `text`, or the text as it is should it ever not parse:
 * an answer is always shown. `prev` is the same answer a frame earlier, so
 * only its end is read again. */
function blocksOf(prev: Parsed | null, text: string): Parsed | SourcedBlock[] {
  try {
    return parseMore(prev, text);
  } catch {
    return [{ type: "code", lang: "", text, src: text }];
  }
}

export const Markdown = memo(function Markdown({ text, onOpenTitle }: Props) {
  const last = useRef<Parsed | null>(null);
  const blocks = useMemo(() => {
    const read = blocksOf(last.current, text);
    last.current = Array.isArray(read) ? null : read;
    return Array.isArray(read) ? read : blocksOfParsed(read);
  }, [text]);
  return (
    <div className="kasten-md">
      {blocks.map((block, i) => (
        <TopBlock key={i} block={block} onOpenTitle={onOpenTitle} />
      ))}
    </div>
  );
});

const TopBlock = memo(
  function TopBlock({ block, onOpenTitle }: { block: SourcedBlock; onOpenTitle: OpenTitle }) {
    return <BlockView block={block} open={onOpenTitle} />;
  },
  (a, b) => a.block.src === b.block.src && a.block.type === b.block.type && a.onOpenTitle === b.onOpenTitle,
);

function BlockView({ block, open }: { block: Block; open: OpenTitle }): ReactNode {
  switch (block.type) {
    case "paragraph":
      return <p>{inlines(parseInline(block.text), open)}</p>;
    case "heading": {
      // Headings sit under the view's own: # is a third level.
      const Tag = `h${Math.min(6, block.level + 2)}` as "h3";
      return <Tag className={`kasten-md-h${Math.min(block.level, 4)}`}>{inlines(parseInline(block.text), open)}</Tag>;
    }
    case "code":
      return <CodeBlock lang={block.lang} text={block.text} />;
    case "math":
      return <MathView tex={block.text} display block />;
    case "rule":
      return <hr />;
    case "quote":
      return (
        <blockquote>
          {block.blocks.map((inner, i) => (
            <BlockView key={i} block={inner} open={open} />
          ))}
        </blockquote>
      );
    case "list": {
      const items = block.items.map((item, i) => {
        // An item of one paragraph shows its text alone, without a paragraph's gaps.
        const only = item.blocks.length === 1 && item.blocks[0]!.type === "paragraph" ? item.blocks[0]!.text : null;
        return (
          <li key={i} className={item.checked === null ? undefined : "is-task"}>
            {item.checked !== null && <input type="checkbox" checked={item.checked} disabled aria-label={item.checked ? "Done" : "Not done"} />}
            {only !== null ? inlines(parseInline(only), open) : item.blocks.map((inner, k) => <BlockView key={k} block={inner} open={open} />)}
          </li>
        );
      });
      return block.ordered ? <ol start={block.start === 1 ? undefined : block.start}>{items}</ol> : <ul>{items}</ul>;
    }
    case "table":
      return (
        <div className="kasten-md-table">
          <table>
            <thead>
              <tr>
                {block.head.map((cell, i) => (
                  <th key={i} style={{ textAlign: block.align[i] ?? undefined }}>
                    {inlines(parseInline(cell), open)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, i) => (
                    <td key={i} style={{ textAlign: block.align[i] ?? undefined }}>
                      {inlines(parseInline(cell), open)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function inlines(nodes: Inline[], open: OpenTitle): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "break":
        return <br key={i} />;
      case "code":
        return <code key={i}>{node.text}</code>;
      case "math":
        return <MathView key={i} tex={node.tex} display={node.display} />;
      case "strong":
        return <strong key={i}>{inlines(node.children, open)}</strong>;
      case "em":
        return <em key={i}>{inlines(node.children, open)}</em>;
      case "del":
        return <del key={i}>{inlines(node.children, open)}</del>;
      case "link": {
        const where = unsaidDestination(node.href, node.children);
        return (
          <Fragment key={i}>
            <a href={node.href} target="_blank" rel="noopener noreferrer" title={node.href}>
              {inlines(node.children, open)}
            </a>
            {where && <span className="kasten-md-where"> ({where})</span>}
          </Fragment>
        );
      }
      case "wiki":
        return (
          <a
            key={i}
            href="#"
            className="kasten-md-wiki"
            title={`Open “${node.title}”`}
            onClick={(event: MouseEvent) => {
              event.preventDefault();
              open(node.title, howFrom(event));
            }}
            onAuxClick={(event: MouseEvent) => {
              if (event.button !== 1) return;
              event.preventDefault();
              open(node.title, "tab");
            }}
          >
            {node.label}
          </a>
        );
    }
  });
}
