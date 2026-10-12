// The words of a text box, drawn. It is a plain function of its props (no
// hooks), so it renders to static markup as well as on a page, and it draws
// with the same styles and elements the editor does.

import type { Insets, Paragraph, Run, Text, Theme, VAlign } from "@kasten-slides/wasm";
import { type CSSProperties, type JSX, type ReactNode, type Ref, createElement } from "react";

import { colorOf } from "../theme/index.ts";
import { boxCss } from "./box-style.ts";
import type { Geometry } from "./lists.ts";
import { markerTexts } from "./lists.ts";
import { wrapsOfRun } from "./marks.ts";
import { paragraphCss, textGeometry } from "./text-style.ts";
import "./text.css";

/** What the fields of a text stand for: the slide's number, how many slides there are, and the step label. */
export interface TextFields {
  slideNumber?: number;
  slideCount?: number;
  stepLabel?: string;
}

export interface TextBlockProps {
  theme: Theme;
  text: Text;
  /** The theme text style the box is set in: "body" for a plain box, the placeholder's style otherwise. */
  baseStyle: string;
  /** The box size in slide units. */
  width: number;
  height: number;
  /** Space between the box's edge and the text. Default `DEFAULT_INSETS`; the text's own `insets` win. */
  insets?: Insets;
  /** Where the text sits in the box. Default "top"; the text's own `valign` wins. */
  valign?: VAlign;
  /** Values for runs that stand for a field (`slideNumber`, `slideCount`, `stepLabel`). */
  fields?: TextFields;
  /** The step being shown: paragraphs that appear at a later step are hidden but keep their place. */
  step?: number;
  /** Shown dimmed when every run is empty. */
  emptyPrompt?: string;
  className?: string;
  /** How much "shrink text on overflow" has set the type smaller: 1 is as written. The box's insets keep their size. */
  fitScale?: number;
  /** Receives the box element, for whoever measures the words. */
  boxRef?: Ref<HTMLDivElement>;
}

/** What a run shows: a field's value when it stands for one that is given, else its own text. */
function shownText(run: Run, fields: TextFields | undefined): string {
  if (!run.field || !fields) return run.t;
  const value = run.field === "slideNumber" ? fields.slideNumber : run.field === "slideCount" ? fields.slideCount : run.field === "stepLabel" ? fields.stepLabel : undefined;
  return value === undefined ? run.t : String(value);
}

/**
 * One run as a `span`: its words inside an element for each mark, outermost
 * first, as the editor draws it. A run with nothing set is a `span` with
 * nothing on it.
 */
function runNode(theme: Theme, run: Run, fields: TextFields | undefined, key: number): ReactNode {
  const shown = shownText(run, fields);
  if (shown === "") return null;
  const wraps = wrapsOfRun(theme, run);
  if (wraps.length === 0) return createElement("span", { key }, shown);
  return wraps.reduceRight<ReactNode>((inner, wrap, depth) => createElement(wrap.tag, { ...(depth === 0 ? { key } : {}), className: wrap.className, style: wrap.style, ...wrap.attrs }, inner), shown);
}

/** A paragraph that ends in a line break, or has no words, needs a `br` for its last line to take up room. */
function needsBreak(paragraph: Paragraph, fields: TextFields | undefined): boolean {
  for (let i = paragraph.runs.length - 1; i >= 0; i--) {
    const run = paragraph.runs[i];
    const shown = run ? shownText(run, fields) : "";
    if (shown !== "") return shown.endsWith("\n");
  }
  return true;
}

interface ParagraphViewProps {
  theme: Theme;
  baseStyle: string;
  paragraph: Paragraph;
  /** What the list marker shows; null for a paragraph that is not a list item. */
  marker: string | null;
  geometry: Geometry;
  fields: TextFields | undefined;
  step: number | undefined;
}

function ParagraphView({ theme, baseStyle, paragraph, marker, geometry, fields, step }: ParagraphViewProps): JSX.Element {
  return (
    <div className="ks-p" style={paragraphCss(theme, baseStyle, paragraph, { step, geometry })}>
      {marker !== null ? (
        <span className="ks-marker" aria-hidden="true">
          {marker}
        </span>
      ) : null}
      {paragraph.runs.map((run, i) => runNode(theme, run, fields, i))}
      {needsBreak(paragraph, fields) ? <br /> : null}
    </div>
  );
}

/** Whether nothing shows: every run is empty and none stands for a field. */
function isBlank(text: Text): boolean {
  return text.paragraphs.every((paragraph) => paragraph.runs.every((run) => run.t === "" && !run.field));
}

/** The prompt of an empty box: dimmed text in the first paragraph's alignment and style, without a list marker. */
function Prompt({ theme, baseStyle, paragraph, prompt }: { theme: Theme; baseStyle: string; paragraph: Paragraph | undefined; prompt: string }): JSX.Element {
  const plain: Paragraph = { runs: [{ t: prompt }], ...(paragraph?.align ? { align: paragraph.align } : {}), ...(paragraph?.style ? { style: paragraph.style } : {}) };
  const style: CSSProperties = { ...paragraphCss(theme, baseStyle, plain), color: colorOf(theme, "text2"), opacity: 0.5, pointerEvents: "none", userSelect: "none" };
  return (
    <div className="ks-p ks-text-prompt" style={style}>
      {prompt}
    </div>
  );
}

export function TextBlock(props: TextBlockProps): JSX.Element {
  const { theme, text, baseStyle, width, height, insets, valign, fields, step, emptyPrompt, className, fitScale, boxRef } = props;
  const markers = markerTexts(text.paragraphs);
  const geometry = textGeometry(theme, baseStyle, text.paragraphs);
  const showPrompt = emptyPrompt !== undefined && emptyPrompt !== "" && isBlank(text);
  return (
    <div ref={boxRef} className={className ? `ks-text ${className}` : "ks-text"} style={boxCss({ width, height, insets, valign, scale: fitScale }, text)}>
      {showPrompt ? (
        <Prompt theme={theme} baseStyle={baseStyle} paragraph={text.paragraphs[0]} prompt={emptyPrompt} />
      ) : (
        text.paragraphs.map((paragraph, i) => (
          <ParagraphView key={i} theme={theme} baseStyle={baseStyle} paragraph={paragraph} marker={markers[i] ?? null} geometry={geometry[i] ?? { margin: 0, indent: 0 }} fields={fields} step={step} />
        ))
      )}
    </div>
  );
}
