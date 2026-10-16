// What a check before an export or a presentation finds, and what it asks to be told.

/** What the deck is about to become. */
export type PreflightFormat = "pptx" | "pdf" | "png" | "markdown" | "html" | "present";

/** A thing to look at before going on. */
export interface PreflightIssue {
  /** Tells it from the others of the report. */
  id: string;
  /** An error is something that will be wrong in the result (a missing picture, text past the edge); a warning is something that will be different. */
  severity: "error" | "warning";
  /** The rule: a lint rule (`off-slide`, `text-overflow`, `font-missing`, `unresolved-citation`, `broken-link`, `pptx-unsafe`) or one of preflight's own (`missing-image`, `missing-page`, `needs-poster`, `unreachable`). */
  rule: string;
  /** The slide it is on; null for something of the theme (its logo, a layout's picture), which no slide shows. */
  slide: string | null;
  /** The element on that slide. */
  element: string | null;
  message: string;
  hint?: string;
}

/** What a format cannot keep as it is, and what it keeps instead. */
export interface Reduction {
  id: string;
  /** What there is in the deck: "Slides with steps". */
  what: string;
  /** What it becomes in the result. */
  becomes: string;
  /** How many there are. */
  count: number;
  /** The slides they are on. */
  slides: string[];
}

export interface PreflightReport {
  format: PreflightFormat;
  errors: PreflightIssue[];
  warnings: PreflightIssue[];
  reductions: Reduction[];
  /** What was not checked, and why: web addresses (unless a network check was asked for), rules that could not run here. */
  unchecked: string[];
}

export interface PreflightOptions {
  /** Run the lint of the whole deck (the default). Off, only what the host can say is looked at, which is quick. */
  lint?: boolean;
  /** Look at the web addresses of embedded pages and pictures from the web: whether they can be reached from here. Off unless the person asks. */
  network?: boolean;
  /** How the addresses are reached when `network` is on: true when something answers. The page's own `fetch` when left out. */
  reach?: (address: string) => Promise<boolean>;
}
