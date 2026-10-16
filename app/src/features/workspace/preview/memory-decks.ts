// The browser preview's slide decks, on MemoryBoards: deck files as text, saved
// with the hash they were read with, and decks in the trash. Inside the app
// the core does this (kasten-core's deck module and engine/decks.rs).

import type { DeckFile, DeckInfo, DeckSaved, DecksSaved, NoteFile, SaveDecksRequest, Trashed } from "../../../lib/vault/types";
import { MemoryBoards } from "./memory-boards";
import { contentHash, slugify, stamps } from "./vault-text";

const FORMAT = "kasten-deck";

/** The most decks one save of several changes (kasten-core's `MAX_SAVE_DECKS`). */
const MOST_SAVED = 500;

/** Where slide templates are made; a deck anywhere in `templates/` is a template, not one of the person's decks (kasten-core's `deck::is_template`). */
const TEMPLATES = "templates/slides/";

interface Head {
  title: string | null;
  slides: number;
}

/** The envelope of a deck's text, or why it is not a deck (deck/head.rs). */
export function deckHead(text: string): Head {
  const bad = (why: string) => new Error(`Not a KastenFlow deck: ${why}`);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw bad("not JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw bad("not a deck object");
  const deck = value as Record<string, unknown>;
  if (deck.format !== FORMAT) throw bad("its format is not kasten-deck");
  if (!Number.isInteger(deck.formatVersion) || (deck.formatVersion as number) < 1) throw bad("it has no format version");
  if (!Array.isArray(deck.slides)) throw bad("it has no slides list");
  if (deck.title !== undefined && deck.title !== null && typeof deck.title !== "string") throw bad("its title is not text");
  return { title: typeof deck.title === "string" ? deck.title : null, slides: deck.slides.length };
}

const stemOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.deck$/, "");

function titleOf(path: string, text: string | undefined): string {
  if (text === undefined) return stemOf(path);
  try {
    const title = deckHead(text).title;
    return title && title.trim() ? title : stemOf(path);
  } catch {
    return stemOf(path);
  }
}

export class MemoryDecks extends MemoryBoards {
  private deckText(path: string): string {
    const text = this.data.decks?.[path];
    if (text === undefined) throw new Error(`No note at ${path}`);
    return text;
  }

  private fileOf(path: string): DeckFile {
    const text = this.deckText(path);
    return { path, text, hash: contentHash(text), modified: this.now() };
  }

