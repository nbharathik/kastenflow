// Whether the page an element came from has changed since, kept up to date: read when the element changes, and again when the host
// says the page changed. Null while it is being found out.

import type { Element } from "@kasten-slides/wasm";
import { useEffect, useState } from "react";

import type { SlidesHost } from "../editor/host.ts";
import { type Standing, standingOf } from "./insert.ts";

export function useStanding(host: SlidesHost, element: Element | undefined): Standing | null {
  const [standing, setStanding] = useState<Standing | null>(null);
  const source = element?.source ?? null;
  const key = `${element?.id}|${source?.page}|${source?.section}|${source?.hash}|${source?.kind}`;
  useEffect(() => {
    if (!element || !source || !host.readPage) return setStanding(null);
    let live = true;
    const check = () => void standingOf(host, element).then((found) => live && setStanding(found));
    check();
    const stop = host.watchPages?.((paths) => paths.includes(source.page) && check());
    return () => {
      live = false;
      stop?.();
    };
    // The element is read afresh when its source changes; its other fields do not matter here.
  }, [host, key]);
  return standing;
}
