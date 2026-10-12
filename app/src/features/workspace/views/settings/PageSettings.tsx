// Settings → Pages: how pages read, and where they open in this window.

import { TEXT_CHOICES } from "../../page/text-size";
import { usePrefs, type PageFont, type PeekMode } from "../../prefs";
import { OpeningRows } from "./OpeningSettings";
import { Group, Row, resetOf, Segmented, Switch } from "./parts";

const PEEKS: { id: PeekMode; label: string }[] = [
  { id: "center", label: "Center peek" },
  { id: "side", label: "Side peek" },
  { id: "full", label: "Full page" },
];

const FONTS: { id: PageFont; label: string }[] = [
  { id: "default", label: "Default" },
  { id: "serif", label: "Serif" },
  { id: "mono", label: "Mono" },
];

/** The size of page text; also in Appearance, among what is used most (with an icon there). */
export function TextSizeRow({ icon = false }: { icon?: boolean }) {
  const prefs = usePrefs();
  return (
    <Row id="pages.textSize" icon={icon ? "text" : undefined} {...resetOf(prefs.textSize, "normal", (textSize) => prefs.set({ textSize }))}>
      <Segmented label="Text size" value={prefs.textSize} options={TEXT_CHOICES.map(({ id, label }) => ({ id, label }))} onChange={(textSize) => prefs.set({ textSize })} />
    </Row>
  );
}

export function PageSettings() {
  const prefs = usePrefs();
  return (
    <>
      <Group title="Reading" sub>
        <Row id="pages.font" {...resetOf(prefs.font, "default", (font) => prefs.set({ font }))}>
          <Segmented label="Font" value={prefs.font} options={FONTS} onChange={(font) => prefs.set({ font })} />
        </Row>
        <TextSizeRow />
        <Switch id="pages.fullWidth" usual={false} checked={prefs.fullWidth} onChange={(v) => prefs.set({ fullWidth: v })} />
        <Switch id="pages.spellcheck" usual checked={prefs.spellcheck} onChange={(v) => prefs.set({ spellcheck: v })} />
      </Group>
      <Group title="Opening pages" sub>
        <Switch id="pages.newTabs" usual={false} checked={prefs.newTabs} onChange={(v) => prefs.set({ newTabs: v })} />
        <Row id="pages.peek" {...resetOf(prefs.peekMode, "center", (peekMode) => prefs.set({ peekMode }))}>
          <Segmented label="Open pages from views in" value={prefs.peekMode} options={PEEKS} onChange={(peekMode) => prefs.set({ peekMode })} />
        </Row>
        <OpeningRows />
      </Group>
    </>
  );
}
