// What a host gives the editor to show a web page beside a slide or over a presentation. The page is drawn by the host in a view of its
// own (a native web view in the desktop app), placed over a box this package draws: the panel here owns the toolbar, the sizes and the
// order of the Escape key, and tells the host where the page goes. A host without one leaves `webPreview` out and the editor falls back
// to a frame in the page, or to the address opened outside.

/** Where the page goes, in CSS pixels of the window the editor is in. */
export interface PreviewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How the preview sits: a peek at the right side, a peek in the middle, or over the whole window. */
export type PreviewMode = "side" | "center" | "full";

export interface PreviewPlace {
  mode: PreviewMode;
  rect: PreviewRect;
}

/** How the page is doing, as the host last heard from it. */
export interface WebPreviewState {
  url: string;
  title: string | null;
  status: "loading" | "ready" | "failed" | "blocked";
  /** A sentence about a failure the host can word better than "failed". */
  message?: string;
}

/** What a preview tells the editor: how the page is doing, and a key it had the focus for (it cannot reach the editor's own listeners). */
export type WebPreviewEvent = { type: "state"; state: WebPreviewState } | { type: "key"; key: "Escape" };

/** One preview that is open. */
export interface WebPreviewHandle {
  /** Moves and sizes the view to the box. Called as the box moves (the window resizes, the side panel is dragged, the mode changes). */
  place(place: PreviewPlace): void;
  back(): void;
  forward(): void;
  reload(): void;
  /** Opens the page's address in the person's own browser. */
  openExternal(): void;
  /** Takes the view off the screen without closing it: a menu or dialog of the editor is open over where it is. */
  hide(): void;
  show(): void;
  close(): void;
  /** Hears the page's state and the keys it had. Returns how to stop. */
  subscribe(listener: (event: WebPreviewEvent) => void): () => void;
}

export interface WebPreviewHost {
  /**
   * Opens the preview on `url`, or navigates the one that is open (there is only one at a time). Resolves to its handle, or to null
   * when the host cannot show one now (web previews are switched off).
   */
  open(url: string, place: PreviewPlace): Promise<WebPreviewHandle | null>;
  /** When `open` resolved to null because previews are off: switches them on, for the card that offers it. Left out, the card offers only to open outside. */
  turnOn?(): void;
}
