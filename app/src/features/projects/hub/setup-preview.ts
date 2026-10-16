// What a project setup would make, in words, from the plan the core works out
// without writing anything. Pure.

import type { SetupPlan } from "../../../lib/vault/project-types";

export interface PlanText {
  /** Names (no folder, no extension) of what it makes, by kind. */
  pages: string[];
  boards: string[];
  decks: string[];
  databases: string[];
  /** Files that are there already and stay as they are. */
  kept: number;
  /** One sentence: "The project page, 2 pages and 1 deck." */
  sentence: string;
}

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function describePlan(plan: SetupPlan): PlanText {
  const mine = plan.create.filter((path) => path !== plan.projectPath);
  const ends = (ext: string) => mine.filter((p) => p.endsWith(ext)).map(nameOf);
  const pages = ends(".md");
  const boards = ends(".canvas");
  const decks = ends(".deck");
  const databases = ends(".yaml");
  const parts = [
    plan.create.includes(plan.projectPath) ? "The project page" : "",
    pages.length ? plural(pages.length, "page") : "",
    boards.length ? plural(boards.length, "whiteboard") : "",
    decks.length ? plural(decks.length, "deck") : "",
    databases.length ? plural(databases.length, "tag database") : "",
  ].filter(Boolean);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "");
  const sentence = parts.length === 0 ? "Nothing: everything it makes is there already." : `${list}.`;
  return { pages, boards, decks, databases, kept: plan.keep.length, sentence };
}
