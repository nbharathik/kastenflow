// Settings → Appearance: what you reach for most (the theme, the accent
// colour, the interface size and the text size) in one card, then motion.

import type { MotionPref } from "../../../../lib/motion";
import { said } from "../../../../lib/said";
import { CHOICES, chooseZoom, stepZoom, useZoom, zoomBy, type ZoomChoice } from "../../../../lib/zoom";
import { Button, IconButton } from "../../../../ui/Button";
import type { IconName } from "../../../../ui/Icon";
import { usePrefs } from "../../prefs";
import { ACCENTS, type Accent, type ThemePref } from "../../theme";
import { useKeyLabel } from "../../../shortcuts/store";
import { Group, Row, resetOf, Segmented } from "./parts";
import { TextSizeRow } from "./PageSettings";

const THEMES: { id: ThemePref; label: string; icon: IconName }[] = [
  { id: "system", label: "System", icon: "monitor" },
  { id: "light", label: "Light", icon: "sun" },
  { id: "dark", label: "Dark", icon: "moon" },
];

const MOTIONS: { id: MotionPref; label: string }[] = [
  { id: "system", label: "System" },
  { id: "on", label: "On" },
  { id: "off", label: "Off" },
];

const percent = (level: number) => `${Math.round(level * 100)}%`;

/** Auto, then the levels Settings offers; a level picked with the keys
 * that is not among them leaves none of these chosen. */
const SIZES: { id: string; label: string }[] = [{ id: "auto", label: "Auto" }, ...CHOICES.map((level) => ({ id: String(level), label: percent(level) }))];

/** How large everything draws in this window, for the display it is on. */
function InterfaceSize() {
  const { choice, level, auto } = useZoom();
  const set = (next: ZoomChoice) => void chooseZoom(next).catch(said("Could not change the interface size"));
  const step = (direction: -1 | 1) => void zoomBy(direction).catch(said("Could not change the interface size"));
  const picked = choice === "auto" ? "auto" : String(choice);
  const pick = (id: string) => set(id === "auto" ? "auto" : Number(id));
  return (
    <Row id="appearance.zoom" icon="zoom-in" help={`How large everything draws on this display. Each display keeps its own size; Auto picks ${percent(auto)} here.`} {...resetOf(picked, "auto", pick)}>
      <div className="kasten-set-pair">
        <Segmented label="Interface size" value={picked} options={SIZES} onChange={pick} />
        <div className="flex items-center gap-1">
          <IconButton icon="minus" label="Zoom out" size="sm" disabled={stepZoom(level, -1) === level} onClick={() => step(-1)} />
          <span role="status" aria-label="Current interface size" className="w-10 text-center text-13 tabular-nums">
            {percent(level)}
          </span>
          <IconButton icon="plus" label="Zoom in" size="sm" disabled={stepZoom(level, 1) === level} onClick={() => step(1)} />
        </div>
      </div>
    </Row>
  );
}

/** The swatch shown for each accent, as its light-theme colour. */
const SWATCH: Record<Accent, string> = {
  blue: "#2383e2",
  violet: "#6d5dfc",
  green: "#1a9a5f",
  orange: "#e8590c",
  pink: "#d6336c",
  graphite: "#3f3f46",
};

/** The header's way back: theme, accent, sizes and motion to how they start. */
export function ResetAppearance() {
  const prefs = usePrefs();
  const { choice } = useZoom();
  const changed = prefs.theme !== "system" || prefs.accent !== "blue" || prefs.motion !== "system" || prefs.textSize !== "normal" || choice !== "auto";
  return (
    <Button
      size="sm"
      icon="undo"
      disabled={!changed}
      onClick={() => {
        prefs.setTheme("system");
        prefs.set({ accent: "blue", motion: "system", textSize: "normal" });
        void chooseZoom("auto").catch(said("Could not reset the interface size"));
      }}
    >
      Reset all appearance
    </Button>
  );
}

export function AppearanceSettings() {
  const prefs = usePrefs();
  const themeKey = useKeyLabel("theme");
  return (
    <>
      <Group title="Frequently used" sub>
        <Row id="appearance.theme" icon="palette" help={themeKey ? `Light, dark, or follow your computer. ${themeKey} switches between light and dark.` : undefined} {...resetOf(prefs.theme, "system", (theme) => prefs.setTheme(theme))}>
          <Segmented label="Theme" value={prefs.theme} options={THEMES} onChange={(theme) => prefs.setTheme(theme)} />
        </Row>
        <Row id="appearance.accent" icon="highlight" {...resetOf(prefs.accent, "blue", (accent) => prefs.set({ accent }))}>
          <div role="radiogroup" aria-label="Accent colour" className="flex gap-1.5">
            {ACCENTS.map((accent) => (
              <button
                key={accent}
                type="button"
                role="radio"
                aria-checked={prefs.accent === accent}
                aria-label={accent.charAt(0).toUpperCase() + accent.slice(1)}
                title={accent.charAt(0).toUpperCase() + accent.slice(1)}
                onClick={() => prefs.set({ accent })}
                className={`size-6 rounded-full ring-offset-2 ring-offset-canvas transition ${prefs.accent === accent ? "ring-2 ring-ink/70" : "hover:scale-110"}`}
                style={{ background: SWATCH[accent] }}
              />
            ))}
          </div>
        </Row>
        <InterfaceSize />
        <TextSizeRow icon />
      </Group>
      <Group title="Animation" sub>
        <Row id="appearance.motion" icon="zap" {...resetOf(prefs.motion, "system", (motion) => prefs.set({ motion }))}>
          <Segmented label="Motion" value={prefs.motion} options={MOTIONS} onChange={(motion) => prefs.set({ motion })} />
        </Row>
      </Group>
    </>
  );
}
