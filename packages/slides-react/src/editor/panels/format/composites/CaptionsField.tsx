import { importCaptionsFile } from "../../../dialogs/captions-file.ts";
import type { EditorSession } from "../../../session/session.ts";
import { TextButton } from "../../../ui/Button.tsx";
import { Row } from "../controls.tsx";
import type { Mixed } from "../values.ts";

/** The last part of a path, which is what a person knows a file by. */
const nameOf = (path: string): string => path.split("/").pop() ?? path;

/** The captions file of a video (WebVTT): what it is, a way to choose one from the computer, and a way to take it away. */
export function CaptionsField({ session, value, onPick }: { session: EditorSession; value: string | null | Mixed; onPick(path: string | null): void }) {
  const path = value === "mixed" || value === null ? null : value;
  return (
    <Row label="Captions" wide>
      <div className="ks-cs-poster">
        <div className="ks-cs-poster-now">
          <span className="ks-sp-value" title={path ?? undefined}>
            {value === "mixed" ? "Mixed" : path ? nameOf(path) : "None"}
          </span>
        </div>
        <div className="ks-sp-actions">
          <TextButton
            aria-label="Choose captions file…"
            onClick={async () => {
              const picked = await importCaptionsFile(session);
              if (picked) onPick(picked);
            }}
          >
            Choose…
          </TextButton>
          <TextButton aria-label="Remove captions" disabled={path === null && value !== "mixed"} onClick={() => onPick(null)}>
            Remove
          </TextButton>
        </div>
      </div>
    </Row>
  );
}
