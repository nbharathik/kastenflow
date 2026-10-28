// Settings → Pages → Smart pages: where smart pages stand, and the way to the
// switch. Smart pages are a plugin (Settings → Plugins) that is off until it is
// turned on, for each vault; a project can say its own in its menu.

import { inTauri } from "../../../../lib/api";
import { usePlugins } from "../../../../plugins/registry";
import { Button } from "../../../../ui/Button";
import { Group, Row } from "./parts";
import { useSettingsView } from "./view";

/** "Smart pages": on or off for this vault, and a button to the Plugins list where the switch is. */
export function SmartSettings() {
  const view = useSettingsView();
  const on = usePlugins((s) => s.on.smart === true);
  if (!inTauri()) return null;
  return (
    <Group title="Smart pages" sub>
      <Row id="pages.smartRun" detail={on ? "On in this vault." : "Off in this vault."}>
        <Button size="sm" onClick={() => view.open("plugins.list")}>
          Open Plugins
        </Button>
      </Row>
    </Group>
  );
}
