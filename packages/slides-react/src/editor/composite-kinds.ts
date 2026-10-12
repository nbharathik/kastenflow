// The twelve kinds of composite element, as the editor offers them: what each is
// called, how big it starts, and what it holds when it is first made.

import type { Element, PageSource } from "@kasten-slides/wasm";

import { DEFAULT_DESIGN, PAGE_DESIGN, boxFor } from "../embed/scale.ts";
import type { Corner } from "./placement.ts";
import type { IconName } from "./ui/icons.ts";

export type CompositeKind = "code" | "math" | "chat" | "token-probs" | "card-grid" | "citation" | "step-label" | "embed" | "video" | "chart" | "timer" | "qr";

/** Every composite kind, in the order the Insert menu lists them. */
export const COMPOSITE_TYPES: readonly CompositeKind[] = ["code", "math", "chat", "token-probs", "card-grid", "citation", "step-label", "embed", "video", "chart", "timer", "qr"];

export interface CompositeSpec {
  kind: CompositeKind;
  /** What the Insert menu and the format panel call it. */
  label: string;
  icon: IconName;
  /** How big it starts, in slide units. */
  size: { w: number; h: number };
  /** Other words a person may look for it by. */
  keywords: readonly string[];
  /** Kinds that cannot be made without an address, a file or a choice say which dialog asks for it. */
  asks?: "embed" | "video" | "citation";
  /** A small kind that belongs at the edge of the slide goes in this corner, if it is free. */
  corner?: Corner;
  /**
   * A kind the engine draws and a deck may hold, but that the editor has no way to make or change yet: it is not offered in the
   * Insert menu, the palette or the gallery. (A chart, a timer and a QR code come from agents and files until their options are built.)
   */
  unlisted?: boolean;
}

export const COMPOSITES: readonly CompositeSpec[] = [
  { kind: "code", label: "Code block", icon: "code", size: { w: 640, h: 240 }, keywords: ["source", "program", "syntax", "snippet", "programming"] },
  { kind: "math", label: "Formula", icon: "sigma", size: { w: 480, h: 120 }, keywords: ["equation", "latex", "katex", "maths", "math"] },
  { kind: "chat", label: "Conversation", icon: "message-square", size: { w: 640, h: 340 }, keywords: ["chat", "messages", "dialogue", "prompt", "llm"] },
  { kind: "token-probs", label: "Token probabilities", icon: "chart-no-axes-column", size: { w: 640, h: 340 }, keywords: ["tokens", "next word", "logits", "llm", "bars"] },
  { kind: "card-grid", label: "Card grid", icon: "layout-dashboard", size: { w: 840, h: 230 }, keywords: ["cards", "tiles", "boxes"] },
  { kind: "citation", label: "Citation…", icon: "quote", size: { w: 360, h: 32 }, keywords: ["reference", "bibliography", "cite", "bibtex", "paper", "source"], corner: "bottom-left", asks: "citation" },
  { kind: "step-label", label: "Step label", icon: "captions", size: { w: 140, h: 32 }, keywords: ["step", "counter", "progress"], corner: "bottom-right" },
  { kind: "embed", label: "Web page…", icon: "globe", size: { w: 640, h: 400 }, keywords: ["web page", "website", "iframe", "url", "live"], asks: "embed" },
  { kind: "video", label: "Video…", icon: "film", size: { w: 640, h: 360 }, keywords: ["movie", "clip", "mp4", "media"], asks: "video" },
  { kind: "chart", label: "Chart", icon: "chart-column", size: { w: 640, h: 360 }, keywords: ["graph", "bar", "line", "pie", "plot", "data", "numbers", "statistics"], unlisted: true },
  { kind: "timer", label: "Timer", icon: "timer", size: { w: 360, h: 180 }, keywords: ["countdown", "clock", "stopwatch", "minutes", "time"], unlisted: true },
  { kind: "qr", label: "QR code", icon: "qr-code", size: { w: 300, h: 300 }, keywords: ["barcode", "scan", "link", "url", "phone"], unlisted: true },
];

/** The kinds the editor offers to insert: every one but those it cannot make yet. */
export const INSERTABLE: readonly CompositeSpec[] = COMPOSITES.filter((spec) => !spec.unlisted);

