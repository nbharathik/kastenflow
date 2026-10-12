// "+ New": the one button that starts anything, in place of a row of buttons.

import { Menu, type MenuItem } from "../../shell/Menu";
import { Icon } from "../../ui/Icon";
import { newActions } from "./actions";

export function NewMenu() {
  const items: MenuItem[] = newActions().map((action) => ({
    label: action.label,
    icon: <Icon name={action.icon} className="size-4" />,
    hint: action.keys || undefined,
    onSelect: action.run,
  }));
  return (
    <Menu label="New" items={items} buttonClass="ui-btn is-primary is-lg">
      <Icon name="plus" className="size-4" />
      New
    </Menu>
  );
}
