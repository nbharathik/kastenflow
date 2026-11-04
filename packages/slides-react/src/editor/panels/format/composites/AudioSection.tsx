import { audioSource, importAudioFile } from "../../../media/audio-file.ts";
import { TextButton } from "../../../ui/Button.tsx";
import { NumberField } from "../../../ui/Fields.tsx";
import { Row, Slider, TextField, TriToggle } from "../controls.tsx";
import type { SectionProps } from "../types.ts";
import { agree, only, shared } from "../values.ts";
import { patchEach } from "../write.ts";
import { CompositeSection } from "./CompositeSection.tsx";

/** The most slides a sound can play over. */
const MOST_SLIDES = 999;

/** A sound: where it comes from, whether it plays by itself, how many slides it goes on over, whether its chip shows in the show, and how loud. */
export function AudioSection({ session, ui, elements }: SectionProps) {
  const sounds = only(elements, "audio");
  const ids = sounds.map((s) => s.id);
  const src = shared(sounds.map((s) => s.src), "");
  const label = shared(sounds.map((s) => s.label ?? ""), "");
  const autoplay = agree(sounds.map((s) => Boolean(s.autoplay)), false);
  const looped = agree(sounds.map((s) => Boolean(s.looped)), false);
  const hidden = agree(sounds.map((s) => Boolean(s.hidden)), false);
  const across = agree<number>(sounds.map((s) => s.across ?? 1), 1);
  const volume = agree<number>(sounds.map((s) => Math.round((s.volume ?? 1) * 100)), 100);
  const start = agree<number>(sounds.map((s) => s.start ?? 0), 0);
  const end = agree<number>(sounds.map((s) => s.end ?? 0), 0);
  const use = (typed: string) => {
    const source = audioSource(typed);
    if (source !== null) patchEach(session, sounds, () => ({ src: source }));
  };

  return (
    <CompositeSection id="audio" title="Audio" ui={ui} ids={ids}>
      <Row label="Source" wide>
        <div data-primary="">
          <TextField label="Audio source" value={src.value} mixed={src.mixed} placeholder="https://example.com/theme.mp3" invalid={src.value !== "" && audioSource(src.value) === null} onCommit={use} />
        </div>
      </Row>
      <div>
        <TextButton
          onClick={async () => {
            const path = await importAudioFile(session);
            if (path) use(path);
          }}
        >
          Choose file…
        </TextButton>
      </div>
      <Row label="Title" wide>
        <TextField label="Audio title" value={label.value} mixed={label.mixed} placeholder="The file’s name" onCommit={(text) => patchEach(session, sounds, () => ({ label: text.trim() === "" ? null : text }))} />
      </Row>
      <TriToggle label="Play with the slide" on={autoplay} onChange={(on) => patchEach(session, sounds, () => ({ autoplay: on }))} />
      <TriToggle label="Play again and again" on={looped} onChange={(on) => patchEach(session, sounds, () => ({ looped: on }))} />
      <Row label="Plays over">
        <span className="ks-sp-plain" data-primary="">
          <NumberField label="Slides it plays over" unit="slides" min={1} max={MOST_SLIDES} decimals={0} width={72} value={across} onCommit={(n) => patchEach(session, sounds, () => ({ across: n <= 1 ? null : Math.round(n) }))} />
        </span>
      </Row>
      <TriToggle label="Hide the icon in the show" on={hidden} onChange={(on) => patchEach(session, sounds, () => ({ hidden: on }))} />
      <Row label="Volume">
        <Slider label="Volume" value={volume} onCommit={(percent) => patchEach(session, sounds, () => ({ volume: percent >= 100 ? null : percent / 100 }))} />
      </Row>
      <Row label="Starts at">
        <span className="ks-sp-plain">
          <NumberField label="Starts at" unit="s" min={0} max={86400} decimals={1} width={72} value={start} onCommit={(n) => patchEach(session, sounds, () => ({ start: n <= 0 ? null : n }))} />
        </span>
      </Row>
      <Row label="Stops at">
        <span className="ks-sp-plain">
          <NumberField label="Stops at (0 for the end)" unit="s" min={0} max={86400} decimals={1} width={72} value={end} onCommit={(n) => patchEach(session, sounds, () => ({ end: n <= 0 ? null : n }))} />
        </span>
      </Row>
      <p className="ks-sp-hint">It plays while presenting. With “Play with the slide” off, a click on its chip starts it. The icon stays on the slide here so there is something to select.</p>
    </CompositeSection>
  );
}
