import { type JSX, type ReactNode, useMemo } from "react";

import { swallowKeys } from "../menus/focus.ts";
import { useDropdown } from "../menus/useDropdown.ts";
import { Popover } from "../ui/Popover.tsx";
import { keepFocusExceptFields } from "./ColorButton.tsx";
import { type Shown, ShownContext } from "./Group.tsx";
import { ToolButton } from "./ToolButton.tsx";

interface MoreMenuProps {
  /** The groups that did not fit in the bar. */
  hidden: ReadonlySet<string>;
  /** The whole list of groups: the menu draws it again, showing only the ones that are in `hidden`. */
  children: ReactNode;
}

/** The button at the end of a row that is too narrow, and the panel of buttons that opens from it: the groups that went out of the bar, as they are in it. */
export function MoreMenu({ hidden, children }: MoreMenuProps): JSX.Element {
  const dd = useDropdown("dialog");
  const here = useMemo<Shown>(() => ({ shows: (id) => hidden.has(id) }), [hidden]);
  return (
    <>
      <ToolButton icon="ellipsis" label="More tools" className="ks-tb-more-btn" on={dd.anchor !== null} {...dd.trigger} />
      {dd.anchor ? (
        <Popover anchor={dd.anchor} onClose={dd.close} label="More tools">
          <div className="ks-tb-more" data-ks-keep-focus="" onMouseDown={keepFocusExceptFields} onKeyDown={swallowKeys}>
            <ShownContext value={here}>{children}</ShownContext>
          </div>
        </Popover>
      ) : null}
    </>
  );
}