  /** The decks of the vault, templates apart (kasten-core's `Kasten::decks` and `deck_templates`). */
  private listed(templates: boolean): DeckInfo[] {
    const out = Object.entries(this.data.decks ?? {})
      .filter(([path]) => path.startsWith("templates/") === templates)
      .map(([path, text]): DeckInfo => {
        const project = path.startsWith("projects/") ? (path.split("/")[1] ?? null) : null;
        const size = new TextEncoder().encode(text).length;
        try {
          const head = deckHead(text);
          return { path, title: head.title?.trim() ? head.title : stemOf(path), project, slides: head.slides, modified: this.now(), size, problem: null };
        } catch (err) {
          return { path, title: stemOf(path), project, slides: 0, modified: this.now(), size, problem: err instanceof Error ? err.message : String(err) };
        }
      });
    return out.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()) || a.path.localeCompare(b.path));
  }

  async decks(): Promise<DeckInfo[]> {
    return this.listed(false);
  }

  async deckTemplates(): Promise<DeckInfo[]> {
    return this.listed(true);
  }

  async createDeckTemplate(title: string, text: string): Promise<string> {
    const name = title.trim();
    if (!name || /[[\]|\n\r]/.test(name)) throw new Error("A title needs some text and no [ ] or | characters");
    deckHead(text);
    const decks = (this.data.decks ??= {});
    let path = `${TEMPLATES}${slugify(name)}.deck`;
    for (let n = 2; decks[path] !== undefined; n++) path = `${TEMPLATES}${slugify(name)}-${n}.deck`;
    decks[path] = text;
    this.persist();
    return path;
  }

  async deck(path: string): Promise<DeckFile> {
    return this.fileOf(path);
  }

  /** The `.bib` files of the vault, one after another in the order of their paths (engine/references.rs). */
  async references(): Promise<string> {
    return Object.values(this.bibFiles)
      .map((text) => `${text}\n`)
      .join("");
  }

  async createDeck(title: string, project: string | null, text: string): Promise<string> {
    const name = title.trim();
    if (!name || /[[\]|\n\r]/.test(name)) throw new Error("A title needs some text and no [ ] or | characters");
    deckHead(text);
    if (project && !(await this.list()).some((n) => n.path === `projects/${project}/_project.md`)) throw new Error(`No project called ${project}`);
    const dir = project ? `projects/${project}/decks` : "library";
    const decks = (this.data.decks ??= {});
    let path = `${dir}/${slugify(name)}.deck`;
    for (let n = 2; decks[path] !== undefined; n++) path = `${dir}/${slugify(name)}-${n}.deck`;
    decks[path] = text;
    this.persist();
    return path;
  }

  async saveDeck(path: string, text: string, baseHash: string): Promise<DeckSaved> {
    deckHead(text);
    const current = this.fileOf(path);
    if (current.text === text) return { status: "unchanged", deck: current };
    const decks = (this.data.decks ??= {});
    if (current.hash !== baseHash) {
      const stem = path.replace(/\.deck$/, "");
      const label = `conflict ${stamps(this.now()).file}`;
      let copy = `${stem} (${label}).deck`;
      for (let n = 2; decks[copy] !== undefined; n++) copy = `${stem} (${label} ${n}).deck`;
      decks[copy] = text;
      this.persist();
      return { status: "conflict", copy, deck: current };
    }
    decks[path] = text;
    this.persist();
    return { status: "written", deck: this.fileOf(path) };
  }

  /** Several decks together, all or none (engine/decks.rs `save_decks`). The preview keeps no history, so there is no commit to undo. */
  async saveDecks(request: SaveDecksRequest): Promise<DecksSaved> {
    const message = request.message.trim();
    if (!message || /[\n\r]/.test(message) || [...message].length > 200) throw new Error("A save of several decks needs a message of one line, up to 200 characters");
    if (request.edits.length === 0) throw new Error("Nothing to save: no deck was given");
    if (request.edits.length > MOST_SAVED) throw new Error(`At most ${MOST_SAVED} decks can be saved at once`);
    const seen = new Set<string>();
    for (const edit of request.edits) {
      if (seen.has(edit.path)) throw new Error(`${edit.path} is listed twice`);
      seen.add(edit.path);
    }
    // Every deck is read and every text checked before the first write.
    const work = request.edits.map((edit) => {
      const current = this.fileOf(edit.path);
      if (current.hash !== edit.baseHash) throw new Error("Some decks changed since you looked, so nothing was saved. Look again.");
      deckHead(edit.text);
      return { edit, current };
    });
    const decks = (this.data.decks ??= {});
    const paths: string[] = [];
    for (const { edit, current } of work) {
      if (current.text === edit.text) continue;
      decks[edit.path] = edit.text;
      paths.push(edit.path);
    }
    if (paths.length > 0) this.persist();
    return { commit: null, paths };
  }

  override async trash(path: string): Promise<string> {
    if (!path.endsWith(".deck")) return super.trash(path);
    const text = this.deckText(path);
    const when = this.freeStamp();
    const trashed = `.trash/${when}/${path}`;
    this.data.trash[trashed] = { text, when, original: path };
    delete this.data.decks![path];
    this.persist();
    return trashed;
  }

  override async listTrash(): Promise<Trashed[]> {
    return (await super.listTrash()).map((t) => (t.original.endsWith(".deck") ? { ...t, title: titleOf(t.original, this.data.trash[t.trashed]?.text) } : t));
  }

  override async restore(trashed: string): Promise<NoteFile> {
    if (trashed.endsWith(".deck")) throw new Error(`${trashed} is a deck; restore it as one`);
    return super.restore(trashed);
  }

  async restoreDeck(trashed: string): Promise<string> {
    const entry = this.data.trash[trashed];
    if (!entry || !entry.original.endsWith(".deck")) throw new Error(`No deck at ${trashed}`);
    const decks = (this.data.decks ??= {});
    const stem = entry.original.replace(/\.deck$/, "");
    let target = entry.original;
    for (let n = 2; decks[target] !== undefined; n++) target = `${stem}-${n}.deck`;
    decks[target] = entry.text;
    delete this.data.trash[trashed];
    this.persist();
    return target;
  }
}
