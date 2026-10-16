// The shortcut commands a settings search found by name: a line for each, with
// its key, that opens the key editor at that command's row.

import { Icon } from "../../ui/Icon";
import { commandRowId } from "../workspace/views/settings/command-search";
import { Marked } from "../workspace/views/settings/parts";
import { useSettingsView } from "../workspace/views/settings/view";
import { commandLabel } from "./catalog";
import { keyLabel, useKeys } from "./store";

export function CommandHits({ ids }: { ids: readonly string[] }) {
  const keymap = useKeys((s) => s.keymap);
  const view = useSettingsView();
  return (
    <div className="kasten-set-block" role="group" aria-label="Shortcuts found">
      {ids.map((id) => {
        const label = commandLabel(id);
        const key = keyLabel(keymap, id);
        return (
          <button key={id} type="button" className="kasten-set-hit" aria-label={`Open the key for ${label} in Keyboard shortcuts`} onClick={() => view.open(commandRowId(id))}>
            <span className="kasten-set-hit-text">
              <span className="kasten-set-name">
                <Marked text={label} />
              </span>
              <span className="kasten-set-why">{key || "No key yet"}</span>
            </span>
            <Icon name="chevron" className="size-3.5 text-muted" />
          </button>
        );
      })}
    </div>
  );
}
