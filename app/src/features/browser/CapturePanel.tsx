// What a capture would keep, shown before anything is written: the title
// (which can be changed), the start of the text, and where it goes, with the
// capture window's place picker to change that. Save writes it; Discard lets go.

import { Button } from "../../ui/Button";
import { TargetPicker } from "../../capture/TargetPicker";
import { placeName } from "../../capture/targets";
import type { CapturedBefore } from "../../lib/vault/collection-types";
import { useWorkspace } from "../workspace/store";
import type { Capture } from "./use-capture";

/** The size of what would be kept, in words. */
function sizeOf(bytes: number): string {
  if (bytes === 0) return "the link only";
  return bytes < 1024 ? `${bytes} bytes` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  capture: Capture;
  picking: boolean;
  onPicking(on: boolean): void;
}

/** "Already saved on 2026-09-01", or how many times when it was saved more than once. */
export function savedSentence(already: readonly CapturedBefore[]): string {
  const day = already[0]?.captured;
  const times = already.length > 1 ? ` (${already.length} cards)` : "";
  return `Already saved${day ? ` on ${day}` : ""}${times}`;
}

export function CapturePanel({ capture, picking, onPicking }: Props) {
  const { phase, preview, title, error, target, places, already } = capture;
  return (
    <section className="kasten-browser-capture" aria-label="Capture">
      {phase === "reading" && <p role="status">Reading the page…</p>}
      {preview && (
        <>
          <div className="text-muted">
            {preview.kind === "page" ? "Page" : "Selection"} from {preview.site} · {sizeOf(preview.bytes)}
          </div>
          {already.length > 0 && (
            <div className="kasten-browser-saved" role="status" aria-label="Already saved">
              <span>{savedSentence(already)}</span>
              <span aria-hidden="true">·</span>
              <Button size="sm" tone="quiet" onClick={() => useWorkspace.getState().openPath(already[0]!.path, "tab")}>
                Open
              </Button>
              <span aria-hidden="true">·</span>
              <Button size="sm" tone="quiet" disabled={phase === "saving"} onClick={() => void capture.save(true)}>
                Save another snapshot
              </Button>
            </div>
          )}
          <input
            className="kasten-browser-title"
            aria-label="Title"
            value={title}
            onChange={(event) => capture.setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void capture.save();
              }
            }}
          />
          <pre className="kasten-browser-excerpt" aria-label="What would be kept">
            {preview.excerpt || "Only the link will be kept."}
          </pre>
        </>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div className="kasten-browser-foot">
        <Button size="sm" aria-expanded={picking} onClick={() => onPicking(!picking)}>
          Send to: {placeName(target)}
        </Button>
        {preview && already.length === 0 && (
          <Button size="sm" tone="primary" disabled={phase === "saving"} onClick={() => void capture.save()}>
            {phase === "saving" ? "Saving…" : "Save"}
          </Button>
        )}
        <Button
          size="sm"
          tone="quiet"
          onClick={() => {
            capture.discard();
            onPicking(false);
          }}
        >
          {preview ? "Discard" : "Close"}
        </Button>
      </div>
      {picking && (
        <div className="kasten-browser-picker">
          <TargetPicker
            places={places}
            current={target}
            onPick={(next) => {
              capture.choose(next);
              onPicking(false);
            }}
            onClose={() => onPicking(false)}
          />
        </div>
      )}
    </section>
  );
}
