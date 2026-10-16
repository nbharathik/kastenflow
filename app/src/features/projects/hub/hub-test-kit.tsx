// What the hub's component tests share: a fake vault client that answers with
// a list of project summaries, and the window's stores put back to a clean start.

import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

import type { ProjectStateChange, ProjectSummary } from "../../../lib/vault/project-types";
import type { NoteFile, NoteMeta, VaultClient } from "../../../lib/vault/types";
import { usePrefs } from "../../workspace/prefs";
import { useWorkspace } from "../../workspace/store";
import { derive } from "../../workspace/store-layout";
import { initialLayout } from "../../workspace/tabs";
import { DEFAULT_HUB, useHubPrefs } from "./hub-prefs";
import { ProjectsHub } from "./ProjectsHub";
import { projectNote } from "./test-support";

export const fileOf = (meta: NoteMeta): NoteFile => ({ meta, text: "" }) as NoteFile;

/** The page properties that say what a summary says. */
function propsOf(s: ProjectSummary): Record<string, unknown> {
  return {
    ...(s.status !== "Active" ? { status: s.status } : {}),
    ...(s.health ? { health: s.health } : {}),
    ...(s.archived ? { archived: true } : {}),
  };
}

export interface Fake {
  client: Record<string, ReturnType<typeof vi.fn>>;
  notes: NoteMeta[];
}

/** Puts the stores back to a clean start and gives the workspace a fake client for `list`. */
export function setup(list: ProjectSummary[], extra: Record<string, unknown> = {}): Fake {
  localStorage.clear();
  useHubPrefs.setState({ vault: "", prefs: DEFAULT_HUB });
  usePrefs.setState({ pinnedProjects: [], projectOrder: [], tabSets: [], newTabs: false, pageLinksOpen: "here" });
  const notes = list.map((s) => projectNote(s.folder, s.title, { props: propsOf(s) }));
  const client = {
    label: "test-vault",
    kind: "vault",
    projectSummaries: vi.fn(async () => list),
    setProjectState: vi.fn(async (path: string, change: ProjectStateChange) => {
      const note = useWorkspace.getState().notes.find((n) => n.path === path)!;
      const props = { ...note.props };
      for (const [key, value] of Object.entries(change)) {
        if (value === null) delete props[key];
        else props[key] = value;
      }
      return fileOf({ ...note, props });
    }),
    updateProps: vi.fn(async (path: string, change: Record<string, unknown>) => {
      const note = useWorkspace.getState().notes.find((n) => n.path === path)!;
      const props = { ...note.props };
      for (const [key, value] of Object.entries(change)) {
        if (value === null) delete props[key];
        else props[key] = value;
      }
      return fileOf({ ...note, props });
    }),
    create: vi.fn(async (draft: { title: string; kind: string; project?: string }) => fileOf(projectNote(draft.project ?? "new", draft.title, { path: `projects/${draft.project ?? "new"}/pages/${draft.title}.md`, kind: draft.kind as NoteMeta["kind"] }))),
    listSetups: vi.fn(async () => []),
    ...extra,
  } as unknown as Fake["client"];
  useWorkspace.setState({ client: client as unknown as VaultClient, ready: true, notes, ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  return { client, notes };
}

/** Draws the hub and waits for its first answer. */
export async function mountHub(name: "Project gallery" | "Project list" = "Project gallery"): Promise<void> {
  render(<ProjectsHub />);
  await screen.findByRole("list", { name });
}

/** The card or row of a project. */
export const cardOf = (title: string): HTMLElement => screen.getByRole("button", { name: `Open ${title}` }).closest("li")!;
/** The titles shown, in order. */
export const titles = (): string[] => screen.getAllByRole("button", { name: /^Open / }).map((b) => b.getAttribute("aria-label")!.slice("Open ".length));
