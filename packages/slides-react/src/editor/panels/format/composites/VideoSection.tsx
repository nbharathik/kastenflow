import { useEffect, useState } from "react";

import { videoSource } from "../../../dialogs/source-address.ts";
import { importVideoFile } from "../../../dialogs/video-file.ts";
import { TextButton } from "../../../ui/Button.tsx";
import { Row, TextField, TriToggle } from "../controls.tsx";
import type { SectionProps } from "../types.ts";
import { agree, only, shared } from "../values.ts";
import { patchEach } from "../write.ts";
import { CaptionsField } from "./CaptionsField.tsx";
import { CompositeSection } from "./CompositeSection.tsx";
import { PosterField } from "./PosterField.tsx";
import { VideoMedia } from "./VideoMedia.tsx";

/** A video: where it comes from, the still shown until it plays, and whether it plays by itself and again. */
export function VideoSection({ session, ui, elements }: SectionProps) {
  const videos = only(elements, "video");
  const src = shared(videos.map((v) => v.src), "");
  const poster = agree<string | null>(videos.map((v) => v.poster ?? null), null);
  const captions = agree<string | null>(videos.map((v) => v.captions ?? null), null);
  const autoplay = agree(videos.map((v) => Boolean(v.autoplay)), false);
  const looped = agree(videos.map((v) => Boolean(v.looped)), false);
  const ids = videos.map((v) => v.id);
  const [bad, setBad] = useState(false);
  const key = ids.join(",");
  useEffect(() => setBad(false), [key]);
  const use = (typed: string) => {
    const source = videoSource(typed);
    setBad(source === null);
    if (source !== null) patchEach(session, videos, () => ({ src: source }));
  };

  return (
    <CompositeSection id="video" title="Video" ui={ui} ids={ids}>
      <Row label="Source" wide>
        <div data-primary="">
          <TextField label="Video source" value={src.value} mixed={src.mixed} placeholder="https://example.com/talk.mp4" invalid={bad} onCommit={use} />
        </div>
      </Row>
      {bad ? (
        <p className="ks-sp-hint is-error" role="alert">
          Give a web address, or the name of a video file.
        </p>
      ) : null}
      <div>
        <TextButton
          onClick={async () => {
            const path = await importVideoFile(session);
            if (path) use(path);
          }}
        >
          Choose file…
        </TextButton>
      </div>
      <PosterField session={session} value={poster} onPick={(path) => patchEach(session, videos, () => ({ poster: path }))} />
      <CaptionsField session={session} value={captions} onPick={(path) => patchEach(session, videos, () => ({ captions: path }))} />
      <TriToggle label="Play by itself" on={autoplay} onChange={(on) => patchEach(session, videos, () => ({ autoplay: on }))} />
      <TriToggle label="Play again and again" on={looped} onChange={(on) => patchEach(session, videos, () => ({ looped: on }))} />
      <VideoMedia session={session} videos={videos} />
    </CompositeSection>
  );
}
