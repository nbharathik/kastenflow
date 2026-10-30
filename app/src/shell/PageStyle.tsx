// The page menu's style choices: font, text size and width, for this
// page. Each is kept in the page's frontmatter when it differs from the
// defaults in Settings → Pages (workspace/page/page-layout.ts).

import { useMemo } from "react";

import { pageFor } from "../features/workspace/page/open-page";
import { layoutValue, setLayout, shownLayout, STYLE_KEYS, usePageLayouts, type ShownLayout, type StyleKey } from "../features/workspace/page/page-layout";
import { WidthControl } from "../features/workspace/page/WidthControl";
import { TEXT_CHOICES } from "../features/workspace/page/text-size";
import { usePrefs, type PageFont, type TextSize } from "../features/workspace/prefs";

const FONTS: { id: PageFont; label: string; family: string }[] = [
  { id: "default", label: "Default", family: "var(--notion-font)" },
  { id: "serif", label: "Serif", family: "var(--notion-font-serif)" },
  { id: "mono", label: "Mono", family: "var(--notion-font-mono)" },
];

/** How large each size's "Ag" is drawn: an illustration on the type scale, rising with the size. */
const SAMPLE: Record<TextSize, string> = { small: "text-13", normal: "text-16", large: "text-20", xl: "text-24" };

export function PageStyle({ path }: { path: string }) {
  const font = usePrefs((s) => s.font);
  const textSize = usePrefs((s) => s.textSize);
  const pageWidth = usePrefs((s) => s.pageWidth);
  const prefs = useMemo(() => ({ font, textSize, pageWidth }), [font, textSize, pageWidth]);
  const session = pageFor(path);
  const own = usePageLayouts((s) => (session ? s.of.get(session) : undefined));
  if (!session || !own) return null;
  const shown = shownLayout(own, prefs);
  const change = (key: StyleKey, next: Partial<ShownLayout>) => setLayout(session, key, layoutValue(key, { ...shown, ...next }, prefs));
  // Only the style: where links open and how the page is drawn are not "style".
  const set = STYLE_KEYS.filter((key) => own[key] !== undefined);

  return (
    <div className="mb-1 border-b border-line px-1 pb-2 pt-1" role="group" aria-label="Style of this page" data-menu-focus="">
      <div className="flex gap-1">
        {FONTS.map((font) => (
          <button
            key={font.id}
            type="button"
            aria-pressed={shown.font === font.id}
            onClick={() => change("font", { font: font.id })}
            className={`flex flex-1 flex-col items-center rounded-md py-1.5 hover:bg-line/50 ${shown.font === font.id ? "text-accent" : "text-muted"}`}
          >
            <span className="text-24 leading-tight" style={{ fontFamily: font.family }}>
              Ag
            </span>
            <span className="text-12">{font.label}</span>
          </button>
        ))}
      </div>
      <div className="mt-1 flex gap-1" role="group" aria-label="Text size">
        {TEXT_CHOICES.map((size) => (
          <button
            key={size.id}
            type="button"
            aria-pressed={shown.text === size.id}
            aria-label={`${size.short} text`}
            title={`${size.label} text`}
            onClick={() => change("text", { text: size.id })}
            className={`flex flex-1 flex-col items-center justify-end rounded-md py-1 hover:bg-line/50 ${shown.text === size.id ? "text-accent" : "text-muted"}`}
          >
            <span className={`${SAMPLE[size.id]} leading-tight`} aria-hidden="true">
              Ag
            </span>
            <span className="text-12" aria-hidden="true">
              {size.short}
            </span>
          </button>
        ))}
      </div>
      <WidthControl className="mt-1 w-full" value={shown.width} onChange={(width) => change("width", { width })} />
      {set.length > 0 && (
        <button
          type="button"
          onClick={() => set.forEach((key) => setLayout(session, key, null))}
          className="mt-0.5 w-full rounded px-2 py-1 text-left text-12 text-muted hover:bg-line/50 hover:text-ink"
        >
          Use the default style
        </button>
      )}
    </div>
  );
}
