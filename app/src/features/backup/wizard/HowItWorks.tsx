// Step 5: what the backup does, in a few plain lines, with a link to the guide.

import { appInfo, openUrl } from "../../../lib/api";
import { Button } from "../../../ui/Button";

const POINTS = [
  "Every change is saved on this computer the moment you make it.",
  "It is backed up within 2 minutes, and at least once an hour.",
  "History is kept forever, so an old version can always be brought back.",
  "Deleted pages go to the trash first. Nothing is ever force-pushed over your backup.",
  "On another computer: choose “Restore from a backup” when you start KastenFlow, and sign in the same way.",
  "Not in the backup: saved chats and the app's settings.",
];

/** The guide's page on backups, found from where this build's releases are listed. */
async function openGuide(): Promise<void> {
  const releases = (await appInfo().catch(() => null))?.releases;
  const base = releases?.replace(/\/releases\/?$/, "");
  if (base) await openUrl(`${base}/blob/main/docs/guide.md#back-up-to-github`);
}

export function HowItWorks({ onDone }: { onDone: () => void }) {
  return (
    <>
      <ul className="kasten-wiz-points">
        {POINTS.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <footer className="kasten-wiz-foot">
        <Button tone="quiet" onClick={() => void openGuide()}>
          Read the guide
        </Button>
        <Button tone="primary" onClick={onDone}>
          Done
        </Button>
      </footer>
    </>
  );
}
