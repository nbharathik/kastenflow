import type { Align, ListKind, TextFit, VAlign } from "@kasten-slides/wasm";

import { textExtras, textFormat } from "../../commands/index.ts";
import { IndentFields } from "../../text-ui/SpacingButton.tsx";
import { useTextView } from "../../toolbar/useTextView.ts";
import { IconButton } from "../../ui/Button.tsx";
import { Segmented } from "../../ui/Fields.tsx";
import { Icon, type IconName } from "../../ui/Icon.tsx";
import { useUiState } from "../../useUi.ts";
import { Cluster, Row, SelectField, ShortNumber, TriToggle } from "./controls.tsx";
import { PanelSection } from "./PanelSection.tsx";
import { SIDES, insetsOf, textFacts, withList, withParagraphs } from "./text-facts.ts";
import type { SectionProps } from "./types.ts";
import type { Mixed } from "./values.ts";
import { rewriteText } from "./write.ts";

const ALIGNS: { value: Align; title: string; icon: IconName }[] = [
  { value: "left", title: "Align left", icon: "text-align-start" },
  { value: "center", title: "Align centre", icon: "text-align-center" },
  { value: "right", title: "Align right", icon: "text-align-end" },
  { value: "justify", title: "Justify", icon: "text-align-justify" },
];

const SPACINGS = [1, 1.15, 1.5, 2];

/** The three things a box can do with words that do not fit it. */
const FITS = textExtras.FITS;

/** A vertical place for the words in a box, as three icons. */
const VALIGNS: { value: VAlign; title: string; icon: IconName }[] = [
  { value: "top", title: "Align top", icon: "align-start-horizontal" },
  { value: "middle", title: "Align middle", icon: "align-center-horizontal" },
  { value: "bottom", title: "Align bottom", icon: "align-end-horizontal" },
];

const spacingLabel = (n: number): string => (n === 1 ? "Single" : n === 2 ? "Double" : String(n));

