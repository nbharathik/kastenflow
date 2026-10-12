// A warning when a vault would sit in a folder a sync app copies (OneDrive,
// Dropbox, iCloud Drive…): the app copies files while Kasten writes them,
// which can leave conflicted copies or a half-copied history. Kasten's own
// backup is how a vault gets a copy in the cloud.

import { useEffect, useState } from "react";

import { folderSynced } from "../../lib/api";
import { Icon } from "../../ui/Icon";

/** The sync app that copies `path`, a moment after typing stops. */
export function useSynced(path: string): string | null {
  const [found, setFound] = useState<{ path: string; app: string | null } | null>(null);
  const folder = path.trim();
  useEffect(() => {
    if (!folder) return;
    let live = true;
    const timer = setTimeout(() => {
      folderSynced(folder).then(
        (app) => live && setFound({ path: folder, app }),
        () => live && setFound({ path: folder, app: null }),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [folder]);
  return folder && found?.path === folder ? found.app : null;
}

/** Why a vault shouldn't go in `app`'s folder. */
export const syncedWords = (app: string) =>
  `inside ${app}, which copies files while KastenFlow writes them. That can leave conflicted copies or a half-copied history.`;

export function SyncedNote({ app }: { app: string | null }) {
  if (!app) return null;
  return (
    <p className="kasten-folder-note is-warning" role="status">
      <Icon name="alert" className="size-4 shrink-0" />
      <span>
        This folder is {syncedWords(app)} Choose a folder outside it, and use Backup for a copy in the cloud.
      </span>
    </p>
  );
}
