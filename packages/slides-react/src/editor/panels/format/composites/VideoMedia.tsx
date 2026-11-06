import { useState } from "react";

import { clock } from "../../../../present/video-trim.ts";
import { captureFrame, frameName } from "../../../media/capture-frame.ts";
import type { EditorSession } from "../../../session/session.ts";
import { TextButton } from "../../../ui/Button.tsx";
import { NumberField } from "../../../ui/Fields.tsx";
import { Row, Slider } from "../controls.tsx";
import { type Of, agree } from "../values.ts";
import { patchEach } from "../write.ts";

interface VideoMediaProps {
  session: EditorSession;
  videos: readonly Of<"video">[];
}

/** Where a video starts and stops, how loud it is, and a still from it for its poster. */
export function VideoMedia({ session, videos }: VideoMediaProps) {
  const start = agree<number>(videos.map((v) => v.start ?? 0), 0);
  const end = agree<number>(videos.map((v) => v.end ?? 0), 0);
  const volume = agree<number>(videos.map((v) => Math.round((v.volume ?? 1) * 100)), 100);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const only = videos.length === 1 ? videos[0] : undefined;

  const poster = async () => {
    if (!only || busy) return;
    const address = session.host.imageUrl(only.src);
    if (!address) return session.host.notify?.("This video cannot be read here, so a still cannot be taken from it.");
    setBusy(true);
    try {
      const bytes = await captureFrame(address, at);
      if (!bytes) return session.host.notify?.("A still could not be taken from this video. A video from another site may not allow it; choose a picture instead.");
      const path = await session.host.addImage(frameName(only.src, at), bytes, { source: "file" });
      patchEach(session, [only], () => ({ poster: path }));
    } catch (error) {
      session.host.notify?.(error instanceof Error && error.message ? error.message : "The still could not be kept with the deck.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Row label="Starts at">
        <span className="ks-sp-plain">
          <NumberField label="Video starts at" unit="s" min={0} max={86400} decimals={1} width={72} value={start} onCommit={(n) => patchEach(session, videos, () => ({ start: n <= 0 ? null : n }))} />
        </span>
      </Row>
      <Row label="Stops at">
        <span className="ks-sp-plain">
          <NumberField label="Video stops at (0 for the end)" unit="s" min={0} max={86400} decimals={1} width={72} value={end} onCommit={(n) => patchEach(session, videos, () => ({ end: n <= 0 ? null : n }))} />
        </span>
      </Row>
      <Row label="Volume">
        <Slider label="Video volume" value={volume} onCommit={(percent) => patchEach(session, videos, () => ({ volume: percent >= 100 ? null : percent / 100 }))} />
      </Row>
      <Row label="Still from">
        <span className="ks-sp-plain">
          <NumberField label="Take the still at" unit="s" min={0} max={86400} decimals={1} width={72} value={at} onCommit={setAt} />
        </span>
        <TextButton disabled={!only || busy} onClick={() => void poster()} data-tip={only ? `The picture at ${clock(at)} becomes the poster` : "Select one video"}>
          Use as poster
        </TextButton>
      </Row>
    </>
  );
}
