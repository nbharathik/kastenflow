// Diagrams: the shapes of kasten-core's `diagrams` (serde, camelCase) and the
// calls the app makes. A diagram is `name.drawio` (the source) and
// `name.drawio.svg` (its picture), kept together by the core.

/** Whether a diagram's picture shows what its source says now. `stale`: drawn
 * from other source, so it is drawn again when the editor is next at hand;
 * `missing`: there is none yet. */
export type DiagramPreview = "fresh" | "stale" | "missing";

export interface DiagramInfo {
  /** The source's vault path, `library/OAuth-flow.drawio`. */
  path: string;
  /** Its file's name, read as words. */
  title: string;
  /** The project folder it is in, if any. */
  project: string | null;
  pages: number;
  modified: number;
  size: number;
  preview: DiagramPreview;
  /** Why the source cannot be read, when it cannot. */
  problem: string | null;
}

export interface DiagramFile {
  path: string;
  xml: string;
  /** Pass back when saving, so changes made meanwhile are noticed. */
  hash: string;
  modified: number;
  preview: DiagramPreview;
}

export type DiagramSaved =
  | { status: "written"; diagram: DiagramFile }
  | { status: "unchanged"; diagram: DiagramFile }
  /** The file changed elsewhere since it was read; the editor's version went to `copy`. */
  | { status: "conflict"; copy: string; diagram: DiagramFile };

/** What a rename or a move did: where the source is now, every [from, to] move
 * of its files, and the pages and boards whose links were rewritten. */
export interface DiagramMoved {
  path: string;
  moves: [string, string][];
  relinked: string[];
}

export interface DiagramOps {
  /** Every diagram, by title. */
  diagrams(): Promise<DiagramInfo[]>;
  /** A diagram's source with the hash a save brings back. */
  diagram(path: string): Promise<DiagramFile>;
  /** The picture beside a diagram, as SVG text; null when there is none. */
  diagramPreview(path: string): Promise<string | null>;
  /** A new diagram in the project or the library, from `xml` or with one empty page; resolves to its path. */
  createDiagram(title: string, project: string | null, xml?: string | null): Promise<string>;
  /** A diagram from a `.drawio`, `.xml`, `.drawio.svg` or PNG file the editor made; resolves to its path. */
  importDiagram(name: string, bytes: Uint8Array, project: string | null): Promise<string>;
  /** Saves the source and, with it, the picture (both or neither). A file that changed since `baseHash` goes to a copy. */
  saveDiagram(path: string, xml: string, svg: string | null, baseHash: string): Promise<DiagramSaved>;
  /** Saves a picture drawn again, only for the source that has `sourceHash`. */
  saveDiagramPreview(path: string, svg: string, sourceHash: string): Promise<DiagramFile>;
  /** New title: both files take the name, and embeds and cards that named the file follow. */
  renameDiagram(path: string, title: string): Promise<DiagramMoved>;
  /** Moves both files into a project folder, or with null to the library. */
  moveDiagram(path: string, project: string | null): Promise<DiagramMoved>;
  /** Copies a diagram beside itself; resolves to the copy's path. */
  duplicateDiagram(path: string): Promise<string>;
  /** Puts a trashed diagram back with its picture; resolves to where it went. */
  restoreDiagram(trashed: string): Promise<string>;
}

/** The source of a new, empty diagram, as the core makes one. */
export const BLANK_DIAGRAM =
  '<mxfile host="Kasten">\n  <diagram id="page-1" name="Page-1">\n    <mxGraphModel dx="1000" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">\n      <root>\n        <mxCell id="0" />\n        <mxCell id="1" parent="0" />\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n';

export const isDiagramPath = (path: string) => path.endsWith(".drawio");
