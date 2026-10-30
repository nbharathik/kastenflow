// Math in an answer: the TeX shows as written until KaTeX has loaded, then as
// a formula. KaTeX loads the first time an answer holds math.

import { useEffect, useRef, useState } from "react";

type Draw = typeof import("./katex-draw").drawMath;

let loading: Promise<Draw> | null = null;
let drawn: Draw | null = null;

/** KaTeX's drawing, loaded once. */
function loadDraw(): Promise<Draw> {
  loading ??= import("./katex-draw").then((m) => (drawn = m.drawMath));
  return loading;
}

/** `block`: a block of its own (not inside a paragraph). */
export function MathView({ tex, display, block = false }: { tex: string; display: boolean; block?: boolean }) {
  const host = useRef<HTMLElement>(null);
  const [draw, setDraw] = useState<Draw | null>(() => drawn);

  useEffect(() => {
    if (draw) return;
    let alive = true;
    void loadDraw().then((loaded) => alive && setDraw(() => loaded));
    return () => {
      alive = false;
    };
  }, [draw]);

  useEffect(() => {
    if (draw && host.current) draw(host.current, tex, display);
  }, [draw, tex, display]);

  const Tag = block ? "div" : "span";
  // Until it is drawn, the TeX itself.
  return (
    <Tag ref={host as never} className={display ? "kasten-md-math is-display" : "kasten-md-math"} data-drawn={draw ? "true" : "false"}>
      {draw ? null : <code>{display ? `$$${tex}$$` : `$${tex}$`}</code>}
    </Tag>
  );
}
