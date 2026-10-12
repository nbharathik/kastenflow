// Shared by the Projects list's tests: a small vault of three projects, the
// shell drawn against the browser preview's MemoryVault, and ways to read
// and work the list.

import { act, createEvent, fireEvent, render, screen, within } from "@testing-library/react";

import { useBoards } from "../../features/boards/store";
import { usePrefs } from "../../features/workspace/prefs";
import { MemoryVault } from "../../features/workspace/preview/memory-vault";
import { derive } from "../../features/workspace/store-layout";
import { useWorkspace } from "../../features/workspace/store";
import { initialLayout } from "../../features/workspace/tabs";
import { useShell } from "../../lib/store";
import { AppShell } from "../AppShell";

export const BETA = "---\ntitle: Beta\ntype: project\n---\nSecond.\n";
export const GAMMA = "projects/gamma/_project.md";
export const SEED: Record<string, string> = {
  "projects/alpha/_project.md": "---\ntitle: Alpha\ntype: project\n---\nFirst.\n",
  "projects/beta/_project.md": BETA,
  "projects/beta/pages/plan.md": "---\ntitle: Plan\n---\nSoon.\n",
  [GAMMA]: "---\ntitle: Gamma\ntype: project\n---\nThird.\n",
};
/** The same vault with Gamma archived. */
export const ARCHIVED = { ...SEED, [GAMMA]: "---\ntitle: Gamma\ntype: project\nprops:\n  archived: true\n---\nThird.\n" };

/** A fresh window: no preferences, nothing open. */
export function freshWindow(): void {
  localStorage.clear();
  usePrefs.setState({ favourites: [], projectOrder: [], pinnedProjects: [], pinnedPages: [], sidebarShowCards: false, navPinned: null, moreViews: false });
  useBoards.setState({ list: [], loaded: false });
  useWorkspace.setState({ client: null, ready: false, notes: [], ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  useShell.setState({ sidebarOpen: true, focusMode: false, paletteOpen: false, panels: [] });
}

/** Draws the shell on `vault`; resolves to the sidebar's Projects section. */
export async function renderShell(vault: MemoryVault): Promise<HTMLElement> {
  render(<AppShell connect={async () => ({ client: vault })} />);
  const sidebar = await screen.findByRole("navigation", { name: "Sidebar" });
  const projects = await within(sidebar).findByRole("region", { name: "Projects" });
  await within(projects).findByText("Alpha");
  return projects;
}

/** The main list's projects, top to bottom, by folder. */
export const order = (projects: HTMLElement) => [...projects.querySelectorAll<HTMLElement>("li[data-project]")].map((li) => li.dataset.project);

export const rowOf = (projects: HTMLElement, key: string) => projects.querySelector<HTMLElement>(`li[data-project="${key}"]`)!;

/** A project's own line, which drags; its pages nest below it. */
export const lineOf = (row: HTMLElement) => row.firstElementChild as HTMLElement;

/** Picks `item` from the menu of the row titled `title`. */
export async function choose(projects: HTMLElement, title: string, item: RegExp): Promise<void> {
  fireEvent.click(within(projects).getByRole("button", { name: `More for ${title}` }));
  await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: item })));
}

/** A DataTransfer good enough for jsdom, whose types follow what was set. */
export function transfer() {
  const data = new Map<string, string>();
  return {
    data,
    get types() {
      return [...data.keys()];
    },
    effectAllowed: "",
    dropEffect: "",
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
  };
}

/** A drag event at height `y` (jsdom has no DragEvent to carry it); false when the list took it. */
export function dragAt(kind: "dragOver" | "drop", target: HTMLElement, dataTransfer: object, y: number): boolean {
  const event = createEvent[kind](target, { dataTransfer });
  Object.defineProperty(event, "clientY", { value: y });
  return fireEvent(target, event);
}
