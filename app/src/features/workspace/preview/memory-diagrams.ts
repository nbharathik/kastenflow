// The browser preview's diagrams, on MemoryDecks: a `.drawio` source and the
// `.drawio.svg` picture beside it, written together, kept together when they
// move, rename, duplicate or go to the trash. Inside the app the core does
// this (kasten-core's diagrams module and engine/diagrams.rs).

import { BLANK_DIAGRAM } from "../../../lib/vault/diagram-types";
import type { DiagramFile, DiagramInfo, DiagramMoved, DiagramPreview, DiagramSaved, NoteFile, Trashed } from "../../../lib/vault/types";
import { stemOfPath, stemOfTitle, titleOfPath, validTitle } from "../../diagrams/names";
import { relinkBoards } from "./board-extras";
import { checkSvg, checkXml, contentOfSvg, diagramInPng, MAX_BYTES, retarget, stamped, stampOf } from "./diagram-text";
import { MemoryDecks } from "./memory-decks";
import { splitFrontmatter } from "../../pages/markdown/frontmatter";
import { contentHash, stamps } from "./vault-text";

const EXT = ".drawio";
const PICTURE = ".drawio.svg";
const MAX_PNG = 64 * 1024 * 1024;

const folderOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const pictureOf = (path: string) => `${path}.svg`;
const projectOf = (path: string) => (path.startsWith("projects/") ? (path.split("/")[1] ?? null) : null);

export class MemoryDiagrams extends MemoryDecks {
  private sourcesOf(): Record<string, string> {
    return (this.data.diagrams ??= {});
  }

  private drawingsOf(): Record<string, string> {
    return (this.data.drawings ??= {});
  }

  protected override keeps(file: string): boolean {
    return this.sourcesOf()[file] !== undefined || this.drawingsOf()[file] !== undefined || super.keeps(file);
  }

  private source(path: string): string {
    if (!path.endsWith(EXT) || path.includes("..")) throw new Error(`Not a note path in this vault: ${path}`);
    const xml = this.sourcesOf()[path];
    if (xml === undefined) throw new Error(`No note at ${path}`);
    return xml;
  }

  private previewOf(path: string, hash: string): DiagramPreview {
    const picture = this.drawingsOf()[pictureOf(path)];
    if (picture === undefined) return "missing";
    return stampOf(picture) === hash ? "fresh" : "stale";
  }

  private diagramFile(path: string): DiagramFile {
    const xml = this.source(path);
    const hash = contentHash(xml);
    return { path, xml, hash, modified: this.now(), preview: this.previewOf(path, hash) };
  }

  /** A path for a new diagram in `dir`, where neither its source nor its picture is. */
  private freePair(dir: string, stem: string): string {
    for (let n = 1; ; n++) {
      const path = `${dir}/${n === 1 ? stem : `${stem}-${n}`}${EXT}`;
      if (this.sourcesOf()[path] === undefined && this.drawingsOf()[pictureOf(path)] === undefined) return path;
    }
  }

  private async folderFor(project: string | null): Promise<string> {
    if (!project) return "library";
    if (!(await this.list()).some((n) => n.path === `projects/${project}/_project.md`)) throw new Error(`No project called ${project}`);
    return `projects/${project}/diagrams`;
  }

