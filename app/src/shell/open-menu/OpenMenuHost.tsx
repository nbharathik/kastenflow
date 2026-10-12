import { useMemo } from "react";

import { PointMenu } from "../PointMenu";
import { openItems } from "./items";
import { useOpenMenu } from "./store";

/** The Open menu where it was asked for, over everything else. Mounted once, in the shell. */
export function OpenMenuHost() {
  const menu = useOpenMenu((s) => s.menu);
  return menu ? <Shown key={`${menu.x},${menu.y}`} {...menu} /> : null;
}

function Shown({ x, y, target }: NonNullable<ReturnType<typeof useOpenMenu.getState>["menu"]>) {
  const close = useOpenMenu.getState().close;
  const items = useMemo(() => openItems(target), [target]);
  return <PointMenu x={x} y={y} label="Open" items={items} onClose={close} />;
}
