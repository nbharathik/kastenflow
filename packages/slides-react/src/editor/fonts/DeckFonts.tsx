import type { DeckFont } from "@kasten-slides/wasm";
import { type JSX, useMemo, useSyncExternalStore } from "react";

import type { EditorSession } from "../session/session.ts";
import { fontFaceCss } from "./font-css.ts";

const NONE: readonly DeckFont[] = [];

/** The style rules for the font files a deck carries; nothing when it carries none. Used by the show, which has no session. */
export function DeckFontStyle({ fonts, imageUrl }: { fonts: readonly DeckFont[] | undefined; imageUrl(path: string): string | undefined }): JSX.Element | null {
  const css = useMemo(() => fontFaceCss(fonts ?? NONE, imageUrl), [fonts, imageUrl]);
  return css === "" ? null : <style data-ks-deck-fonts="">{css}</style>;
}

/** The deck's fonts for the editor: drawn with as soon as they are added, and given up when they are taken away. */
export function DeckFonts({ session }: { session: EditorSession }): JSX.Element | null {
  const fonts = useSyncExternalStore(
    session.subscribe,
    () => session.deck.present.fonts ?? NONE,
    () => NONE,
  );
  const url = useMemo(() => (path: string) => session.host.imageUrl(path), [session]);
  return <DeckFontStyle fonts={fonts} imageUrl={url} />;
}
