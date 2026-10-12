// Settings → Whiteboards: how the board's bars behave, and what a double-click
// on empty space makes. Kept on this computer (board-prefs.ts) and read by
// every board as it draws.

import { Group, resetOf, Row, Segmented, Switch } from "../workspace/views/settings/parts";
import { useBoardPrefs, type DoubleClickMakes } from "./board-prefs";

const MAKES: { id: DoubleClickMakes; label: string }[] = [
  { id: "card", label: "A card" },
  { id: "sticky", label: "A sticky" },
];

export function BoardsSettings() {
  const prefs = useBoardPrefs();
  return (
    <Group title="Whiteboards">
      {/* The names and explanations are in Settings' index (boards.*), which search reads too. */}
      <Switch id="boards.toolbar" checked={prefs.alwaysToolbar} usual={false} onChange={(alwaysToolbar) => prefs.set({ alwaysToolbar })} />
      <Switch id="boards.minimap" checked={prefs.minimap} usual={false} onChange={(minimap) => prefs.set({ minimap })} />
      <Row id="boards.doubleClick" {...resetOf(prefs.doubleClick, "card", (doubleClick) => prefs.set({ doubleClick }))}>
        <Segmented label="Double-click on empty space makes" value={prefs.doubleClick} options={MAKES} onChange={(doubleClick) => prefs.set({ doubleClick })} />
      </Row>
    </Group>
  );
}
