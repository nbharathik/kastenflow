// What the editor needs from the place it runs in. The editor never touches
// files, the network or the operating system itself: Kasten, the `slides dev`
// folder host and the tests each provide these.

import type { Deck } from "@kasten-slides/wasm";
import type { ComponentType } from "react";

import type { RehearsalStore } from "../present/rehearsal-store.ts";
import type { PresentSync } from "../present/sync.ts";
import type { DecksHost } from "./decks-host.ts";
import type { TemplatesHost } from "./layouts/templates-host.ts";
import type { WebPreviewHost } from "./web-preview-host.ts";

/** What a save did. */
export type SaveOutcome =
  | { status: "saved" }
  /** The file changed since the editor read it. `theirs` is what is there now; `copy` is where the editor's text was kept, if the host kept it. */
  | { status: "conflict"; theirs: string; copy?: string | null };

/** An image the host holds, with what it remembers of it. Everything past `name` is optional: a host tells what it knows. */
export interface HostImage {
  /** The path a deck stores in an image element's `src`. */
  path: string;
  name: string;
  width?: number;
  height?: number;
  bytes?: number;
  /** When it was added, in milliseconds. */
  added?: number;
  /** Names the bytes: the same bytes are the same image, whatever they are called. */
  id?: string;
  /** How it came in: `pasted`, `file`, `pdf-clip`, `agent` or `pptx-import`. */
  source?: string;
  /** `person`, or `agent:<session>`. */
  createdBy?: string;
  tags?: string[];
  caption?: string;
  /** The BibTeX key of the paper it comes from. */
  citationKey?: string;
  /** Where on which paper a figure was clipped: the PDF's path, the page from 1, and the rectangle in PDF points. */
  clip?: { pdf: string; page: number; rect: [number, number, number, number] };
  /** The title of the paper a clipped figure comes from. */
  paper?: string;
  /** The deck a PowerPoint import brought it from. */
  deck?: string;
}

/** What a person changes about an image: tags replaced, a caption or citation key set (empty clears it). */
export interface ImageEdit {
  tags?: string[];
  caption?: string;
  citationKey?: string;
}

/** Where an image is used, computed by looking, never stored. */
export interface ImageUse {
  notes: { path: string; title: string }[];
  boards: { path: string; title: string }[];
  /** Decks that show it: the slides (from 1) and whether the deck's theme does. */
  decks: { path: string; title: string; slides: { number: number; id: string }[]; theme: boolean }[];
}

/**
 * A diagram drawn into a picture the deck can hold. The picture is a PNG in the host's image store: PowerPoint, PDF and the HTML
 * export carry that anywhere, which a diagram's own SVG (it draws its labels with HTML) does not survive.
 */
export interface DiagramPicture {
  /** The picture's path in the image store, as a deck stores it in an image element's `src`. */
  path: string;
  /** The diagram it is a picture of, as the host names diagrams (a vault path in Kasten). The deck keeps it with the picture, so the picture can be edited again. */
  source: string;
  /** What the diagram is called. */
  name: string;
  /** The picture's size in pixels, when the host knows it. */
  width?: number;
  height?: number;
  /**
   * Which version of the diagram the picture was drawn from, as the host names versions (an opaque string, such as a hash).
   * The deck keeps it with the picture; when `diagramRevision` later answers another, the picture is out of date.
   */
  rev?: string;
}

/** A page of the host (a Kasten page) as the editor lists and links it. */
export interface HostPage {
  /** The path a deck keeps in a link or a source: a vault path in Kasten, such as `projects/talk/plan.md`. */
  path: string;
  /** A stable name for the page when the host has one, so that a page that was moved is found again. */
  id?: string;
  title: string;
  /** A glyph or an emoji. */
  icon?: string;
  /** The project it belongs to (its folder's name), when it is in one. */
  project?: string | null;
  /** When it last changed, in milliseconds. */
  modified?: number;
  /** Its first words, for a preview. */
  excerpt?: string;
}

/** A page as it reads now: its Markdown, without the frontmatter. */
export interface HostPageText extends HostPage {
  markdown: string;
}

/** A heading of a page and the Markdown under it, up to the next heading at its level or above. */
export interface HostPageSection {
  /** The heading as it is written, marks and all: what `pageSection` finds the section by. */
  heading: string;
  /** What a person calls it. */
  title: string;
  /** 1 for `#` to 6 for `######`. */
  level: number;
  markdown: string;
}

/** Where a page opens, as the host's own Open menu has them: in place of this one, in a tab, in the pane to the right, or in a peek. */
export type OpenPageWay = "here" | "tab" | "right" | "peek";

/** What the host's page panel is told: the page to show over the presentation, and how to put it away. */
export interface PagePanelProps {
  path: string;
  /** The heading to scroll to, when the link names one. */
  section: string | null;
  onClose(): void;
}

/** A finished file handed to the person: an export. */
export interface DeliveredFile {
  name: string;
  bytes: Uint8Array;
  type: string;
}

