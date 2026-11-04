import type { Element } from "@kasten-slides/wasm";

import { NumberField } from "../../../ui/Fields.tsx";
import type { EditorSession } from "../../../session/session.ts";
import { Row, TriToggle } from "../controls.tsx";
import { agree } from "../values.ts";
import { patchEach } from "../write.ts";

type Embed = Extract<Element, { type: "embed" }>;

/**
 * How a video of a known site plays: where it starts and stops (seconds), whether it plays by itself, without sound, again and again,
 * and whether the player's own controls show. The frame is built from these, and from the address, each time.
 */
export function EmbedPlayback({ session, videos }: { session: EditorSession; videos: readonly Embed[] }) {
  const start = agree<number | null>(videos.map((v) => v.start ?? null), null);
  const end = agree<number | null>(videos.map((v) => v.end ?? null), null);
  const autoplay = agree(videos.map((v) => Boolean(v.autoplay)), false);
  const muted = agree(videos.map((v) => Boolean(v.muted)), false);
  const looped = agree(videos.map((v) => Boolean(v.looped)), false);
  const controls = agree(videos.map((v) => v.controls !== false), true);
  // Nothing (or zero) is "from the start" and "to the end": the field is cleared, not set to 0.
  const second = (value: number) => (value > 0 ? Math.round(value) : null);

  return (
    <>
      <Row label="Starts at" wide>
        <NumberField label="Start at (seconds)" value={start} min={0} step={1} decimals={0} unit="s" onCommit={(value) => patchEach(session, videos, () => ({ start: second(value) }))} />
      </Row>
      <Row label="Stops at" wide>
        <NumberField label="Stop at (seconds)" value={end} min={0} step={1} decimals={0} unit="s" onCommit={(value) => patchEach(session, videos, () => ({ end: second(value) }))} />
      </Row>
      <TriToggle label="Play by itself" on={autoplay} onChange={(on) => patchEach(session, videos, () => ({ autoplay: on }))} />
      <TriToggle label="Without sound" on={muted} onChange={(on) => patchEach(session, videos, () => ({ muted: on }))} />
      <TriToggle label="Play again and again" on={looped} onChange={(on) => patchEach(session, videos, () => ({ looped: on }))} />
      <TriToggle label="Show the player's controls" on={controls} onChange={(on) => patchEach(session, videos, () => ({ controls: on ? null : false }))} />
    </>
  );
}
