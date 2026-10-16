// Annotations: comments on a page and highlights on a captured web page (the
// shapes of kasten-core's annotation ops, serde camelCase) and the calls the
// app makes. Both are kept in files beside the page (`<page>.comments.json`,
// `<page>.highlights.json`) that go wherever the page goes; neither ever
// changes the page's Markdown.

import type { DraftRule } from "./draft-rule";

/** Where a comment sits: a section (its title, and which section of that title, from 1) and optionally the words it is about. */
export interface CommentAnchor {
  /** The section's title; empty for the page as a whole. */
  section: string;
  /** Which section of that title, from 1. */
  nth: number;
  quote?: string;
  /** The words just before the quote. */
  prefix?: string;
  /** The words just after the quote. */
  suffix?: string;
}

export interface CommentResolved {
  at: string;
  by: string;
}

/** A comment on a page. */
export interface PageComment {
  id: string;
  anchor: CommentAnchor;
  text: string;
  /** `you`, or `agent:<client>` for an agent's comment. */
  author: string;
  created: string | null;
  /** Set once resolved; a resolved comment can be opened again. */
  resolved: CommentResolved | null;
}

export interface NewComment {
  anchor: CommentAnchor;
  text: string;
}

/** Where a highlight is: the words, what stands around them, and the section they were in. */
export interface TextAnchor {
  quote: string;
  prefix?: string;
  suffix?: string;
  section?: string;
}

/** The colours a highlight comes in: the PDF reader's. */
export const TEXT_HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink", "purple"] as const;
export type TextHighlightColor = (typeof TEXT_HIGHLIGHT_COLORS)[number];

/** A highlight on the words of a captured page. */
export interface TextHighlight {
  id: string;
  anchor: TextAnchor;
  color: string;
  comment: string | null;
  created: string | null;
}

export interface NewTextHighlight {
  anchor: TextAnchor;
  color: string;
  comment?: string;
}

/** A change to a highlight: each field given replaces the old value; an empty comment removes it. */
export interface TextHighlightEdit {
  color?: string;
  comment?: string;
}

/** What the core keeps: the most characters a comment, a quote and the context around it can hold, and how many a page keeps. */
export const ANNOTATION_LIMITS = { comment: 10_000, quote: 2_000, highlightQuote: 5_000, context: 200, section: 300, comments: 2_000, highlights: 5_000 } as const;

export interface AnnotationOps {
  /** The comments on a page, in the order they were made, resolved ones included. */
  comments(page: string): Promise<PageComment[]>;
  /** Adds a comment (signed `you`). One change that Undo takes back; the page itself is not touched. */
  addComment(page: string, comment: NewComment): Promise<PageComment>;
  /** Resolves a comment, or with `resolved` false opens it again. */
  resolveComment(page: string, id: string, resolved: boolean): Promise<PageComment>;
  /** Attaches a comment to another place on the page, as when the words it was about changed. There is no delete. */
  reanchorComment(page: string, id: string, anchor: CommentAnchor): Promise<PageComment>;
  /** The highlights on a captured page, in the order they were made. */
  textHighlights(note: string): Promise<TextHighlight[]>;
  /** Highlights words of a captured page. */
  addTextHighlight(note: string, highlight: NewTextHighlight): Promise<TextHighlight>;
  /** Changes a highlight's colour or comment. */
  editTextHighlight(note: string, id: string, edit: TextHighlightEdit): Promise<TextHighlight>;
  /** Gives a highlight a new place (its quote and what stands around it). */
  moveTextHighlight(note: string, id: string, anchor: TextAnchor): Promise<TextHighlight>;
  /** Takes a highlight off the page; history keeps it. */
  removeTextHighlight(note: string, id: string): Promise<void>;
}

/** What a call about a draft does, for each call of `AnnotationOps`. A draft has no page yet, so it has no annotations: they are empty, and writing one makes the page first. */
export const ANNOTATION_RULES = {
  comments: { empty: () => [] },
  addComment: "make",
  resolveComment: "make",
  reanchorComment: "make",
  textHighlights: { empty: () => [] },
  addTextHighlight: "make",
  editTextHighlight: "make",
  moveTextHighlight: "make",
  removeTextHighlight: "make",
} as const satisfies Record<keyof AnnotationOps, DraftRule>;
