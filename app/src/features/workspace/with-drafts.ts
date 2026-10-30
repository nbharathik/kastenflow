// The vault client as the window uses it, with drafts (drafts.ts) in front:
// a call about a draft that has no page yet answers as an empty page would,
// the first input makes the page (with that input, in one commit), and
// every later call about the draft goes to the page it became. The table
// below says what each call does with a draft; the compiler makes sure no
// call is left out when the client grows.

import { localStamp } from "../templates/template-vars";
import { AGENT_MODE_RULES } from "../../lib/vault/agent-mode-types";
import { ANNOTATION_RULES } from "../../lib/vault/annotation-types";
import { BATCH_RULES } from "../../lib/vault/batch-types";
import { BUNDLE_RULES } from "../../lib/vault/bundle-types";
import { COLLECTION_RULES } from "../../lib/vault/collection-types";
import type { DraftRule as Rule } from "../../lib/vault/draft-rule";
import { HEALTH_RULES } from "../../lib/vault/health-types";
import { PROJECT_RULES } from "../../lib/vault/project-types";
import { REFERENCE_RULES } from "../../lib/vault/reference-types";
import { REVISION_RULES } from "../../lib/vault/revision-types";
import type { NewNote, NoteFile, Placed, VaultClient } from "../../lib/vault/types";
import { splitFrontmatter } from "../pages/markdown/frontmatter";
import { DRAFT_HASH, draftFile, draftSpec, dropDraft, isDraft, madeOf, markMade, nowAt } from "./drafts";

type Fn = (...args: never[]) => unknown;
type MethodName = { [K in keyof VaultClient]-?: NonNullable<VaultClient[K]> extends Fn ? K : never }[keyof VaultClient];

// What each rule means: lib/vault/draft-rule.ts.
const none = { empty: () => [] };

const RULES = {
  list: "pass",
  notesAt: "own",
  missingTemplates: "pass",
  addStarterTemplates: "pass",
  kits: "pass",
  addKit: "pass",
  saveAsTemplate: "make",
  addTour: "pass",
  read: "own",
  create: "own",
  saveBody: "own",
  setMeta: "own",
  rename: "own",
  move: "own",
  moveToInbox: "make",
  nest: "own",
  reorderChildren: "own",
  convert: "own",
  duplicate: "make",
  trash: "own",
  journal: "pass",
  applyTemplate: "own",
  search: "pass",
  backlinks: none,
  listTrash: "pass",
  readTrashed: "pass",
  emptyTrash: "pass",
  restore: "pass",
  restoreBoard: "pass",
  restoreDeck: "pass",
  capture: "pass",
  mentions: "own",
  dayMentions: "pass",
  related: none,
  tasks: "pass",
  history: none,
  version: "own",
  restoreVersion: "make",
  restoreVault: "pass",
  commitEdits: "pass",
  status: "pass",
  startHistory: "pass",
  pushNow: "pass",
  getConfig: "pass",
  setConfig: "pass",
  verify: "pass",
  noteStats: "pass",
  tagSchemas: "pass",
  setTagViews: "pass",
  setTagProperties: "pass",
  tagFormulas: "pass",
  checkFormula: "pass",
  updateProps: "make",
  setTags: "make",
  replaceSection: "make",
  append: "make",
  saveAsset: "pass",
  boards: "pass",
  board: "pass",
  createBoard: "pass",
  addToBoard: "own",
  addSticky: "pass",
  connect: "pass",
  group: "pass",
  boardApply: "pass",
  boardsWith: none,
  decks: "pass",
  deck: "pass",
  references: "pass",
  createDeck: "pass",
  saveDeck: "pass",
  saveDecks: "pass",
  deckTemplates: "pass",
  createDeckTemplate: "pass",
  diagrams: "pass",
  diagram: "pass",
  diagramPreview: "pass",
  diagramDraftSvg: "pass",
  createDiagram: "pass",
  importDiagram: "pass",
  saveDiagram: "pass",
  saveDiagramPreview: "pass",
  renameDiagram: "pass",
  moveDiagram: "pass",
  duplicateDiagram: "pass",
  restoreDiagram: "pass",
  proposals: "pass",
  acceptProposal: "pass",
  acceptProposalHunks: "pass",
  rejectProposal: "pass",
  sessions: "pass",
  activityDigest: "pass",
  undoSession: "pass",
  clipUrl: "pass",
  trustSession: "pass",
  commitChanges: "pass",
  agentMarks: none,
  acceptAgentMarks: { empty: () => undefined },
  agentMarked: "own",
  watch: "pass",
  importSource: "pass",
  readAsset: "pass",
  addAsset: "pass",
  assets: "pass",
  asset: "pass",
  setAssetMeta: "pass",
  assetThumb: "pass",
  assetUsage: "pass",
  assetsUsage: "pass",
  saveDownload: "pass",
  readSource: "pass",
  sources: "pass",
  highlights: "pass",
  allHighlights: "pass",
  addHighlight: "pass",
  editHighlight: "pass",
  removeHighlight: "pass",
  highlightCard: "pass",
  planImport: "pass",
  importNotes: "pass",
  undoCommit: "pass",
  findUnder: "pass",
  replaceUnder: "pass",
  graph: "pass",
  // The rows of the features that bring their own calls (lib/vault/*-types.ts).
  ...PROJECT_RULES,
  ...COLLECTION_RULES,
  ...ANNOTATION_RULES,
  ...REFERENCE_RULES,
  ...BUNDLE_RULES,
  ...HEALTH_RULES,
  ...AGENT_MODE_RULES,
  ...BATCH_RULES,
  ...REVISION_RULES,
} satisfies Record<MethodName, Rule>;

