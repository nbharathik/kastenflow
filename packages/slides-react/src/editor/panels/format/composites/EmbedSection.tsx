import { useEffect, useState } from "react";

import { DEFAULT_DESIGN, DESIGNS, FITS, type Fit, MAX_DESIGN, MAX_ZOOM, MIN_DESIGN, MIN_ZOOM, PAGE_DESIGN, boxFor, presetOf, viewOf } from "../../../../embed/scale.ts";
import { isPageEmbedElement } from "../../../../embed/kinds.ts";
import { pageAddress } from "../../../dialogs/source-address.ts";
import { TextButton } from "../../../ui/Button.tsx";
import { NumberField } from "../../../ui/Fields.tsx";
import { Row, SelectField, TextField } from "../controls.tsx";
import type { SectionProps } from "../types.ts";
import { agree, only, shared } from "../values.ts";
import { patchEach } from "../write.ts";
import { CompositeSection } from "./CompositeSection.tsx";
import { PageSourceRows } from "./PageSourceRows.tsx";
import { PosterField } from "./PosterField.tsx";

const FIT_NAMES: Record<Fit, string> = { width: "Fit the width", page: "Show the whole page", fill: "Fill the box" };

/**
 * An embedded page, a web page or a page of the host: the window it is laid out for (so it keeps its own layout in a small box), how
 * it meets the box, a zoom of its own, and the picture that stands in for it where it cannot be live.
 */
export function EmbedSection({ session, ui, elements }: SectionProps) {
  const pages = only(elements, "embed");
  const web = pages.filter((p) => !isPageEmbedElement(p));
  const hosted = pages.filter(isPageEmbedElement);
  const url = shared(web.map((p) => p.url), "");
  const title = shared(pages.map((p) => p.title ?? ""), "");
  const poster = agree<string | null>(pages.map((p) => p.poster ?? null), null);
  const ids = pages.map((p) => p.id);
  const views = pages.map((p) => viewOf(p, isPageEmbedElement(p) ? PAGE_DESIGN : DEFAULT_DESIGN));
  const designs = agree(views.map((v) => presetOf(v.design)?.id ?? "custom"), "desktop");
  const fit = agree<Fit>(views.map((v) => v.fit), "width");
  const zoom = agree<number | null>(views.map((v) => v.zoom), null);
  const sole = pages.length === 1 ? pages[0] : undefined;
  const soleDesign = sole ? (views[0]?.design ?? DEFAULT_DESIGN) : null;
  const [bad, setBad] = useState(false);
  const key = ids.join(",");
  useEffect(() => setBad(false), [key]);

  const setDesign = (w: number, h: number) => patchEach(session, pages, () => ({ design: { w: Math.round(w), h: Math.round(h) } }));

  return (
    <CompositeSection id="embed" title={hosted.length === pages.length ? "Embedded page" : "Embedded web page"} ui={ui} ids={ids}>
      {sole && sole.source && isPageEmbedElement(sole) ? <PageSourceRows session={session} element={sole} /> : null}
      {web.length > 0 ? (
        <>
          <Row label="Address" wide>
            <div data-primary="">
              <TextField
                label="Web address"
                value={url.value}
                mixed={url.mixed}
                placeholder="https://example.com"
                invalid={bad}
                onCommit={(typed) => {
                  const address = pageAddress(typed);
                  setBad(address === null);
                  if (address !== null) patchEach(session, web, () => ({ url: address }));
                }}
              />
            </div>
          </Row>
          {bad ? (
            <p className="ks-sp-hint is-error" role="alert">
              Use a web address such as https://example.com.
            </p>
          ) : null}
        </>
      ) : null}
      <Row label="Window" wide>
        <SelectField
          label="Window the page is laid out for"
          value={designs}
          options={[...DESIGNS.map((d) => ({ value: d.id, label: `${d.label} ${d.w}×${d.h}` })), { value: "custom", label: "Custom size" }]}
          onPick={(id) => {
            const preset = DESIGNS.find((d) => d.id === id);
            if (preset) setDesign(preset.w, preset.h);
            else if (soleDesign) setDesign(soleDesign.w, soleDesign.h);
          }}
        />
      </Row>
      {designs === "custom" && soleDesign ? (
        <Row label="Size" wide>
          <NumberField label="Window width" short="W" value={soleDesign.w} min={MIN_DESIGN} max={MAX_DESIGN} step={10} decimals={0} unit="px" onCommit={(w) => setDesign(w, soleDesign.h)} />
          <NumberField label="Window height" short="H" value={soleDesign.h} min={MIN_DESIGN} max={MAX_DESIGN} step={10} decimals={0} unit="px" onCommit={(h) => setDesign(soleDesign.w, h)} />
        </Row>
      ) : null}
      <Row label="Fit" wide>
        <SelectField label="How the page meets the box" value={fit} options={FITS.map((f) => ({ value: f, label: FIT_NAMES[f] }))} onPick={(next) => patchEach(session, pages, () => ({ fit: next }))} />
      </Row>
      <Row label="Zoom" wide>
        <NumberField
          label="Zoom of the page"
          value={zoom === "mixed" ? "mixed" : zoom === null ? null : Math.round(zoom * 100)}
          min={Math.round(MIN_ZOOM * 100)}
          max={Math.round(MAX_ZOOM * 100)}
          step={10}
          decimals={0}
          unit="%"
          onCommit={(percent) => patchEach(session, pages, () => ({ zoom: percent / 100 }))}
        />
        <TextButton disabled={zoom === null} onClick={() => patchEach(session, pages, () => ({ zoom: null }))} title="The page follows the box (Ctrl and 0)">
          Fit
        </TextButton>
      </Row>
      <Row label="Shape" wide>
        <TextButton
          disabled={!soleDesign}
          title="Make the box the shape of the window, so the page fills it with no bars"
          onClick={() => {
            if (!sole || !soleDesign) return;
            const box = session.elements.boxOf(sole);
            if (box) session.elements.transform([{ id: sole.id, ...boxFor(soleDesign, box.w) }]);
          }}
        >
          Match the box to the window
        </TextButton>
      </Row>
      <PosterField session={session} value={poster} onPick={(path) => patchEach(session, pages, () => ({ poster: path }))} label="Snapshot" />
      <Row label="Title" wide>
        <TextField label="Page title" value={title.value} mixed={title.mixed} placeholder="What the page is called" onCommit={(text) => patchEach(session, pages, () => ({ title: text.trim() === "" ? null : text }))} />
      </Row>
      <p className="ks-sp-hint">
        {hosted.length === pages.length
          ? "The page is live: it keeps up with the page as it is edited. Where it cannot be shown live, its words are drawn."
          : "The page is laid out for the window above and scaled to the box. It is live when you present, and the snapshot shows elsewhere."}
      </p>
    </CompositeSection>
  );
}
