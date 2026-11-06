// Ready-made blocks: an agenda, a quote, a key number, a timeline, a team, a comparison and a 2 by 2. Each is a group of ordinary
// shapes and text boxes, drawn in the theme's own colours and text styles (theme colour names, never fixed colours), so it follows a
// change of theme and every part can be edited once it is on the slide. The words are samples to write over.

import type { Element } from "@kasten-slides/wasm";

export type BlockKind = "agenda" | "quote" | "key-number" | "timeline" | "team" | "comparison" | "two-by-two";

export interface BlockSpec {
  kind: BlockKind;
  label: string;
  description: string;
  keywords: readonly string[];
  /** The share of the slide's width and height it takes, as a fraction. */
  size: { w: number; h: number };
}

/** The blocks, in the order they are listed. */
export const BLOCKS: readonly BlockSpec[] = [
  { kind: "agenda", label: "Agenda", description: "A numbered list of the parts of the talk", keywords: ["contents", "outline", "list", "numbered"], size: { w: 0.7, h: 0.7 } },
  { kind: "quote", label: "Quote", description: "A large quotation with who said it", keywords: ["testimonial", "saying", "citation"], size: { w: 0.7, h: 0.5 } },
  { kind: "key-number", label: "Key number", description: "One big figure with a line saying what it is", keywords: ["statistic", "kpi", "figure", "metric", "percent"], size: { w: 0.5, h: 0.5 } },
  { kind: "timeline", label: "Timeline", description: "Four dated points along a line", keywords: ["roadmap", "history", "dates", "milestones", "schedule"], size: { w: 0.85, h: 0.4 } },
  { kind: "team", label: "Team", description: "Three people, each with a name and a role", keywords: ["people", "staff", "about us", "members"], size: { w: 0.8, h: 0.5 } },
  { kind: "comparison", label: "Comparison", description: "Two columns side by side, each with a heading", keywords: ["versus", "vs", "before after", "pros cons", "two columns"], size: { w: 0.85, h: 0.65 } },
  { kind: "two-by-two", label: "2 × 2 grid", description: "Four boxes in two rows, for a matrix or four ideas", keywords: ["matrix", "quadrant", "four", "grid", "swot"], size: { w: 0.75, h: 0.7 } },
];

export const blockSpec = (kind: BlockKind): BlockSpec => BLOCKS.find((block) => block.kind === kind) as BlockSpec;

/** Where a block goes: slide units. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Part {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A place inside the region, given as percentages of it. */
const within = (region: Region, x: number, y: number, w: number, h: number): Part => ({
  x: Math.round(region.x + (region.w * x) / 100),
  y: Math.round(region.y + (region.h * y) / 100),
  w: Math.round((region.w * w) / 100),
  h: Math.round((region.h * h) / 100),
});

interface Words {
  /** One paragraph for each line. */
  lines: string[];
  /** A theme text style; the body's when left out. */
  style?: string;
  /** Points at the size of a 960-wide slide; scaled to the region. */
  size?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  list?: "bullet";
}

const textOf = (part: Part, words: Words, scale: number, name?: string): Element =>
  ({
    type: "text",
    id: "",
    ...part,
    ...(name ? { name } : {}),
    text: {
      valign: words.valign ?? "top",
      paragraphs: words.lines.map((line) => ({
        style: words.style ?? "body",
        ...(words.align ? { align: words.align } : {}),
        ...(words.list ? { list: words.list } : {}),
        runs: [
          {
            t: line,
            ...(words.size ? { size: Math.max(8, Math.round(words.size * scale)) } : {}),
            ...(words.color ? { color: words.color } : {}),
            ...(words.bold ? { b: true } : {}),
            ...(words.italic ? { i: true } : {}),
          },
        ],
      })),
    },
  }) as Element;

const shapeOf = (shape: string, part: Part, fill: string, extra: Record<string, unknown> = {}): Element =>
  ({ type: "shape", id: "", shape, ...part, style: { fill: { color: fill }, ...(shape === "roundRect" ? { radius: 12 } : {}) }, ...extra }) as Element;

/** A shape that holds words (a numbered disc, a heading band). */
function labelled(shape: string, part: Part, fill: string, words: Words, scale: number): Element {
  const base = shapeOf(shape, part, fill) as Element & { text?: unknown };
  const holder = textOf(part, { ...words, valign: words.valign ?? "middle", align: words.align ?? "center" }, scale) as Element & { text: unknown };
  return { ...base, text: holder.text } as Element;
}

const lineOf = (part: Part, color: string): Element => ({ type: "line", id: "", ...part, style: { stroke: { color, width: 3 } } }) as unknown as Element;

