// What happens around updates without being asked each time: the daily
// check (a moment after the desktop app opens, then every few hours while it
// stays open), a word once when a release is out (downloaded first, where
// the app installs in place), a one-time question whether to check at all,
// and after an update, a word on what is new.

import { useEffect } from "react";

import { appInfo, checkUpdate, inTauri, openUrl, type AppInfo, type UpdateInfo } from "../../lib/api";
import { said } from "../../lib/said";
import { startInterval } from "../../lib/use-interval";
import { useWorkspace } from "../workspace/store";
import { download, installAndRestart } from "./install";
import { dueAt, loadUpdates, newerThan, updatePrefs } from "./prefs";
import { useUpdates } from "./store";

/** How often an open window looks whether the daily check is due. */
export const AGAIN = 6 * 60 * 60 * 1000;

/** The daily check: quiet unless a release not announced or skipped yet is
 * out. Where the app installs in place and the person lets it, the release
 * downloads first and is then offered as ready. */
export async function dailyCheck(run: () => Promise<UpdateInfo | null> = checkUpdate, now = Date.now(), fetch: () => Promise<boolean> = download): Promise<void> {
  const prefs = loadUpdates();
  if (!dueAt(prefs, now)) return;
  updatePrefs({ checked: now });
  const info = await useUpdates.getState().check(run);
  // A check that could not reach GitHub (offline) does not use up the day: the next beat, wake or
  // return of the connection looks again. The reason stays in the store for Settings to show.
  if (!info && useUpdates.getState().error) updatePrefs({ checked: prefs.checked });
  if (!info?.newer || info.latest === prefs.skipped || info.latest === prefs.announced) return;
  const ready = prefs.download && useUpdates.getState().canInstall && (await fetch());
  updatePrefs({ announced: info.latest });
  if (ready) {
    useWorkspace.getState().toast(`KastenFlow ${info.latest} is ready to install`, { label: "Restart to update", run: () => void installAndRestart() });
  } else {
    useWorkspace.getState().toast(`KastenFlow ${info.latest} is out`, { label: "What’s new", run: () => useUpdates.getState().show() });
  }
}

/** Asks once whether to check for new versions, since the check is off
 * until turned on. */
export function askOnce(run: () => Promise<UpdateInfo | null> = checkUpdate): void {
  const prefs = loadUpdates();
  if (prefs.auto || prefs.asked) return;
  updatePrefs({ asked: true });
  useWorkspace.getState().toast("Hear when a new KastenFlow is out? It checks GitHub once a day.", {
    label: "Turn on",
    run: () => {
      updatePrefs({ auto: true });
      void dailyCheck(run);
    },
  });
}

/** After an update, says so once, with the new version's notes a click away. */
export function greetUpdate(info: AppInfo, open = openUrl): void {
  const prefs = loadUpdates();
  const now = info.appVersion;
  if (prefs.ran === now) return;
  updatePrefs({ ran: now });
  if (!prefs.ran || !newerThan(now, prefs.ran) || !info.releases) return;
  const page = `${info.releases}/tag/v${now}`;
  useWorkspace.getState().toast(`KastenFlow is now ${now}`, { label: "What’s new", run: () => void open(page).catch(said("Could not open the link")) });
}

/** The desktop app's updates, from a moment after it opens. */
export function useUpdatesAtStart(): void {
  useEffect(() => {
    if (!inTauri()) return;
    void appInfo()
      .then((info) => useUpdates.setState({ canInstall: info?.canInstall === true }))
      // Without the answer the update is offered in the browser instead of in place.
      .catch(() => {});
    const start = setTimeout(() => {
      void appInfo()
        .then((info) => info && greetUpdate(info))
        // The "now on this version" word is a courtesy; the next start says it.
        .catch(() => {});
      void dailyCheck();
      // Asked once a vault is open, not over the first choice of one.
      const { ready, choosing, client } = useWorkspace.getState();
      if (ready && !choosing && client) askOnce();
    }, 4000);
    // Rests while the window is hidden; looks once when it returns (a sleeping laptop missed its beats).
    // The check itself says nothing offline: `dailyCheck` keeps the reason in the store for Settings and tries again next time.
    const stopAgain = startInterval(() => void dailyCheck(), AGAIN);
    // A window that opened offline looks as soon as the connection is back.
    const online = () => void dailyCheck();
    window.addEventListener("online", online);
    return () => {
      clearTimeout(start);
      stopAgain();
      window.removeEventListener("online", online);
    };
  }, []);
}
