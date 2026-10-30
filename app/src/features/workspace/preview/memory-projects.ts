// The browser preview's part for projects: each project's state, summaries and
// setups (the client's project calls, `ProjectOps`), the vault's revision
// counters and its health report. Inside the app the core does these
// (engine/projects.rs, setups.rs, revision.rs and health.rs).

import { dayFrom, isoDay } from "../../../lib/dates";
import type { Health } from "../../../lib/vault/health-types";
import type { AppliedSetup, ProjectStateChange, ProjectSummary, SavedSetup, SetupGone, SetupInfo, SetupPlan, SetupSource, SetupTarget } from "../../../lib/vault/project-types";
import type { Revision } from "../../../lib/vault/revision-types";
import type { NoteFile, VaultEvents } from "../../../lib/vault/types";
import { splitFrontmatter } from "../../pages/markdown/frontmatter";
import { setFrontmatterKey } from "../../pages/page/page-meta";
import { parseSchema, propsBlock } from "./memory-extras";
import { isConflictCopy, previewHealth } from "./memory-health";
import { eolOf } from "./memory-notes";
import { MemoryPictures } from "./memory-pictures";
import { Revisions, sign, type Signs } from "./memory-revision";
import { checkName, idOf, infoOf, SAVED_PREFIX, saveSetup, sourceOf, type Saved, type SourceHost } from "./memory-saved-setups";
import { appliedFrom, planSetup, setupInfos, type Planned } from "./memory-setups";
import { checkProps } from "./props-check";
import { findTask, stateProps } from "./project-state";
import { summarise } from "./project-summaries";
import { stamps } from "./vault-text";

export class MemoryProjects extends MemoryPictures {
  /** Made when first asked for or first written to (see `persist`). */
  private ledger?: Revisions;

  /** A fingerprint of each kind of file the preview holds; a class that keeps another kind adds its own. */
  protected revisionSigns(): Signs {
    const { files, boards, decks, diagrams, drawings, tags, sidecars } = this.data;
    return { notes: sign(files), boards: sign(boards), decks: sign({ ...decks, ...diagrams, ...drawings }), tags: sign(tags), annotations: sign(sidecars) };
  }

  private revisions(known = true): Revisions {
    return (this.ledger ??= new Revisions(this.now(), this.revisionSigns(), known));
  }

  /** Every write goes through here: the counters move for the kinds of file that changed. */
  protected override persist(): void {
    super.persist();
    if (!this.ledger) this.revisions(false);
    else this.ledger.update(this.revisionSigns());
  }

  async revision(): Promise<Revision> {
    return this.revisions().revision;
  }

  /** The preview has no outside changes or commits to report, only its counters. */
  watch(events: VaultEvents): () => void {
    return this.revisions().watch((revision) => events.revised?.(revision));
  }

  async projectSummaries(today: string = dayFrom()): Promise<ProjectSummary[]> {
    const notes = await this.list();
    return summarise({ notes, textOf: (path) => this.data.files[path]?.text ?? "", boards: await this.boards(), decks: await this.decks(), today });
  }

  async setProjectState(path: string, change: ProjectStateChange): Promise<NoteFile> {
    if (!/^projects\/[^/]+\/_project\.md$/.test(path)) throw new Error("Only a project page has a status, a health and a next action");
    const current = this.get(path);
    const changes: Record<string, unknown> = stateProps(change);
    // The page's own tags may define these properties: their rules hold too.
    const schemas = Object.entries(this.data.tags ?? {}).map(([p, yaml]) => parseSchema(p, yaml));
    try {
      checkProps(schemas, current.meta.tags, changes);
    } catch (err) {
      const owner = schemas.find((s) => current.meta.tags.some((t) => t.toLowerCase() === s.name.toLowerCase()) && s.properties.some((p) => p.key in changes));
      throw new Error(`${err instanceof Error ? err.message : String(err)}${owner ? ` (the tag #${owner.name} defines it)` : ""}`, { cause: err });
    }
    if (change.nextAction !== undefined) changes.next_action = change.nextAction === null ? null : this.parentId(findTask(await this.list(), change.nextAction).path);
    // Read after: the next action's task may be this very page.
    return this.writeProps(path, changes);
  }

  /** The page's `props:` with `changes` merged in (null removes a key); nothing is written when nothing changes. */
  private writeProps(path: string, changes: Record<string, unknown>): NoteFile {
    const current = this.get(path);
    const merged: Record<string, unknown> = { ...current.meta.props };
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) delete merged[key];
      else merged[key] = value;
    }
    if (JSON.stringify(merged) === JSON.stringify(current.meta.props)) return current;
    const eol = eolOf(current.text);
    const { prefix, body } = splitFrontmatter(current.text);
    const block = propsBlock(merged, eol);
    const withProps = setFrontmatterKey(prefix, "props", block === null ? null : "\u0000", eol, true).replace("props: \u0000", `props:${block}`);
    return this.put(path, setFrontmatterKey(withProps, "updated", stamps(this.now()).rfc3339, eol) + body);
  }