/** What the host's assistant panel is told: where the person is in the deck. It is given again when the slide, the selection or the marks change. */
export interface AiPanelProps {
  /** Where the deck is kept, as the host names decks (a vault path in Kasten); none when the host keeps it nowhere. */
  deckPath: string | undefined;
  deckTitle: string;
  /** The name of the deck's theme. */
  theme: string;
  /** The slide on the canvas: its id, its place from 1 in the deck's `slideCount` slides, and its title. */
  slideId: string;
  slideNumber: number;
  slideCount: number;
  slideTitle: string;
  /** The elements selected on that slide, by id (empty when none is). */
  elementIds: readonly string[];
  /** How many elements of the deck an assistant made or changed that nobody has accepted or changed since (they show a badge). */
  pending: number;
  /** Accepts them all, as "Accept all" in the editor's menus does. */
  acceptAll(): void;
}

export interface SlidesHost {
  /** Where the deck being edited is kept, as the host names decks (the gallery leaves it out of the other decks that use an image). */
  readonly deckPath?: string;
  /** Writes the deck's text. With `overwrite` it replaces the file even though it changed since it was read. */
  save(text: string, options?: { overwrite?: boolean }): Promise<SaveOutcome>;
  /** A URL an image element can load for a stored image path; undefined when there is none. */
  imageUrl(path: string): string | undefined;
  /**
   * Keeps an image the person pasted, dropped or chose; resolves to its path. The same bytes kept before
   * resolve to the path they have (a picture pasted twice is one image). `source` says how it came in; a picture of
   * a PowerPoint import says which `deck` (its title) it was brought from.
   */
  addImage(name: string, bytes: Uint8Array, options?: { source?: "pasted" | "file" | "pptx-import"; deck?: string }): Promise<string>;
  /**
   * The bytes of an image the host holds, by the path a deck stores; undefined
   * when there are none. Without this the editor fetches `imageUrl`. An export
   * packs the pictures it needs into its file with it.
   */
  readImage?(path: string): Promise<Uint8Array | undefined>;
  /** Hands a file to the person (a download in a browser, the Downloads folder in the app). */
  deliver(file: DeliveredFile): Promise<void>;
  /** The images the host holds, newest first, for the gallery. */
  images?(): Promise<HostImage[]>;
  /** One image in full (a list may leave out what is dear to work out, such as the hash). */
  assetInfo?(path: string): Promise<HostImage | undefined>;
  /**
   * A URL to show a small copy of an image (`size` is the longer side: 256 for the grid, 1024 for a big look). A host without
   * small copies, or with none for this image (a vector picture), gives undefined and `imageUrl` is used.
   */
  thumbnailUrl?(path: string, size: 256 | 1024): Promise<string | undefined> | string | undefined;
  /** Where each image that is used is used, by path: one look at everything. An image not in the answer is unused. */
  imageUsage?(): Promise<Record<string, ImageUse>>;
  /** Changes an image's tags, caption or citation key; resolves to the image as it is now. */
  setImageMeta?(path: string, edit: ImageEdit): Promise<HostImage | undefined>;
  /** Asks for captions to be written for these images (an agent does it); the host says so when it is done. */
  describe?(paths: string[]): Promise<void>;
  /** Calls `onChange` when the images the host holds changed (added elsewhere, an agent's); returns how to stop. */
  watchImages?(onChange: () => void): () => void;
  /**
   * The bibliography, as BibTeX text: what a citation key is looked up in. Kasten gives the `.bib` files of the vault one after
   * another; `slides dev` gives the `.bib` files beside the decks. No `.bib` file is an empty text (then every key is unknown).
   * A host without this has no bibliography: keys are written as they are and lint does not check them.
   */
  references?(): Promise<string>;
  /** Calls `onChange` when the bibliography changed (a `.bib` file was edited, added or removed); returns how to stop. */
  watchReferences?(onChange: () => void): () => void;
  /** Opens a note, board or deck of the host's, from a place an image is used. */
  openPath?(path: string): void;
  /**
   * Lets the person choose a diagram of the host's (or make one) and resolves to a picture of it, or to null when they did not
   * choose. A host with no diagrams, such as the standalone `slides dev`, leaves this out, and the editor does not offer Insert → Diagram.
   */
  pickDiagram?(): Promise<DiagramPicture | null>;
  /**
   * Opens the diagram `source` (what a `DiagramPicture` named) in the host's editor, and when it is closed resolves to a picture of it
   * as it is now, or to null when it did not change (a picture with the path the slide already has is left alone too).
   * Without this the editor does not offer Edit diagram.
   */
  editDiagram?(source: string): Promise<DiagramPicture | null>;
  /**
   * The version the diagram `source` is at now, in the host's names for versions (what a `DiagramPicture.rev` holds); undefined
   * when the diagram cannot be found. With this, `drawDiagram` and `watchDiagrams` the editor marks a picture whose diagram changed
   * elsewhere and offers to draw it again.
   */
  diagramRevision?(source: string): Promise<string | undefined>;
  /** A picture of the diagram `source` as it is now, drawn without opening its editor; rejects with the reason when it cannot be. */
  drawDiagram?(source: string): Promise<DiagramPicture | null>;
  /** Calls `onChange` when a diagram changed (saved in its editor, edited elsewhere); returns how to stop. */
  watchDiagrams?(onChange: () => void): () => void;
  /**
   * The editor now holds `text` as what is saved: it took a version from
   * outside (a change made elsewhere, or the file's version after a conflict).
   * A host that tracks which version it saved over updates that here.
   */
  synced?(text: string): void;
  /** Opens a web address outside the editor. */
  openUrl?(url: string): void;
  /**
   * Lets the person choose a page of the host, and resolves to it, or to null when they did not. A host with no pages (the
   * standalone `slides dev`) leaves this out, and the editor does not offer Insert → Page.
   */
  pickPage?(): Promise<HostPage | null>;
  /** A page as it reads now; undefined when there is no such page (it was moved or trashed). Without this a page cannot be embedded, inserted or updated. */
  readPage?(path: string): Promise<HostPageText | undefined>;
  /** The headings of a page, each with the Markdown under it. Left out, they are read from `readPage`'s Markdown by the engine. */
  pageSections?(path: string): Promise<HostPageSection[]>;
  /** The pages the host holds, newest first: what a link to a page is checked against. Left out, links to pages are not checked. */
  listPages?(): Promise<HostPage[]>;
  /** Opens a page of the host (a link followed in the editor). `section` is a heading to go to. */
  openPage?(path: string, how?: OpenPageWay, section?: string | null): void;
  /** Calls `onChange` with the paths of pages that changed (edited here, or somewhere else); returns how to stop. */
  watchPages?(onChange: (paths: string[]) => void): () => void;
  /**
   * A calm panel for a page, drawn by the host over the presentation: a link to a page opens it at the side, and Esc puts it away
   * and returns to the slide. Left out, a link to a page does nothing while presenting.
   */
  pagePanel?: ComponentType<PagePanelProps>;
  /**
   * A picture of a web page as it looks in a window of `width` by `height`, kept in the image store; resolves to its path, or to
   * null when it could not be taken. Taking one needs a window of the page that only the desktop app has; without this a snapshot
   * is a picture the person chooses (no host does this yet: nothing in the desktop app can read the pixels of a web view).
   */
  snapshotPage?(address: string, width: number, height: number): Promise<string | null>;
  /** The readable text of a web page, as Markdown, for the Reader mode of an embedded page; null when it cannot be made. */
  readerPage?(address: string): Promise<{ title: string; markdown: string } | null>;
  /**
   * A web page shown next to a slide, or over a presentation, in a view the host draws (a native web view in the desktop app). With it a
   * web link followed in a presentation, and Preview live on an embedded page in the editor, open the page in a peek at the side (or
   * in the middle, or over the whole window) that the editor places and the host fills; the editor makes no frame of its own for it.
   * Without it a link opens outside, and a selected embed shows live in a frame in the page where the page allows it.
   */
  webPreview?: WebPreviewHost;
  /** Tells the person something short. */
  notify?(message: string): void;
  /**
   * Opens the presenter's window and resolves to the link to it, or null when it could not be opened. Without this the
   * editor opens a browser window on the page's own address (`?presenter=…`), which the page has to show as the presenter's view.
   */
  openPresenter?(): Promise<PresentSync | null>;
  /**
   * A presentation of `deck` is about to open. Resolves to what is called when it closes. A host that has to permit what the deck
   * embeds (the desktop app does, for its frames) does it here.
   */
  willPresent?(deck: Deck): Promise<() => void> | (() => void) | void;
  /**
   * Fills the screen with the presentation, where the host has a better way than the page's own full screen. Resolves to what
   * gives the screen back; `onLeft` is called when the person leaves full screen some other way.
   */
  fillScreen?(onLeft: () => void): Promise<() => void>;
  /**
   * The assistant tab of the side panel, drawn by the host: Kasten gives its chat, with the deck tools. It is a component that is given
   * where the person is in the deck (`AiPanelProps`) and drawn again as that changes. A host without one shows that the assistant is not
   * available here.
   */
  aiPanel?: ComponentType<AiPanelProps>;
  /**
   * The templates the host keeps, so that a deck's look can be saved as one and put on this deck or another. A host without them
   * (the standalone page) leaves this out, and the editor offers no templates.
   */
  templates?: TemplatesHost;
  /** The other decks the host keeps, so that layouts can be brought in from one of them. A host without them leaves this out, and the editor offers no import of layouts. */
  decks?: DecksHost;
  /**
   * Where the rehearsals of a deck are kept (the timing of each slide and step of a run-through). Kasten keeps them on this computer, outside
   * the vault. Left out, they are kept in the page's local storage, the last ten for each deck.
   */
  rehearsals?: RehearsalStore;
  /**
   * Whether the deck is a favourite of the host's (a star beside its name), and how to change that. A host without favourites leaves
   * this out, and the title bar shows no star.
   */
  favourite?: DeckFavourite;
}

/** The deck's star: read it, change it, and hear when it was changed somewhere else (the sidebar). */
export interface DeckFavourite {
  /** Whether the deck is a favourite now. */
  isOn(): boolean;
  set(on: boolean): void;
  /** Calls `onChange` when it changed; returns how to stop. */
  watch(onChange: () => void): () => void;
}
