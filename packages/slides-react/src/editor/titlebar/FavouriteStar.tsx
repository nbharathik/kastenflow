import { type JSX, useSyncExternalStore } from "react";

import type { EditorSession } from "../session/session.ts";
import { IconButton } from "../ui/Button.tsx";

const NEVER = () => () => {};

/** The star beside the deck's name, for a host that has favourites: lit when the deck is one, and a press changes it. */
export function FavouriteStar({ session }: { session: EditorSession }): JSX.Element | null {
  const favourite = session.host.favourite;
  const on = useSyncExternalStore(
    favourite ? favourite.watch : NEVER,
    () => favourite?.isOn() ?? false,
    () => favourite?.isOn() ?? false,
  );
  if (!favourite) return null;
  return <IconButton icon="star" label={on ? "Remove from favourites" : "Add to favourites"} className={`ks-star${on ? " is-favourite" : ""}`} on={on} onClick={() => favourite.set(!on)} />;
}