  async diagrams(): Promise<DiagramInfo[]> {
    const out = Object.entries(this.sourcesOf()).map(([path, xml]): DiagramInfo => {
      let pages = 0;
      let problem: string | null = null;
      try {
        pages = checkXml(xml);
      } catch (err) {
        problem = err instanceof Error ? err.message : String(err);
      }
      return { path, title: titleOfPath(path), project: projectOf(path), pages, modified: this.now(), size: new TextEncoder().encode(xml).length, preview: problem ? "missing" : this.previewOf(path, contentHash(xml)), problem };
    });
    return out.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()) || a.path.localeCompare(b.path));
  }

  async diagram(path: string): Promise<DiagramFile> {
    return this.diagramFile(path);
  }

  async diagramPreview(path: string): Promise<string | null> {
    this.source(path);
    return this.drawingsOf()[pictureOf(path)] ?? null;
  }

  async createDiagram(title: string, project: string | null, xml?: string | null): Promise<string> {
    if (!validTitle(title)) throw new Error("A title needs some text and no [ ] or | characters, on one line");
    const text = xml ?? BLANK_DIAGRAM;
    checkXml(text);
    const dir = await this.folderFor(project);
    const path = this.freePair(dir, stemOfTitle(title.trim()));
    this.sourcesOf()[path] = text;
    this.persist();
    return path;
  }

  async importDiagram(name: string, bytes: Uint8Array, project: string | null): Promise<string> {
    const file = name.split(/[/\\]/).pop() ?? name;
    const lower = file.toLowerCase();
    const strip = (...ends: string[]): string | undefined => {
      const end = ends.find((e) => lower.endsWith(e));
      return end === undefined ? undefined : file.slice(0, file.length - end.length);
    };
    const asSvg = strip(PICTURE, ".svg");
    const asPng = strip(".drawio.png", ".png");
    const asSource = strip(EXT, ".xml");
    const kind: "source" | "svg" | "png" | null = asSvg !== undefined ? "svg" : asPng !== undefined ? "png" : asSource !== undefined ? "source" : null;
    const title = asSvg ?? asPng ?? asSource;
    if (kind === null) throw new Error("Only .drawio, .xml, .drawio.svg and .drawio.png files can be imported here; open a diagram and use the editor's own import for other kinds, such as .vsdx");
    if (bytes.length > (kind === "png" ? MAX_PNG : MAX_BYTES)) throw new Error(`${file} is too large to import (${Math.floor(bytes.length / (1024 * 1024))} MB)`);
    let xml: string;
    let svg: string | null = null;
    if (kind === "png") {
      const found = diagramInPng(bytes);
      if (found === null) throw new Error("This picture holds no diagram: the PNG has no copy of one inside it");
      xml = found;
    } else {
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new Error(`${file} is not UTF-8 text`);
      }
      if (kind === "svg") {
        checkSvg(text);
        const content = contentOfSvg(text);
        if (content === null) throw new Error("This picture holds no diagram: it has no copy of one, so it was not saved by the diagram editor");
        xml = content;
        svg = text;
      } else xml = text;
    }
    checkXml(xml);
    const dir = await this.folderFor(project);
    const path = this.freePair(dir, stemOfTitle(title ?? "untitled"));
    this.sourcesOf()[path] = xml;
    if (svg !== null) this.drawingsOf()[pictureOf(path)] = stamped(svg, contentHash(xml));
    this.persist();
    return path;
  }

  async saveDiagram(path: string, xml: string, svg: string | null, baseHash: string): Promise<DiagramSaved> {
    checkXml(xml);
    if (svg !== null) checkSvg(svg);
    const current = this.diagramFile(path);
    if (current.xml !== xml && current.hash !== baseHash) {
      const label = `conflict ${stamps(this.now()).file}`;
      const stem = path.slice(0, -EXT.length);
      let copy = `${stem} (${label})${EXT}`;
      for (let n = 2; this.sourcesOf()[copy] !== undefined || this.drawingsOf()[pictureOf(copy)] !== undefined; n++) copy = `${stem} (${label} ${n})${EXT}`;
      this.sourcesOf()[copy] = xml;
      if (svg !== null) this.drawingsOf()[pictureOf(copy)] = stamped(svg, contentHash(xml));
      this.persist();
      return { status: "conflict", copy, diagram: current };
    }
    let wrote = false;
    if (current.xml !== xml) {
      this.sourcesOf()[path] = xml;
      wrote = true;
    }
    if (svg !== null) {
      const text = stamped(svg, contentHash(xml));
      if (this.drawingsOf()[pictureOf(path)] !== text) {
        this.drawingsOf()[pictureOf(path)] = text;
        wrote = true;
      }
    }
    if (!wrote) return { status: "unchanged", diagram: current };
    this.persist();
    return { status: "written", diagram: this.diagramFile(path) };
  }

  async saveDiagramPreview(path: string, svg: string, sourceHash: string): Promise<DiagramFile> {
    checkSvg(svg);
    const current = this.diagramFile(path);
    if (current.hash !== sourceHash) throw new Error("The diagram changed since this picture was drawn");
    this.drawingsOf()[pictureOf(path)] = stamped(svg, current.hash);
    this.persist();
    return this.diagramFile(path);
  }

  /** Moves a source and its picture to `target`, which is free for both. */
  private movePair(path: string, target: string): [string, string][] {
    const moves: [string, string][] = [[path, target]];
    this.sourcesOf()[target] = this.source(path);
    delete this.sourcesOf()[path];
    const picture = this.drawingsOf()[pictureOf(path)];
    if (picture !== undefined) {
      this.drawingsOf()[pictureOf(target)] = picture;
      delete this.drawingsOf()[pictureOf(path)];
      moves.push([pictureOf(path), pictureOf(target)]);
    }
    return moves;
  }

  /** Rewrites the pages' links and the boards' cards that named the source before it moved. */
  private async relink(moves: [string, string][], bareFollows: boolean): Promise<string[]> {
    const [old, next] = moves[0]!;
    const written: string[] = [];
    for (const [path, file] of Object.entries(this.data.files)) {
      if (!file.text.toLowerCase().includes(nameOf(old).toLowerCase())) continue;
      const parts = splitFrontmatter(file.text);
      const body = retarget(parts.body, old, next, bareFollows);
      if (body === null) continue;
      this.put(path, parts.prefix + body);
      written.push(path);
    }
    written.push(...relinkBoards(this.data.boards, moves));
    return written;
  }

  private uniqueName(path: string): boolean {
    return Object.keys(this.sourcesOf()).filter((p) => nameOf(p).toLowerCase() === nameOf(path).toLowerCase()).length <= 1;
  }

  async renameDiagram(path: string, title: string): Promise<DiagramMoved> {
    if (!validTitle(title)) throw new Error("A title needs some text and no [ ] or | characters, on one line");
    this.source(path);
    const stem = stemOfTitle(title.trim());
    if (stem === stemOfPath(path)) return { path, moves: [], relinked: [] };
    const bare = this.uniqueName(path);
    const target = this.freePair(folderOf(path), stem);
    const moves = this.movePair(path, target);
    const relinked = await this.relink(moves, bare);
    this.persist();
    return { path: target, moves, relinked };
  }

  async moveDiagram(path: string, project: string | null): Promise<DiagramMoved> {
    const dir = await this.folderFor(project);
    this.source(path);
    if (folderOf(path) === dir) return { path, moves: [], relinked: [] };
    const bare = this.uniqueName(path);
    const target = this.freePair(dir, stemOfPath(path));
    const moves = this.movePair(path, target);
    const relinked = await this.relink(moves, bare);
    this.persist();
    return { path: target, moves, relinked };
  }

  async duplicateDiagram(path: string): Promise<string> {
    const xml = this.source(path);
    const target = this.freePair(folderOf(path), `${stemOfPath(path)}-copy`);
    this.sourcesOf()[target] = xml;
    const picture = this.drawingsOf()[pictureOf(path)];
    if (picture !== undefined) this.drawingsOf()[pictureOf(target)] = picture;
    this.persist();
    return target;
  }

  override async trash(path: string): Promise<string> {
    if (!path.endsWith(EXT)) return super.trash(path);
    const xml = this.source(path);
    const when = this.freeStamp();
    const trashed = `.trash/${when}/${path}`;
    this.data.trash[trashed] = { text: xml, when, original: path };
    delete this.sourcesOf()[path];
    const picture = this.drawingsOf()[pictureOf(path)];
    if (picture !== undefined) {
      this.data.trash[pictureOf(trashed)] = { text: picture, when, original: pictureOf(path) };
      delete this.drawingsOf()[pictureOf(path)];
    }
    this.persist();
    return trashed;
  }

  override async listTrash(): Promise<Trashed[]> {
    const all = await super.listTrash();
    const has = (original: string, when: string) => all.some((t) => t.original === original && t.when === when);
    return all
      .filter((t) => !(t.original.endsWith(PICTURE) && has(t.original.slice(0, -4), t.when)))
      .map((t) => (t.original.endsWith(EXT) || t.original.endsWith(PICTURE) ? { ...t, title: titleOfPath(t.original) } : t));
  }

  override async restore(trashed: string): Promise<NoteFile> {
    if (trashed.endsWith(EXT) || trashed.endsWith(PICTURE)) throw new Error(`${trashed} is a diagram; restore it as one`);
    return super.restore(trashed);
  }

  async restoreDiagram(trashed: string): Promise<string> {
    const entry = this.data.trash[trashed];
    if (!entry || !(entry.original.endsWith(EXT) || entry.original.endsWith(PICTURE))) throw new Error(`No diagram at ${trashed}`);
    if (entry.original.endsWith(PICTURE)) {
      let target = entry.original;
      for (let n = 2; this.drawingsOf()[target] !== undefined; n++) target = `${entry.original.slice(0, -PICTURE.length)}-${n}${PICTURE}`;
      this.drawingsOf()[target] = entry.text;
      delete this.data.trash[trashed];
      this.persist();
      return target;
    }
    const target = this.freePair(folderOf(entry.original), stemOfPath(entry.original));
    this.sourcesOf()[target] = entry.text;
    const picture = this.data.trash[pictureOf(trashed)];
    if (picture) {
      this.drawingsOf()[pictureOf(target)] = picture.text;
      delete this.data.trash[pictureOf(trashed)];
    }
    delete this.data.trash[trashed];
    this.persist();
    return target;
  }
}