type Builder = (region: Region, scale: number) => Element[];

const agenda: Builder = (r, k) => [
  textOf(within(r, 0, 0, 100, 16), { lines: ["Agenda"], style: "title", valign: "middle" }, k),
  ...["Introduction", "The problem", "Our approach", "Next steps"].flatMap((name, i) => {
    const top = 22 + i * 19.5;
    return [
      labelled("ellipse", within(r, 0, top, 9, 16), "accent1", { lines: [String(i + 1)], style: "body", size: 20, bold: true, color: "bg1" }, k),
      textOf(within(r, 13, top, 87, 16), { lines: [name], style: "body", size: 24, valign: "middle" }, k),
    ];
  }),
];

const quote: Builder = (r, k) => [
  textOf(within(r, 0, 0, 14, 30), { lines: ["“"], style: "title", size: 120, color: "accent1" }, k),
  textOf(within(r, 10, 14, 90, 52), { lines: ["Write the quotation here, in a sentence or two."], style: "quote", size: 34, italic: true, valign: "middle" }, k),
  shapeOf("rect", within(r, 10, 72, 10, 1.6), "accent1"),
  textOf(within(r, 10, 78, 90, 16), { lines: ["Name, role"], style: "caption", size: 18 }, k),
];

const keyNumber: Builder = (r, k) => [
  textOf(within(r, 0, 4, 100, 58), { lines: ["42%"], style: "title", size: 110, color: "accent1", bold: true, align: "center", valign: "middle" }, k),
  textOf(within(r, 5, 66, 90, 28), { lines: ["What the number measures, in a line"], style: "body", size: 24, align: "center" }, k),
];

const timeline: Builder = (r, k) => [
  lineOf(within(r, 3, 48, 94, 0), "text2"),
  ...["2022", "2023", "2024", "2025"].flatMap((year, i) => {
    const x = 4 + i * 24;
    const above = i % 2 === 0;
    return [
      shapeOf("ellipse", within(r, x + 8.5, 42, 4.2, 12), "accent1"),
      textOf(within(r, x, above ? 6 : 62, 21, 14), { lines: [year], style: "body", size: 24, bold: true, color: "accent1", align: "center" }, k),
      textOf(within(r, x, above ? 20 : 76, 21, 20), { lines: ["What happened"], style: "caption", size: 16, align: "center" }, k),
    ];
  }),
];

const team: Builder = (r, k) =>
  ["Name Surname", "Name Surname", "Name Surname"].flatMap((name, i) => {
    const x = i * 34;
    return [
      shapeOf("ellipse", within(r, x + 8, 0, 18, 36), "bg2"),
      textOf(within(r, x, 42, 32, 18), { lines: [name], style: "body", size: 22, bold: true, align: "center", valign: "middle" }, k),
      textOf(within(r, x, 62, 32, 16), { lines: ["Role"], style: "caption", size: 16, align: "center" }, k),
    ];
  });

const comparison: Builder = (r, k) =>
  [
    ["Option A", "accent1"],
    ["Option B", "accent2"],
  ].flatMap(([name, fill], i) => {
    const x = i * 52;
    return [
      labelled("roundRect", within(r, x, 0, 48, 16), fill as string, { lines: [name as string], style: "body", size: 24, bold: true, color: "bg1" }, k),
      textOf(within(r, x + 2, 22, 44, 78), { lines: ["First point", "Second point", "Third point"], style: "body", size: 20, list: "bullet" }, k),
    ];
  });

const twoByTwo: Builder = (r, k) =>
  [0, 1, 2, 3].flatMap((i) => {
    const x = (i % 2) * 51;
    const y = Math.floor(i / 2) * 51;
    return [
      shapeOf("roundRect", within(r, x, y, 49, 49), "bg2"),
      textOf(within(r, x + 3, y + 3, 43, 12), { lines: [`Heading ${i + 1}`], style: "body", size: 22, bold: true, color: "accent1" }, k),
      textOf(within(r, x + 3, y + 16, 43, 30), { lines: ["A line or two about it"], style: "body", size: 18 }, k),
    ];
  });

const BUILDERS: Record<BlockKind, Builder> = { agenda, quote, "key-number": keyNumber, timeline, team, comparison, "two-by-two": twoByTwo };

/** A block as one group in `region`: its parts keep their places on the slide and can be edited after "Ungroup" or by going into the group. */
export function blockElement(kind: BlockKind, region: Region, slideWidth: number): Element {
  const scale = Math.max(0.3, slideWidth / 960);
  const children = BUILDERS[kind](region, scale);
  return { type: "group", id: "", ...region, name: blockSpec(kind).label, children } as unknown as Element;
}