  /** The setups saved from projects, for the session (inside the app they are files in the vault). */
  private readonly savedSetups = new Map<string, Saved>();

  async listSetups(): Promise<SetupInfo[]> {
    const mine = [...this.savedSetups.values()].map(infoOf).sort((a, b) => a.name.localeCompare(b.name));
    return [...setupInfos(), ...mine];
  }

  private async sourceHost(): Promise<SourceHost> {
    return { notes: await this.list(), textOf: (path) => this.data.files[path]?.text ?? "", tagYaml: this.data.tags ?? {}, tagName: (path, yaml) => parseSchema(path, yaml).name };
  }

  async previewProjectSetup(project: string): Promise<SetupSource> {
    return sourceOf(await this.sourceHost(), project);
  }

  async saveProjectSetup(project: string, title: string, pages: string[], slug = ""): Promise<SavedSetup> {
    const { saved, result } = saveSetup(await this.sourceHost(), project, title, pages, (taken) => this.savedSetups.has(idOf(taken)), slug);
    this.savedSetups.set(idOf(saved.slug), saved);
    return result;
  }

  async renameSetup(id: string, name: string): Promise<SetupInfo> {
    const saved = this.savedSetups.get(id);
    if (!saved) throw new Error(`There is no setup “${id}”`);
    saved.manifest.name = checkName(name);
    return infoOf(saved);
  }

  async trashSetup(id: string): Promise<SetupGone> {
    const saved = this.savedSetups.get(id);
    if (!saved) throw new Error(`There is no setup “${id}”`);
    this.savedSetups.delete(id);
    return { id, trashed: `.trash/setups/${saved.slug}.yaml`, commit: null };
  }

  private planned(id: string, target: SetupTarget): Planned {
    const day = isoDay(new Date(this.now()));
    const custom = id.startsWith(SAVED_PREFIX) ? this.savedSetups.get(id) : undefined;
    if (id.startsWith(SAVED_PREFIX) && !custom) throw new Error(`There is no setup “${id}”`);
    return planSetup(
      id,
      target,
      {
        exists: (path) => this.hasFile(path),
        page: (path) => {
          const file = this.data.files[path];
          return file ? { title: this.get(path).meta.title, props: this.get(path).meta.props } : null;
        },
      },
      this.now(),
      day,
      custom,
    );
  }

  /** Whether the preview holds a file of any kind at `path`. */
  private hasFile(path: string): boolean {
    const { files, boards, decks, tags } = this.data;
    return Boolean(files[path] || boards?.[path] !== undefined || decks?.[path] !== undefined || tags?.[path] !== undefined);
  }

  async previewSetup(id: string, target: SetupTarget): Promise<SetupPlan> {
    return this.planned(id, target).plan;
  }

  async applySetup(id: string, target: SetupTarget): Promise<AppliedSetup> {
    const planned = this.planned(id, target);
    const { plan } = planned;
    if (planned.isNew) {
      // A plain project page, as the sidebar's "New project" makes one.
      const made = await this.create({ kind: "project", title: planned.title, date: isoDay(new Date(this.now())), template: null });
      // The page may have taken another folder than the plan: the files follow the plan.
      if (made.meta.path !== plan.projectPath) throw new Error("That project name was taken meanwhile; try again");
    }
    for (const { path, text } of planned.files) {
      if (path.endsWith(".canvas")) (this.data.boards ??= {})[path] = text;
      else if (path.endsWith(".deck")) (this.data.decks ??= {})[path] = text;
      else if (path.endsWith(".yaml")) (this.data.tags ??= {})[path] = text;
      else this.put(path, text);
    }
    if (Object.keys(planned.add).length) this.writeProps(plan.projectPath, planned.add);
    this.persist();
    return appliedFrom(plan);
  }

  async vaultHealth(): Promise<Health> {
    const notes = await this.list();
    const trash = Object.keys(this.data.trash);
    return previewHealth({
      revision: this.revisions().revision,
      counts: {
        notes: notes.filter((n) => n.kind !== "template").length,
        boards: Object.keys(this.data.boards ?? {}).filter((p) => p.endsWith(".canvas")).length,
        decks: Object.keys(this.data.decks ?? {}).length,
        diagrams: Object.keys(this.data.diagrams ?? {}).length,
        sources: (await this.sources()).length,
        assets: (await this.assets()).length,
      },
      trash: trash.length,
      conflicts: notes.map((n) => n.path).filter(isConflictCopy),
      indexed: notes.length,
    });
  }
}