type Own = { [K in MethodName]: (typeof RULES)[K] extends "own" ? K : never }[MethodName];

export interface DraftHooks {
  /** The draft at `draft` became `note`: tabs and lists follow it. */
  onMade(draft: string, note: NoteFile): void;
  /** The person's day, YYYY-MM-DD. */
  today?: () => string;
}

const placed = (note: NoteFile): Placed => ({ ...note, moves: [], relinked: [] });

export function withDrafts(client: VaultClient, hooks: DraftHooks): VaultClient {
  const making = new Map<string, Promise<NoteFile>>();
  const today = hooks.today ?? (() => localStamp());

  /** Makes the draft's page, once, with what its first input brings. */
  function make(path: string, first: Partial<NewNote> = {}): Promise<NoteFile> {
    const done = madeOf(path);
    if (done) return Promise.resolve(done);
    let pending = making.get(path);
    if (!pending) {
      const spec = draftSpec(path) ?? { kind: "page", title: "" };
      pending = client.create({ ...spec, date: today(), ...first }).then((note) => {
        markMade(path, note);
        hooks.onMade(path, note);
        return note;
      });
      making.set(path, pending);
      const settled = () => void making.delete(path);
      pending.then(settled, settled);
    }
    return pending;
  }

  /** A draft with no page yet, and none on the way. */
  const untouched = (path: string | null | undefined): path is string => typeof path === "string" && isDraft(path) && !madeOf(path) && !making.has(path);
  /** Where a call about `path` goes: a draft's page, made if need be. */
  const real = async (path: string) => (isDraft(path) ? (await make(path)).meta.path : path);
  /** The paths that have notes, a made draft's by its page. */
  const known = (paths: string[]) => paths.filter((p) => !isDraft(p) || madeOf(p)).map(nowAt);

  const own: Pick<VaultClient, Own> = {
    notesAt: (paths) => client.notesAt(known(paths)),
    agentMarked: (paths) => client.agentMarked(known(paths)),
    read: async (path) => (untouched(path) ? draftFile(path) : client.read(await real(path))),
    create: async (note) => client.create(note.parent && isDraft(note.parent) ? { ...note, parent: await real(note.parent) } : note),
    async saveBody(path, body, base) {
      if (untouched(path)) return { status: "written", note: await make(path, { body }) };
      const at = await real(path);
      // Typed on the empty draft while another input made the page: it
      // builds on the page as it is, when that has no text yet.
      if (base === DRAFT_HASH) {
        const current = await client.read(at);
        base = splitFrontmatter(current.text).body.trim() ? madeOf(path)!.hash : current.hash;
      }
      return client.saveBody(at, body, base);
    },
    async setMeta(path, key, value) {
      if (untouched(path) && (key === "icon" || key === "title")) return value === null ? draftFile(path) : make(path, key === "icon" ? { icon: value } : { title: value });
      return client.setMeta(await real(path), key, value);
    },
    rename: async (path, title) => (untouched(path) ? { note: await make(path, { title }), relinked: [] } : client.rename(await real(path), title)),
    applyTemplate: async (path, template, date) => (untouched(path) ? make(path, { template, date }) : client.applyTemplate(await real(path), template, date)),
    move: async (path, project) => (untouched(path) ? placed(await make(path, { project })) : client.move(await real(path), project)),
    async nest(path, parent) {
      const under = parent === null ? null : await real(parent);
      return untouched(path) ? placed(await make(path, { parent: under })) : client.nest(await real(path), under);
    },
    reorderChildren: async (parent, ids) => client.reorderChildren(await real(parent), ids),
    convert: async (path, kind) => (untouched(path) ? placed(await make(path, { kind })) : client.convert(await real(path), kind)),
    async trash(path) {
      // A draft never written in goes without a trace.
      if (untouched(path)) {
        dropDraft(path);
        return "";
      }
      return client.trash(await real(path));
    },
    mentions: async (title, path) => (untouched(path) ? [] : client.mentions(title, nowAt(path))),
    version: async (rev, path) => (untouched(path) ? null : client.version(rev, await real(path))),
    addToBoard: async (board, notes, ...rest) => client.addToBoard(board, await Promise.all(notes.map(real)), ...rest),
  };

  const out: Record<string, unknown> = { kind: client.kind, label: client.label, kept: client.kept };
  const methods = client as unknown as Record<string, ((...args: unknown[]) => unknown) | undefined>;
  for (const [name, rule] of Object.entries(RULES) as [MethodName, Rule][]) {
    if (!methods[name]) continue;
    // Looked up at each call, so a method swapped on the client later is the one used.
    const method = (...args: unknown[]) => methods[name]!.apply(client, args);
    if (rule === "own") out[name] = own[name as Own];
    else if (rule === "pass") out[name] = method;
    else if (rule === "make") out[name] = async (path: string, ...rest: unknown[]) => method(await real(path), ...rest);
    else out[name] = async (path: string, ...rest: unknown[]) => (untouched(path) ? rule.empty() : method(isDraft(path) ? await real(path) : path, ...rest));
  }
  // What a client adds beyond VaultClient (the browser preview's stand-ins
  // for agent sessions: agentCreate, brainstorm, saveChat) never names a
  // draft, so it passes through as it is.
  for (let proto: object | null = client; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === "constructor" || name in out || name in RULES) continue;
      if (typeof Object.getOwnPropertyDescriptor(proto, name)?.value !== "function") continue;
      out[name] = (...args: unknown[]) => methods[name]!.apply(client, args);
    }
  }
  return out as unknown as VaultClient;
}
