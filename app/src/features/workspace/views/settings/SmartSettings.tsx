// Settings → Pages → Smart pages: the switch that stops every smart page at once.

import { useEffect } from "react";

import { inTauri } from "../../../../lib/api";
import { loadRunSwitch, setRunSwitch, useRunSwitch } from "../../../smart/run-switch";
import { useWorkspace } from "../../store";
import { Group, Switch } from "./parts";

/** "Run smart pages": on until a person turns it off. Off, smart pages show their notes and every frame ends. */
export function SmartSettings() {
  const desktop = inTauri();
  const { on, known } = useRunSwitch();
  useEffect(() => {
    if (desktop && !known) void loadRunSwitch();
  }, [desktop, known]);
  if (!desktop) return null;
  return (
    <Group title="Smart pages" sub>
      <Switch
        id="pages.smartRun"
        usual
        checked={on}
        onChange={(next) =>
          void setRunSwitch(next).then((done) => {
            if (!done) useWorkspace.getState().toast("Smart pages could not be turned " + (next ? "on" : "off") + ". Try again.");
          })
        }
      />
    </Group>
  );
}
