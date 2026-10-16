// The browser preview's whiteboards, on MemoryNesting: board files, their
// edits (board-changes.ts), and boards in the trash. Inside the app the
// core does this (kasten-core's board module and engine/boards.rs).

import type { BoardAdded, BoardApplied, BoardChange, BoardInfo, BoardView, NoteFile, Trashed } from "../../../lib/vault/types";
import { applyChanges, connect } from "./board-changes";
import { sourceOf } from "./board-extras";
import { addFiles, addSticky, boardTitle, findNode, group, readCanvas, viewBoard, writeCanvas } from "./memory-extras";
import { MemoryNesting } from "./memory-nesting";
import { slugify } from "./vault-text";

export class MemoryBoards extends MemoryNesting {
  protected canvas(path: string) {
    const text = this.data.boards?.[path];
    if (text === undefined) throw new Error(`No board at ${path}`);
    return readCanvas(text);
  }

  private saveCanvas(path: string, canvas: ReturnType<typeof readCanvas>): void {
    (this.data.boards ??= {})[path] = writeCanvas(canvas);
    this.persist();
  }

  async boards(): Promise<BoardInfo[]> {
    // One time for the whole list: a clock that ticks between two boards would make the later one look newer, and
    // which of a page's maps is its own would then change from one listing to the next.
    const modified = this.now();
    return Object.entries(this.data.boards ?? {})
      .map(([path, text]) => {
        const canvas = readCanvas(text);
        const project = path.startsWith("projects/") ? (path.split("/")[1] ?? null) : null;
        const source = sourceOf(canvas)?.page;
        return { path, title: boardTitle(path, canvas), project, nodes: canvas.nodes.length, modified, ...(source ? { source } : {}) };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  async board(path: string): Promise<BoardView> {
    return viewBoard(path, this.canvas(path), await this.list(), (file) => this.fileTitle(file));
  }

  /** A card's title for a file that is not a note: a nested board's title,
   * or a kept file's name; undefined when there is no such file. */
  private fileTitle(file: string): string | undefined {
    const text = this.data.boards?.[file];
    if (text !== undefined) return boardTitle(file, readCanvas(text));
    return this.keeps(file) ? file.slice(file.lastIndexOf("/") + 1) : undefined;
  }

  /** Whether the vault holds `file`, neither a note nor a board, such as a
   * picture in assets/. */
  protected keeps(_file: string): boolean {
    return false;
  }

  override async trash(path: string): Promise<string> {
    if (!path.endsWith(".canvas")) return super.trash(path);
    const text = this.data.boards?.[path];
    if (text === undefined) throw new Error(`No board at ${path}`);
    const when = this.freeStamp();
    const trashed = `.trash/${when}/${path}`;
    this.data.trash[trashed] = { text, when, original: path };
    delete this.data.boards![path];
    this.persist();
    return trashed;
  }

  override async listTrash(): Promise<Trashed[]> {
    return (await super.listTrash()).map((t) => (t.original.endsWith(".canvas") ? { ...t, title: boardTitle(t.original, readCanvas(this.data.trash[t.trashed]!.text)) } : t));
  }

  override async restore(trashed: string): Promise<NoteFile> {
    if (trashed.endsWith(".canvas")) throw new Error(`${trashed} is a board; restore it as one`);
    return super.restore(trashed);
  }

  async restoreBoard(trashed: string): Promise<string> {
    const entry = this.data.trash[trashed];
    if (!entry || !entry.original.endsWith(".canvas")) throw new Error(`No board at ${trashed}`);
    const boards = (this.data.boards ??= {});
    const stem = entry.original.replace(/\.canvas$/, "");
    let target = entry.original;
    for (let n = 2; boards[target] !== undefined; n++) target = `${stem}-${n}.canvas`;
    boards[target] = entry.text;
    delete this.data.trash[trashed];
    this.persist();
    return target;
  }

  /** How many boards show each file, by path. */
  protected boardCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const text of Object.values(this.data.boards ?? {})) {
      const files = new Set(readCanvas(text).nodes.filter((n) => n.type === "file").map((n) => String(n.file)));
      for (const f of files) counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    return counts;
  }

  async boardsWith(path: string): Promise<BoardInfo[]> {
    const showing = (text: string) => readCanvas(text).nodes.some((n) => n.type === "file" && n.file === path);
    const paths = new Set(Object.entries(this.data.boards ?? {}).filter(([, text]) => showing(text)).map(([board]) => board));
    return (await this.boards()).filter((b) => paths.has(b.path));
  }

  async boardApply(board: string, changes: BoardChange[]): Promise<BoardApplied> {
    const notes = new Set((await this.list()).map((n) => n.path));
    for (const change of changes) {
      if (change.kind === "card" && !notes.has(change.path.trim()) && !this.fileTitle(change.path.trim())) throw new Error(`No file ${change.path.trim()} in this vault`);
    }
    const canvas = this.canvas(board);
    const made = applyChanges(canvas, changes);
    this.saveCanvas(board, canvas);
    return { made, board: await this.board(board) };
  }

  async createBoard(title: string, project: string | null): Promise<string> {
    const name = title.trim();
    if (!name || /[[\]|\n\r]/.test(name)) throw new Error("A title needs some text and no [ ] or | characters");
    const dir = project ? `projects/${project}/boards` : "library";
    let path = `${dir}/${slugify(name)}.canvas`;
    for (let n = 2; this.data.boards?.[path]; n++) path = `${dir}/${slugify(name)}-${n}.canvas`;
    this.saveCanvas(path, { nodes: [], edges: [], "x-kasten": { title: name } });
    return path;
  }

  async addToBoard(board: string, notes: string[]): Promise<BoardAdded> {
    const canvas = this.canvas(board);
    const added = addFiles(canvas, notes);
    this.saveCanvas(board, canvas);
    return added;
  }

  async addSticky(board: string, text: string, at?: [number, number]): Promise<string> {
    const canvas = this.canvas(board);
    const id = addSticky(canvas, text, at);
    this.saveCanvas(board, canvas);
    return id;
  }

  async connect(board: string, from: string, to: string, label?: string): Promise<string> {
    const view = await this.board(board);
    const canvas = this.canvas(board);
    const id = connect(canvas, findNode(view, from), findNode(view, to), label);
    this.saveCanvas(board, canvas);
    return id;
  }

  async group(board: string, nodes: string[], label: string): Promise<string> {
    const view = await this.board(board);
    const canvas = this.canvas(board);
    const id = group(canvas, nodes.map((n) => findNode(view, n)), label);
    this.saveCanvas(board, canvas);
    return id;
  }
}
