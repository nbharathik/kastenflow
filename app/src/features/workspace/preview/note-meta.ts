// A note's metadata from its path and text, as kasten-core's index gives
// it: kind, title, project, dates, tags, excerpt and properties.

import { splitFrontmatter } from "../../pages/markdown/frontmatter";
import { readKeys } from "../../pages/page/page-meta";
import type { NoteMeta } from "../../../lib/vault/types";
import { propsOf } from "./memory-extras";
import { bodyFacts } from "./vault-text";

function kindFromPath(path: string): string {
  const parts = path.split("/");
  if (parts[0] === "journal") return "journal";
  if (parts[0] === "templates") return "template";
  if (parts[0] === "inbox") return "card";
  if (parts[0] === "projects" && parts.length === 3 && parts[2] === "_project.md") return "project";
  if (parts[0] === "projects" && parts[2] === "cards") return "card";
  return "page";
}

export function metaFor(path: string, text: string, modified: number): NoteMeta {
  const split = splitFrontmatter(text);
  const { values, tags } = readKeys(split.prefix);
  const text_ = (key: string) => (values[key]?.trim() ? values[key]!.trim() : null);
  const facts = bodyFacts(split.body, text_("title"));
  const parts = path.split("/");
  const project = parts[0] === "projects" && parts.length >= 3 ? parts[1]! : null;
  const stem = parts[parts.length - 1]!.replace(/\.md$/, "");
  const fromPath = kindFromPath(path);
  const order = idsOf(/^children_order[ \t]*:(.*?)\r?$/m.exec(split.prefix)?.[1]?.trim() ?? "");
  return {
    path,
    id: text_("id"),
    title: text_("title") ?? (stem === "_project" ? (project ?? stem) : stem),
    kind: fromPath === "template" ? fromPath : (text_("type") ?? fromPath),
    icon: text_("icon"),
    cover: text_("cover"),
    parent: text_("parent"),
    project,
    tags,
    modified,
    created: text_("created"),
    updated: text_("updated"),
    excerpt: facts.excerpt,
    words: facts.words,
    props: propsOf(split.prefix),
    locked: text_("locked") === "true",
    ...(order.length > 0 ? { childrenOrder: order } : {}),
  };
}

/** The ids in a flow list, quotes dropped; none for anything else. */
function idsOf(raw: string): string[] {
  if (!raw.startsWith("[")) return [];
  return raw
    .slice(1, raw.lastIndexOf("]"))
    .split(",")
    .map((id) => id.trim().replace(/^(["'])(.*)\1$/, "$2"))
    .filter(Boolean);
}
