// What the browser preview keeps in its storage: notes, the trash, versions,
// boards, slide decks, tag schemas, highlight sidecars and settings, as one JSON value.

import type { VaultConfig } from "../../../lib/vault/types";

export interface Version {
  id: string;
  time: number;
  summary: string;
  text: string | null;
  /** An agent's version: its session and client (agent-sessions.ts). */
  session?: string;
  client?: string;
  /** The version this one undid. */
  undoes?: string;
  /** A board's version: the board before it, as a person's board edits keep no versions. */
  before?: string | null;
}

export interface Stored {
  files: Record<string, { text: string; modified: number }>;
  trash: Record<string, { text: string; when: string; original: string }>;
  /** Earlier versions by path, oldest first (the preview's history). */
  versions?: Record<string, Version[]>;
  /** Boards (`.canvas` JSON) and tag schemas (`tags/*.yaml`) by path. */
  boards?: Record<string, string>;
  /** Slide decks (`.deck` JSON) by path. */
  decks?: Record<string, string>;
  /** Diagram sources (`.drawio` XML) by path, and the pictures beside them (`.drawio.svg`, stamped) by their own path. */
  diagrams?: Record<string, string>;
  drawings?: Record<string, string>;
  tags?: Record<string, string>;
  /** Highlight sidecars (`sources/*.highlights.json`) by path. */
  sidecars?: Record<string, string>;
  /** Saved collections (`views/*.yaml`) by path. */
  views?: Record<string, string>;
  config?: VaultConfig;
}

export interface PreviewStorage {
  load(): string | null;
  save(data: string): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The preview's saved data, or null when there is none or it cannot be
 * read: then the samples start afresh. Notes whose text is not text are
 * left out. */
export function readStored(text: string | null | undefined): Stored | null {
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || !isRecord(value.files)) return null;
  const files: Stored["files"] = {};
  for (const [path, file] of Object.entries(value.files)) {
    if (isRecord(file) && typeof file.text === "string") files[path] = { text: file.text, modified: typeof file.modified === "number" ? file.modified : 0 };
  }
  return { ...(value as Partial<Stored>), files, trash: isRecord(value.trash) ? (value.trash as Stored["trash"]) : {} };
}
