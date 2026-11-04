import { TextButton } from "../../../ui/Button.tsx";
import { slideLink } from "../../../slide-link.ts";
import { Row, TextField } from "../controls.tsx";
import type { SectionProps } from "../types.ts";
import { only, shared } from "../values.ts";
import { patchEach } from "../write.ts";
import { CompositeSection } from "./CompositeSection.tsx";

/** About how much a code of this kind holds before a phone struggles to read it. */
const COMFORTABLE = 200;

/** A QR code: the address or words it holds, which can be the address the slide links to, and a caption under it. */
export function QrSection({ session, ui, elements }: SectionProps) {
  const codes = only(elements, "qr");
  const data = shared(codes.map((c) => c.data), "");
  const caption = shared(codes.map((c) => c.caption ?? ""), "");
  const link = slideLink(session.slide);

  return (
    <CompositeSection id="qr" title="QR code" ui={ui} ids={codes.map((c) => c.id)}>
      <Row label="Holds" wide>
        <div data-primary="">
          <TextField label="QR code holds" value={data.value} mixed={data.mixed} multiline placeholder="https://example.com" onCommit={(text) => patchEach(session, codes, () => ({ data: text.trim() }))} />
        </div>
      </Row>
      <div className="ks-sp-inline">
        <TextButton disabled={link === undefined || (!data.mixed && data.value === link)} onClick={() => link !== undefined && patchEach(session, codes, () => ({ data: link }))}>
          Use the slide&rsquo;s link
        </TextButton>
      </div>
      {link === undefined ? <p className="ks-sp-hint">This slide links to no web address. Link some words or a box (Insert, Link) to offer it here.</p> : null}
      {data.value.length > COMFORTABLE ? <p className="ks-sp-hint">That is long for a QR code; a phone may not read it from across a room.</p> : null}
      <Row label="Caption" wide>
        <TextField label="QR code caption" value={caption.value} mixed={caption.mixed} placeholder="No caption" onCommit={(text) => patchEach(session, codes, () => ({ caption: text.trim() === "" ? null : text }))} />
      </Row>
    </CompositeSection>
  );
}