/** Paragraph settings and the space around the words in a text box or a shape. */
export function TextSection({ session, ui, elements, theme }: SectionProps) {
  const editing = useUiState(ui).text !== null;
  const view = useTextView(session, ui);
  const context = view.ctx;
  const facts = textFacts(theme, session.slide.layout, elements);
  // With a text box open the words selected in it are what the controls show and change.
  const live = editing ? textFormat.currentFormat(context) : null;
  const align = live ? live.align : facts.align;
  const list = live ? live.list : facts.list;
  const lineSpacing = live ? live.lineSpacing : facts.lineSpacing;

  const setList = (kind: ListKind | null) => {
    if (list === kind) return;
    if (!editing) return rewriteText(session, elements, (text) => withList(text, kind));
    // In an open text box the list button toggles: off is the same button again.
    if (kind !== null) return textFormat.toggleList(context, kind);
    if (list === "mixed") textFormat.toggleList(context, "bullet");
    textFormat.toggleList(context, list === "number" ? "number" : "bullet");
  };

  const spacings = typeof lineSpacing === "number" && !SPACINGS.includes(lineSpacing) ? [...SPACINGS, lineSpacing].sort((a, b) => a - b) : SPACINGS;
  const pick = (value: string) => textFormat.setLineSpacing(context, value === "default" ? null : Number(value));
  const space = (key: "spaceBefore" | "spaceAfter", points: number) => rewriteText(session, elements, (text) => withParagraphs(text, (p) => ({ ...p, [key]: points })));
  const inset = (side: (typeof SIDES)[number], value: number) => rewriteText(session, elements, (text) => ({ ...text, insets: { ...insetsOf(text), [side]: value } }));

  return (
    <PanelSection id="text" title="Text">
      <Row label="Align">
        <Segmented<Align>
          label="Text alignment"
          value={align}
          options={ALIGNS.map((a) => ({ value: a.value, title: a.title, label: <Icon name={a.icon} /> }))}
          onPick={(picked) => textFormat.setAlign(context, picked)}
        />
      </Row>
      <Row label="Line spacing">
        <SelectField
          label="Line spacing"
          value={lineSpacing === null ? "default" : lineSpacing === "mixed" ? "mixed" : String(lineSpacing)}
          options={[{ value: "default", label: "Default" }, ...spacings.map((n) => ({ value: String(n), label: spacingLabel(n) }))]}
          onPick={pick}
        />
      </Row>
      <div className="ks-sp-grid">
        <ShortNumber short="Before" label="Space before" unit="pt" min={0} max={200} decimals={1} width={56} value={facts.spaceBefore} onCommit={(v) => space("spaceBefore", v)} />
        <ShortNumber short="After" label="Space after" unit="pt" min={0} max={200} decimals={1} width={56} value={facts.spaceAfter} onCommit={(v) => space("spaceAfter", v)} />
      </div>
      <Row label="List">
        <div className="ks-sp-buttons">
          <Segmented<"none" | ListKind>
            label="List"
            value={list === "mixed" ? "mixed" : (list ?? "none")}
            options={[
              { value: "none", title: "No list", label: "None" },
              { value: "bullet", title: "Bulleted list", label: <Icon name="list" /> },
              { value: "number", title: "Numbered list", label: <Icon name="list-ordered" /> },
            ]}
            onPick={(picked) => setList(picked === "none" ? null : picked)}
          />
          <Cluster label="Indent" end>
            <IconButton icon="list-indent-decrease" label="Decrease indent" onClick={() => textFormat.indent(context, -1)} />
            <IconButton icon="list-indent-increase" label="Increase indent" onClick={() => textFormat.indent(context, 1)} />
          </Cluster>
        </div>
      </Row>
      <div className="ks-sp-field" role="group" aria-label="Indents">
        <span className="ks-sp-label">Indents</span>
        <IndentFields view={view} />
      </div>
      <Row label="Vertical">
        <ValignButtons value={facts.valign} onPick={(picked) => rewriteText(session, elements, (text) => ({ ...text, valign: picked }))} />
      </Row>
      {/* What the box does when its words do not fit it, and whether its lines wrap. */}
      <Row label="Fitting">
        <SelectField<TextFit> label="Text fitting" value={view.format.fit} options={FITS.map(({ fit, label }) => ({ value: fit, label }))} onPick={(fit) => textExtras.setFit(context, fit)} />
      </Row>
      <TriToggle label="Wrap text" on={view.format.wrap} onChange={(on) => textExtras.setWrap(context, on)} />
      <div className="ks-sp-field" role="group" aria-label="Text insets">
        <span className="ks-sp-label">Space around the text</span>
        <div className="ks-sp-grid">
          {SIDES.map((side) => (
            <ShortNumber
              key={side}
              short={side[0]!.toUpperCase() + side.slice(1)}
              label={`Inset ${side}`}
              unit="px"
              min={0}
              max={200}
              decimals={1}
              width={52}
              value={facts.insets[side]}
              onCommit={(value) => inset(side, value)}
            />
          ))}
        </div>
      </div>
    </PanelSection>
  );
}

/**
 * Top, middle and bottom. These change the box the words sit in, not the words
 * a text editor holds, so unlike the buttons for alignment and lists they do
 * not keep an open text box open: it finishes first, and its words are not
 * written over the change afterwards.
 */
function ValignButtons({ value, onPick }: { value: VAlign | Mixed; onPick(value: VAlign): void }) {
  return (
    <div className="ks-segmented" role="radiogroup" aria-label="Vertical alignment">
      {VALIGNS.map((v) => (
        <button key={v.value} type="button" role="radio" aria-checked={value === v.value} aria-label={v.title} data-tip={v.title} className={`ks-seg${value === v.value ? " is-on" : ""}`} onClick={() => onPick(v.value)}>
          <Icon name={v.icon} />
        </button>
      ))}
    </div>
  );
}
