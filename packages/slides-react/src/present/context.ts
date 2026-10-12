// What a presentation's slides may ask of the host they are shown by: to read the pages of the host that a deck embeds, and what to
// do with a link that was followed. It is a context so that it need not be passed through every layer of the slides to the one
// embed that wants it.

import { createContext } from "react";

import type { PageAccess } from "../embed/usePageText.ts";

export interface PresentContextValue {
  pages?: Partial<PageAccess> | undefined;
  /** A link of an embedded page was followed. */
  onLink?: ((href: string) => void) | undefined;
}

export const PresentContext = createContext<PresentContextValue>({});
