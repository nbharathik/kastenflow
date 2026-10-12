// Settings → Desktop: closing the window keeps Kasten running in the tray,
// the quick capture shortcut, and notifications while in the background.

import { useEffect, useState } from "react";

import { inTauri } from "../../../../lib/api";
import { Button } from "../../../../ui/Button";
import { useWorkspace } from "../../store";
import { captureShortcut, desktopPrefs, setCaptureShortcut, setDesktopPrefs, shortcutFrom, type CaptureShortcut, type DesktopPrefs } from "./desktop";
import { Group, Row, Switch } from "./parts";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function DesktopSettings() {
  const [prefs, setPrefs] = useState<DesktopPrefs | null>(null);
  const [shortcut, setShortcut] = useState<CaptureShortcut | null>(null);
  const [recording, setRecording] = useState(false);
  const desktop = inTauri();
  const { toast } = useWorkspace.getState();

  useEffect(() => {
    if (!desktop) return;
    desktopPrefs().then(setPrefs, () => {});
    captureShortcut().then(setShortcut, () => {});
  }, [desktop]);

  if (!desktop) {
    return (
      <Group title="Desktop">
        <Row id="desktop.about">
          <span className="text-13 text-muted">Needs the desktop app</span>
        </Row>
      </Group>
    );
  }

  const change = (next: { keepRunning?: boolean; notifications?: boolean }) =>
    setDesktopPrefs(next).then(setPrefs, (err: unknown) => toast(message(err)));
  const record = (value: string | null) => {
    setRecording(false);
    setCaptureShortcut(value).then(
      (now) => {
        setShortcut(now);
        toast(`Quick capture is now ${now.label}`);
      },
      (err: unknown) => toast(message(err)),
    );
  };

  return (
    <Group title="Desktop">
      {prefs && !prefs.mac && <Switch id="desktop.keepRunning" checked={prefs.keepRunning} onChange={(keepRunning) => void change({ keepRunning })} />}
      {shortcut && (
        <Row
          id="desktop.capture"
          detail={
            shortcut.wayland ? (
              <>
                This desktop doesn't let apps take a shortcut everywhere. Add one in your desktop's keyboard settings that runs <code className="font-mono text-12">{shortcut.command}</code>.
              </>
            ) : undefined
          }
        >
          {!shortcut.wayland && (
            <div className="flex items-center gap-1.5">
              <Button
                className="min-w-[120px] font-mono"
                aria-label={recording ? "Press the new shortcut" : `Change the quick capture shortcut, now ${shortcut.label}`}
                onClick={() => setRecording(true)}
                onBlur={() => setRecording(false)}
                onKeyDown={(event) => {
                  if (!recording) return;
                  event.preventDefault();
                  if (event.key === "Escape") return setRecording(false);
                  const next = shortcutFrom(event, Boolean(prefs?.mac));
                  if (next) record(next);
                }}
              >
                {recording ? "Press keys…" : shortcut.label}
              </Button>
              <Button tone="quiet" icon="undo" onClick={() => record(null)}>
                Default
              </Button>
            </div>
          )}
        </Row>
      )}
      {prefs && <Switch id="desktop.notifications" checked={prefs.notifications} onChange={(notifications) => void change({ notifications })} />}
    </Group>
  );
}
