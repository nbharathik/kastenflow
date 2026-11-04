import type { JSX, ReactNode } from "react";

import { Icon, type IconName } from "../ui/Icon.tsx";

/** What a panel says when it has nothing to list: a glyph, a title and a line of help. */
export function Empty({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="ks-sp-empty">
      <span className="ks-sp-empty-icon" aria-hidden="true">
        <Icon name={icon} size={20} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
