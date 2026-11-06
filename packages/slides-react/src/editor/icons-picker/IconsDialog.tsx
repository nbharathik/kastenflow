import { type JSX, useMemo, useState } from "react";

import type { DialogProps } from "../dialogs/types.ts";
import { stopAt, walkOptions } from "../panels/format/roving.ts";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Icon } from "../ui/Icon.tsx";
import { ICON_SIZES, type IconSizeId, findIcons } from "./icon-library.ts";
import { iconColors, insertIcon } from "./insert-icon.ts";
import "./icons.css";

const COLUMNS = 8;

/**
 * Icons from the bundled Lucide set: a search box, a colour (the theme's own or any), a size, and a grid. A click puts the icon on the
 * slide as a small SVG picture in the free place, selected, as one step of undo.
 */
export function IconsDialog({ session, onClose }: DialogProps): JSX.Element {
  const [search, setSearch] = useState("");
  const colors = useMemo(() => iconColors(session), [session]);
  const [color, setColor] = useState(colors[1]?.hex ?? colors[0]?.hex ?? "#000000");
  const [size, setSize] = useState<IconSizeId>("medium");
  const [busy, setBusy] = useState(false);
  const icons = findIcons(search);

  const pick = async (index: number) => {
    const icon = icons[index];
    if (!icon || busy) return;
    setBusy(true);
    try {
      const units = ICON_SIZES.find((choice) => choice.id === size)?.units ?? 96;
      const made = await insertIcon(session, icon.name, { color }, units);
      if (made !== undefined) onClose();
    } catch {
      session.host.notify?.("The icon could not be kept.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Icons" width={440} onClose={onClose} footer={<TextButton onClick={onClose}>Cancel</TextButton>}>
      <div className="ks-ic">
        <input className="ks-input ks-ic-search" type="search" data-autofocus="" aria-label="Search icons" placeholder="Search by name, such as chart" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="ks-ic-options">
          <div className="ks-ic-swatches" role="radiogroup" aria-label="Colour">
            {colors.map((choice) => (
              <button key={choice.label} type="button" role="radio" aria-checked={color === choice.hex} aria-label={choice.label} title={choice.label} className={`ks-ic-swatch${color === choice.hex ? " is-on" : ""}`} style={{ background: choice.hex }} onClick={() => setColor(choice.hex)} />
            ))}
            <input className="ks-ic-custom" type="color" aria-label="Another colour" value={color} onChange={(event) => setColor(event.target.value.toLowerCase())} />
          </div>
          <div className="ks-ic-sizes" role="radiogroup" aria-label="Size">
            {ICON_SIZES.map((choice) => (
              <button key={choice.id} type="button" role="radio" aria-checked={size === choice.id} className={`ks-btn ks-text-btn${size === choice.id ? " is-primary" : ""}`} onClick={() => setSize(choice.id)}>
                {choice.label}
              </button>
            ))}
          </div>
        </div>
        {icons.length === 0 ? (
          <p className="ks-ic-none">No icon has that name.</p>
        ) : (
          <div className="ks-ic-grid" role="listbox" aria-label="Icons" onKeyDown={(event) => walkOptions(event, COLUMNS)}>
            {icons.map((icon, i) => (
              <button key={icon.name} type="button" role="option" aria-selected={false} aria-label={icon.label} title={icon.label} tabIndex={stopAt(i, 0)} className="ks-ic-cell" style={{ color }} disabled={busy} onClick={() => void pick(i)}>
                <Icon name={icon.name} size={22} />
              </button>
            ))}
          </div>
        )}
        <p className="ks-ic-hint">It goes on the slide as a small picture, in the free place.</p>
      </div>
    </Dialog>
  );
}
