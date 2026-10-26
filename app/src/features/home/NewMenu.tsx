// "+ New": the one button that starts anything, in place of a row of buttons.

import { Menu, type MenuEntry } from "../../shell/Menu";
import { Icon } from "../../ui/Icon";
import { type HomeAction, newActions } from "./actions";

/** An action as a menu row; one with choices opens them as a list beside the menu. */
export function entryOf(action: HomeAction): MenuEntry {
  const icon = <Icon name={action.icon} className="size-4" />;
  if (action.choices) return { label: action.label, icon, submenu: action.choices.map(entryOf) };
  return { label: action.label, icon, hint: action.keys || undefined, onSelect: action.run };
}

export function NewMenu() {
  const items: MenuEntry[] = newActions().map(entryOf);
  return (
    <Menu label="New" items={items} buttonClass="ui-btn is-primary is-lg">
      <Icon name="plus" className="size-4" />
      New
    </Menu>
  );
}
