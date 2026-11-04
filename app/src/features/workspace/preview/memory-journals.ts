// The browser preview's part for journals: a project's day at
// `projects/<project>/journal/<year>/<date>.md` (an ordinary note of type
// `journal`), adding to a day, and the two lists the window reads. Inside the
// app the core does these (journal_path.rs, templated.rs, index).

import type { JournalOps, ProjectJournalDay, ProjectJournalPage, ProjectJournalRef } from "../../../lib/vault/journal-types";
import type { NoteFile } from "../../../lib/vault/types";
import { splitFrontmatter } from "../../pages/markdown/frontmatter";
import { setFrontmatterKey } from "../../pages/page/page-meta";
import { MemoryReferences } from "./memory-references";
import { eolOf } from "./memory-notes";
import { newId, slugify, stamps } from "./vault-text";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MOST_DAYS = 200;

export class MemoryJournals extends MemoryReferences implements JournalOps {
  /** The folder of a project named by folder or title; refused when there is none. */
  private journalFolder(project: string): string {
    const folder = slugify(project);
    if (!folder || project.includes("/") || project.includes("..")) throw new Error(`Not a project folder: ${project}`);
    if (!this.data.files[`projects/${folder}/_project.md`]) throw new Error(`No project called ${project}`);
    return folder;
  }

  override async journal(date: string, project?: string | null): Promise<NoteFile> {
    if (!project) return super.journal(date);
    if (!DAY.test(date)) throw new Error(`Not a day: ${date}`);
    const folder = this.journalFolder(project);
    const path = `projects/${folder}/journal/${date.slice(0, 4)}/${date}.md`;
    if (this.data.files[path]) return this.get(path);
    const stamp = stamps(this.now()).rfc3339;
    let prefix = "";
    for (const [key, value] of [["id", newId(this.now())], ["title", date], ["type", "journal"], ["created", stamp], ["updated", stamp]] as const) prefix = setFrontmatterKey(prefix, key, value, "\n");
    return this.put(path, prefix);
  }

  async journalAppend(date: string, markdown: string, heading?: string | null, project?: string | null): Promise<NoteFile> {
    const day = await this.journal(date, project);
    const { prefix, body } = splitFrontmatter(day.text);
    const eol = eolOf(day.text);
    const lead = body === "" || body.endsWith("\n") ? body : body + eol;
    const title = heading?.trim();
    const piece = markdown.trim() + eol;
    const named = title ? body.split(/\r?\n/).some((line) => /^#{1,6}[ \t]+/.test(line) && line.replace(/^#{1,6}[ \t]+/, "").trim() === title) : true;
    const added = named ? lead + piece : `${lead}${lead ? eol : ""}## ${title}${eol}${piece}`;
    const next = setFrontmatterKey(prefix, "updated", stamps(this.now()).rfc3339, eol);
    return this.put(day.meta.path, next + added);
  }

  async projectJournalsOn(date: string): Promise<ProjectJournalRef[]> {
    const refs: ProjectJournalRef[] = [];
    for (const path of Object.keys(this.data.files)) {
      const m = /^projects\/([^/]+)\/journal\/\d{4}\/(\d{4}-\d{2}-\d{2})\.md$/.exec(path);
      if (!m || m[2] !== date) continue;
      refs.push({ project: m[1]!, projectTitle: this.projectTitle(m[1]!), path, date });
    }
    return refs.sort((a, b) => a.projectTitle.localeCompare(b.projectTitle));
  }

  async projectJournalDays(project: string, limit = 30, offset = 0): Promise<ProjectJournalPage> {
    const folder = this.journalFolder(project);
    const all: ProjectJournalDay[] = [];
    for (const path of Object.keys(this.data.files)) {
      const m = new RegExp(`^projects/${folder}/journal/\\d{4}/(\\d{4}-\\d{2}-\\d{2})\\.md$`).exec(path);
      if (!m) continue;
      const meta = this.metaOf(path);
      all.push({ date: m[1]!, path, excerpt: meta.excerpt, words: meta.words, modified: meta.modified });
    }
    all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const take = Math.min(Math.max(limit, 1), MOST_DAYS);
    return { project: folder, projectTitle: this.projectTitle(folder), total: all.length, days: all.slice(offset, offset + take) };
  }

  private projectTitle(folder: string): string {
    return this.metaOf(`projects/${folder}/_project.md`).title;
  }
}
