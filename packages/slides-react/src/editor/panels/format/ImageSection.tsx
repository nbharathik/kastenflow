import type { Crop, Mask } from "@kasten-slides/wasm";

import { DEFAULT_MASK_RADIUS } from "../../../render/elements/ImageView.tsx";
import { presetShapeNames } from "../../../render/shapes/index.ts";
import { cropMode } from "../../aids/crop-mode.ts";
import { TextButton } from "../../ui/Button.tsx";
import { NumberField, Segmented, Toggle } from "../../ui/Fields.tsx";
import { chooseImage } from "./background.ts";
import { AltText } from "./AccessSection.tsx";
import { Row, ShortNumber } from "./controls.tsx";
import { PanelSection } from "./PanelSection.tsx";
import type { SectionProps } from "./types.ts";
import { agree, json, only, round1 } from "./values.ts";
import { patchEach, styleEach } from "./write.ts";

type Side = keyof Crop;
const SIDES: { side: Side; label: string; opposite: Side }[] = [
  { side: "left", label: "Left", opposite: "right" },
  { side: "top", label: "Top", opposite: "bottom" },
  { side: "right", label: "Right", opposite: "left" },
  { side: "bottom", label: "Bottom", opposite: "top" },
];

const MASKS: { value: Mask | "none"; label: string; title: string }[] = [
  { value: "none", label: "None", title: "No mask" },
  { value: "rect", label: "Rect", title: "Rectangle" },
  { value: "roundRect", label: "Round", title: "Rounded rectangle" },
  { value: "ellipse", label: "Oval", title: "Oval" },
];

/** The adjustments that run from -100% to 100% around no change. */
const ADJUSTMENTS = [
  { key: "brightness", label: "Brightness" },
  { key: "contrast", label: "Contrast" },
  { key: "saturation", label: "Saturation" },
] as const;

/** The most of a picture a crop may cut across: some of it always shows. */
const MOST_CUT = 0.95;

const percent = (crop: Crop | null | undefined, side: Side): number => round1((crop?.[side] ?? 0) * 100);

/** The crop with one edge changed to `cut`, a fraction of the picture; null when nothing is cut. */
function cropWith(crop: Crop | null | undefined, side: Side, opposite: Side, cut: number): Crop | null {
  const now: Crop = { left: 0, top: 0, right: 0, bottom: 0, ...crop };
  const next: Crop = { ...now, [side]: Math.round(Math.min(Math.max(cut, 0), MOST_CUT - now[opposite]) * 10000) / 10000 };
  return next.left || next.top || next.right || next.bottom ? next : null;
}

/** How a picture is cut: the shape it shows through, and how much is cropped from each edge. */
export function ImageSection({ session, elements }: SectionProps) {
  const images = only(elements, "image");
  const mask = agree(images.map((i) => i.mask ?? "none"), "none");
  const rounded = images.filter((i) => i.mask === "roundRect");
  const cropped = images.some((i) => i.crop);
  return (
    <PanelSection id="image" title="Image">
      <Row label="Mask">
        <Segmented<Mask | "none">
          label="Mask"
          value={mask}
          options={MASKS.map(({ value, label, title }) => ({ value, label, title }))}
          onPick={(picked) => patchEach(session, images, (image) => ((image.mask ?? "none") === picked ? null : { mask: picked === "none" ? null : picked }))}
        />
      </Row>
      {rounded.length > 0 ? (
        <Row label="Radius">
          <span className="ks-sp-plain">
            <NumberField
              label="Corner radius"
              unit="px"
              min={0}
              max={400}
              decimals={1}
              width={64}
              value={agree(rounded.map((i) => i.style?.radius ?? DEFAULT_MASK_RADIUS), DEFAULT_MASK_RADIUS)}
              onCommit={(radius) => styleEach(session, rounded, () => ({ radius }))}
            />
          </span>
        </Row>
      ) : null}
      <div className="ks-sp-field" role="group" aria-label="Crop, as a share of the picture">
        <span className="ks-sp-label">Crop, as a share of the picture</span>
        <div className="ks-sp-grid">
          {SIDES.map(({ side, label, opposite }) => (
            <ShortNumber
              key={side}
              short={label}
              label={`Crop ${side}`}
              unit="%"
              min={0}
              max={95}
              decimals={1}
              width={52}
              value={agree(images.map((i) => percent(i.crop, side)), 0)}
              onCommit={(value) => patchEach(session, images, (image) => ({ crop: json(cropWith(image.crop, side, opposite, value / 100)) }))}
            />
          ))}
        </div>
      </div>
      <div>
        <TextButton disabled={images.length !== 1} onClick={() => cropMode.set(images[0]?.id ?? null)} title="Drag the edges of the picture; Enter or Escape when done">
          Crop…
        </TextButton>
        <TextButton disabled={!cropped} onClick={() => patchEach(session, images, (image) => (image.crop ? { crop: null } : null))}>
          Reset crop
        </TextButton>
        <TextButton
          disabled={images.length !== 1}
          onClick={() => {
            const only = images[0];
            if (only) void chooseImage(session).then((src) => src && session.aids.replacePicture(session.slide.id, only.id, src));
          }}
          title="Another picture in the same place, size and crop"
        >
          Replace picture…
        </TextButton>
      </div>
      <Row label="Shape">
        <select
          className="ks-input"
          aria-label="Mask shape"
          value={agree(images.map((i) => i.style?.maskShape ?? ""), "")}
          onChange={(event) => styleEach(session, images, () => ({ maskShape: event.target.value === "" ? null : event.target.value }))}
        >
          <option value="">Plain mask above</option>
          {presetShapeNames().map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </Row>
      <div className="ks-sp-field" role="group" aria-label="Adjustments">
        <span className="ks-sp-label">Adjustments</span>
        <div className="ks-sp-grid">
          {ADJUSTMENTS.map(({ key, label }) => (
            <ShortNumber
              key={key}
              short={label}
              label={label}
              unit="%"
              min={-100}
              max={100}
              decimals={0}
              width={52}
              value={agree(images.map((i) => Math.round((i.style?.adjust?.[key] ?? 0) * 100)), 0)}
              onCommit={(value) => styleEach(session, images, () => ({ adjust: { [key]: value === 0 ? null : value / 100 } }))}
            />
          ))}
          <ShortNumber
            short="Blur"
            label="Blur"
            unit="px"
            min={0}
            max={60}
            decimals={0}
            width={52}
            value={agree(images.map((i) => Math.round(i.style?.adjust?.blur ?? 0)), 0)}
            onCommit={(value) => styleEach(session, images, () => ({ adjust: { blur: value === 0 ? null : value } }))}
          />
          <ShortNumber
            short="Clear"
            label="Transparency"
            unit="%"
            min={0}
            max={100}
            decimals={0}
            width={52}
            value={agree(images.map((i) => Math.round((1 - (i.style?.opacity ?? 1)) * 100)), 0)}
            onCommit={(value) => styleEach(session, images, () => ({ opacity: value === 0 ? null : 1 - value / 100 }))}
          />
        </div>
        <Toggle label="Greyscale" on={images.length > 0 && images.every((i) => Boolean(i.style?.adjust?.greyscale))} onChange={(on) => styleEach(session, images, () => ({ adjust: { greyscale: on ? true : null } }))} />
      </div>
      <AltText session={session} elements={images} />
    </PanelSection>
  );
}