export const compositeSpec = (kind: CompositeKind): CompositeSpec => COMPOSITES.find((spec) => spec.kind === kind) as CompositeSpec;

/** Whether an element's type is one of the twelve. */
export const isCompositeType = (type: string): type is CompositeKind => (COMPOSITE_TYPES as readonly string[]).includes(type);

/** The kinds of chart the Insert menu offers. */
export type ChartKind = "bar" | "line" | "pie";

/** What an embedded page, a video, a chart or a QR code is made from. */
export interface Source {
  /** The address of the page, or of the video (or the name of a file the host holds); what a QR code holds. */
  address?: string;
  /** What a page is called. */
  title?: string;
  /** The page of the host an embed shows, for a page of Kasten in place of a web address. */
  page?: PageSource;
  /** Which chart. */
  chart?: ChartKind;
}

const PYTHON = ["def fib(n):", "    a, b = 0, 1", "    for _ in range(n):", "        a, b = b, a + b", "    return a", "print(fib(10))"].join("\n");

/** What a new chart holds to be looked at and changed: the table of numbers is in the format options. */
function sampleChart(kind: ChartKind): Element {
  const categories = ["Q1", "Q2", "Q3", "Q4"];
  const series = kind === "pie" ? [{ name: "Share", values: [40, 25, 20, 15] }] : [{ name: "2025", values: [12, 19, 8, 14] }, { name: "2026", values: [15, 17, 11, 16] }];
  return { type: "chart", id: "", kind, title: kind === "pie" ? "Share of the total" : "Sales by quarter", categories, series, labels: kind === "pie" } as Element;
}

/**
 * A new composite of a kind, filled with something to look at and then change,
 * without an id (the engine gives it one) or a box (the caller places it).
 */
export function newComposite(kind: CompositeKind, { address = "", title, page, chart = "bar" }: Source = {}): Element {
  switch (kind) {
    case "code":
      return { type: "code", id: "", language: "python", code: PYTHON, theme: "dark" } as Element;
    case "math":
      return { type: "math", id: "", latex: "E = mc^2" } as Element;
    case "chat":
      return {
        type: "chat",
        id: "",
        messages: [
          { role: "system", text: "You are a helpful assistant." },
          { role: "user", text: "What is the capital of France?" },
          { role: "assistant", text: "The capital of France is Paris." },
        ],
      } as Element;
    case "token-probs":
      return {
        type: "token-probs",
        id: "",
        tokens: ["The", " cat", " sat", " on", " the"],
        next: [
          { token: " mat", p: 0.42 },
          { token: " floor", p: 0.3 },
          { token: " sofa", p: 0.14 },
          { token: " bed", p: 0.09 },
          { token: " roof", p: 0.05 },
        ],
        chosen: 0,
      } as Element;
    case "card-grid":
      return {
        type: "card-grid",
        id: "",
        cards: [
          { title: "Plan", body: "Break the goal into steps." },
          { title: "Act", body: "Call a tool with an input." },
          { title: "Observe", body: "Read what came back." },
        ],
      } as Element;
    case "citation":
      return { type: "citation", id: "", keys: [] } as Element;
    case "step-label":
      return { type: "step-label", id: "" } as Element;
    case "embed":
      // A page of the host is laid out narrower (so its words read from a room); a web page as a desktop window.
      return page
        ? ({ type: "embed", id: "", url: "", ...(title ? { title } : {}), design: { ...PAGE_DESIGN }, source: page } as Element)
        : ({ type: "embed", id: "", url: address, ...(title ? { title } : {}), design: { ...DEFAULT_DESIGN } } as Element);
    case "video":
      return { type: "video", id: "", src: address } as Element;
    case "chart":
      return sampleChart(chart);
    case "timer":
      return { type: "timer", id: "", seconds: 300, label: "Time left" } as Element;
    case "qr":
      return { type: "qr", id: "", data: address } as Element;
  }
}

/** The size a new embed starts at: the shape of the window the page is laid out for, 640 wide. */
export const embedSize = (page: boolean): { w: number; h: number } => boxFor(page ? PAGE_DESIGN : DEFAULT_DESIGN, 640);
