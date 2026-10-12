// Settings → Sidebar: what the sidebar lists, and the views pinned to it.

import { NavList } from "../../../../shell/NavList";
import { Button } from "../../../../ui/Button";
import { usePrefs } from "../../prefs";
import { Extra, Group, Row, Switch } from "./parts";

export function SidebarSettings() {
  const prefs = usePrefs();
  return (
    <Group title="Sidebar">
      <Switch id="sidebar.cards" usual={false} checked={prefs.sidebarShowCards} onChange={(sidebarShowCards) => prefs.set({ sidebarShowCards })} />
      <Row id="sidebar.views" modified={prefs.navPinned !== null}>
        <Button size="sm" icon="undo" disabled={prefs.navPinned === null} onClick={() => prefs.set({ navPinned: null })}>
          Reset to the usual
        </Button>
      </Row>
      <Extra>
        <NavList arrange />
      </Extra>
    </Group>
  );
}
