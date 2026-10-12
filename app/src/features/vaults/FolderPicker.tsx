// A folder browser for the vault chooser: places to start from,
// the path so far, and the folders in it, each marked as a Kasten vault, an
// Obsidian vault or a folder of notes. A click selects a folder, a double
// click (or Enter) goes into it, and Choose takes the selected folder, or
// the one open when none is. It reads folder names only. Given `files`, it
// picks a file of that kind instead, such as a backup file.

import { useEffect, useState } from "react";

import { browseFolders, type FolderKind, type FolderListing } from "../../lib/api";
import { Icon } from "../../ui/Icon";
import type { IconName } from "../../ui/icons";
import { Modal } from "../../ui/Modal";

const KINDS: Record<FolderKind, { icon: IconName; badge: string | null }> = {
  kasten: { icon: "cards", badge: "KastenFlow vault" },
  obsidian: { icon: "folder", badge: "Obsidian vault" },
  notes: { icon: "folder", badge: "Notes" },
  folder: { icon: "folder", badge: null },
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The path as steps to click back to: `/`, `home`, `a` or `C:`, `Users`. */
export function crumbs(path: string): { label: string; path: string }[] {
  const windows = /^[A-Za-z]:[\\/]/.test(path) || (path.includes("\\") && !path.includes("/"));
  const sep = windows ? "\\" : "/";
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (windows) {
    return parts.map((label, i) => ({ label, path: i === 0 ? `${label}${sep}` : parts.slice(0, i + 1).join(sep) }));
  }
  return [{ label: "/", path: "/" }, ...parts.map((label, i) => ({ label, path: `/${parts.slice(0, i + 1).join("/")}` }))];
}

/** A file's size, as people say it. */
export function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The last name in a path. */
export const baseName = (path: string) => path.split(/[\\/]+/).filter(Boolean).pop() ?? path;

interface Props {
  title: string;
  /** Where to start; the documents folder when empty. */
  start?: string;
  /** What the pick is for, on its button: "Choose", "Open". */
  pickLabel?: string;
  /** Pick a file ending in `.files` rather than a folder. */
  files?: string;
  onPick(path: string): void;
  onClose(): void;
}

export function FolderPicker({ title, start, pickLabel = "Choose", files, onPick, onClose }: Props) {
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = (path?: string) =>
    browseFolders(path, files).then(
      (found) => {
        setListing(found);
        setSelected(null);
        setError(null);
      },
      (err: unknown) => setError(message(err)),
    );

  // A start that no longer exists falls back to the documents folder.
  useEffect(() => {
    void browseFolders(start || undefined, files).then(setListing, () => go());
    // Only the first folder comes from `start`.
  }, []);

  // A file must be picked; a folder may be the one open.
  const target = selected ?? (files ? null : (listing?.path ?? null));
  return (
    <Modal label={title} onClose={onClose} className="kasten-folder-picker">
      <header className="kasten-folder-picker-head">
        <h2>{title}</h2>
        <button type="button" className="kasten-folder-picker-close" aria-label="Close" onClick={onClose}>
          <Icon name="close" className="size-4" />
        </button>
      </header>
      <div className="kasten-folder-picker-body">
        <nav aria-label="Places" className="kasten-folder-picker-places">
          {listing?.places.map((place) => (
            <button key={place.path} type="button" aria-current={listing.path === place.path ? "location" : undefined} onClick={() => void go(place.path)}>
              <Icon name={place.label === "Home" ? "home" : place.label === "Desktop" ? "monitor" : "folder"} className="size-4" />
              {place.label}
            </button>
          ))}
        </nav>
        <div className="kasten-folder-picker-main">
          <div className="kasten-folder-picker-path">
            <button type="button" aria-label="Up one folder" title="Up one folder" disabled={!listing?.parent} onClick={() => listing?.parent && void go(listing.parent)}>
              <Icon name="chevron-up" className="size-4" />
            </button>
            <ol aria-label="Path">
              {listing &&
                crumbs(listing.path).map((step, i, all) => (
                  <li key={step.path}>
                    <button type="button" aria-current={i === all.length - 1 ? "location" : undefined} onClick={() => void go(step.path)}>
                      {step.label}
                    </button>
                  </li>
                ))}
            </ol>
          </div>
          {error && (
            <p role="alert" className="kasten-folder-picker-error">
              {error}
            </p>
          )}
          <ul aria-label="Folders" className="kasten-folder-picker-list">
            {listing?.folders.length === 0 && !listing.files?.length && <li className="kasten-folder-picker-empty">{files ? "No folders or backup files here" : "No folders here"}</li>}
            {listing?.folders.map((folder) => {
              const kind = KINDS[folder.kind];
              return (
                <li key={folder.path}>
                  <button
                    type="button"
                    aria-pressed={selected === folder.path}
                    title={`${folder.path}\nDouble-click to open`}
                    onClick={() => setSelected(folder.path)}
                    onDoubleClick={() => void go(folder.path)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      void go(folder.path);
                    }}
                  >
                    <Icon name={kind.icon} className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                    {kind.badge && <span className={`kasten-folder-picker-badge is-${folder.kind}`}>{kind.badge}</span>}
                  </button>
                </li>
              );
            })}
            {listing?.files?.map((file) => (
              <li key={file.path}>
                <button type="button" aria-pressed={selected === file.path} title={file.path} onClick={() => setSelected(file.path)} onDoubleClick={() => onPick(file.path)}>
                  <Icon name="archive" className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="kasten-folder-picker-badge">{sizeOf(file.bytes)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <footer className="kasten-folder-picker-foot">
        <span className="min-w-0 flex-1 truncate font-mono text-12 text-muted" title={target ?? undefined}>
          {target}
        </span>
        <button type="button" className="kasten-folder-picker-cancel" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="kasten-folder-picker-pick" disabled={!target} onClick={() => target && onPick(target)}>
          {pickLabel} “{target ? baseName(target) : ""}”
        </button>
      </footer>
    </Modal>
  );
}
