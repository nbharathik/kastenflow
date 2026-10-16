import { type JSX, useMemo, useState } from "react";

import { useImageUrl } from "../filmstrip/SlideThumb.tsx";
import { TextButton } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { useEditor } from "../useEditor.ts";
import type { DialogProps } from "../dialogs/types.ts";
import { isOwnLayout, markedDefault, ownFirst } from "./default-layout.ts";
import { LayoutThumb } from "./LayoutThumb.tsx";
import { addLayout, deleteLayout, editLayout, moveLayout, slidesOn } from "./ops.ts";
import "./layouts.css";

/** The label the person's own blank layout starts with. */
const BLANK_MINE = "Blank (mine)";

function Action({ icon, label, onClick, disabled }: { icon: IconName; label: string; onClick(): void; disabled?: boolean }): JSX.Element {
  return (
    <button type="button" className="ks-btn ks-icon-btn" aria-label={label} data-tip={label} disabled={disabled} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

/**
 * Every layout of the deck, to rename, copy, reorder, edit, delete, and mark as the one new slides start from. Each change is one
 * step of undo. A layout the slides use is deleted by moving those slides to another one first.
 */
export function LayoutManager({ session, ui, onClose }: DialogProps): JSX.Element {
  const { deck } = useEditor(session);
  const imageUrl = useImageUrl(session);
  const all = deck.theme.layouts;
  // The person's own come first, as in the New slide menu, and move among themselves: the order of each group is the theme's.
  const layouts = useMemo(() => ownFirst(all), [all]);
  const marked = markedDefault(deck);
  const place = (name: string) => all.findIndex((layout) => layout.name === name);
  const [renaming, setRenaming] = useState<{ name: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState<{ name: string; to: string } | null>(null);

  const commitRename = () => {
    if (renaming && renaming.label.trim() !== "" && renaming.label.trim() !== layouts.find((l) => l.name === renaming.name)?.label) editLayout(session, renaming.name, { label: renaming.label });
    setRenaming(null);
  };

  const duplicate = (name: string) => {
    const from = layouts.find((layout) => layout.name === name);
    if (from) addLayout(session, `${from.label} copy`, name);
  };

  const askToDelete = (name: string) => {
    if (slidesOn(session, name) === 0) {
      deleteLayout(session, name);
      return;
    }
    const other = layouts.find((layout) => layout.name !== name);
    if (other) setDeleting({ name, to: other.name });
  };

  const design = (name: string) => ui.openLayoutDesign(name);

  const newLayout = () => {
    const made = addLayout(session, "New layout");
    if (made) design(made);
  };

  const newBlank = () => {
    const found = layouts.find((layout) => layout.label === BLANK_MINE);
    const name = found?.name ?? addLayout(session, BLANK_MINE, layouts.find((layout) => layout.name === "blank") ? "blank" : undefined);
    if (!name) return;
    editLayout(session, name, { defaultForNew: true });
    ui.setNewSlides("mine");
    design(name);
  };

  return (
    <Dialog
      title="Layouts"
      width={780}
      onClose={onClose}
      footer={
        <div className="ks-lm-foot">
          <span>
            <TextButton onClick={newLayout}>New layout…</TextButton>
            <TextButton onClick={newBlank} title="Design your own blank slide: a background, a footer, a logo, a stripe. New slides can start from it.">
              Design my blank layout…
            </TextButton>
            {session.host.decks ? (
              <TextButton onClick={() => ui.openDialog("import-layouts")} title="Bring layouts in from another deck">
                Import layouts…
              </TextButton>
            ) : null}
          </span>
          <TextButton primary onClick={onClose}>
            Done
          </TextButton>
        </div>
      }
    >
      <ul className="ks-lm-list" aria-label="Layouts of this deck">
        {layouts.map((layout, i) => {
          const used = slidesOn(session, layout.name);
          const own = isOwnLayout(layout.name);
          const isDefault = marked === layout.name;
          // The neighbours it can swap places with: the ones of its own group.
          const above = layouts[i - 1] && isOwnLayout(layouts[i - 1]!.name) === own ? layouts[i - 1] : undefined;
          const below = layouts[i + 1] && isOwnLayout(layouts[i + 1]!.name) === own ? layouts[i + 1] : undefined;
          return (
            <li key={layout.name} className={`ks-lm-row${deleting?.name === layout.name ? " is-open" : ""}`} data-layout={layout.name}>
              <LayoutThumb deck={deck} layout={layout} width={112} imageUrl={imageUrl} />
              <div className="ks-lm-main">
                {renaming?.name === layout.name ? (
                  <input
                    className="ks-input ks-lm-rename"
                    aria-label={`Name of ${layout.label}`}
                    value={renaming.label}
                    maxLength={80}
                    data-autofocus=""
                    onChange={(event) => setRenaming({ name: layout.name, label: event.target.value })}
                    onBlur={commitRename}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitRename();
                      else if (event.key === "Escape") {
                        event.stopPropagation();
                        setRenaming(null);
                      }
                    }}
                  />
                ) : (
                  <span className="ks-lm-name">{layout.label}</span>
                )}
                <span className="ks-lm-meta">
                  {own ? <span className="ks-lm-badge">Yours</span> : <span>Built in</span>}
                  {isDefault ? <span className="ks-lm-badge">New slides start here</span> : null}
                  <span>{used === 0 ? "No slides use it" : used === 1 ? "1 slide uses it" : `${used} slides use it`}</span>
                </span>
              </div>
              <div className="ks-lm-actions" role="group" aria-label={`Actions for ${layout.label}`}>
                <Action icon="pen-line" label={`Edit ${layout.label}`} onClick={() => design(layout.name)} />
                <Action icon="case-sensitive" label={`Rename ${layout.label}`} onClick={() => setRenaming({ name: layout.name, label: layout.label })} />
                <Action icon="copy" label={`Duplicate ${layout.label}`} onClick={() => duplicate(layout.name)} />
                <Action icon="star" label={isDefault ? `${layout.label} is where new slides start (click to stop)` : `Start new slides from ${layout.label}`} onClick={() => editLayout(session, layout.name, { defaultForNew: !isDefault })} />
                <Action icon="arrow-up" label={`Move ${layout.label} up`} disabled={!above} onClick={() => above && moveLayout(session, layout.name, place(above.name))} />
                <Action icon="arrow-down" label={`Move ${layout.label} down`} disabled={!below} onClick={() => below && moveLayout(session, layout.name, place(below.name))} />
                <Action icon="trash" label={`Delete ${layout.label}`} disabled={layouts.length === 1} onClick={() => askToDelete(layout.name)} />
              </div>
              {deleting?.name === layout.name ? (
                <div className="ks-lm-confirm" role="group" aria-label={`Delete ${layout.label}`}>
                  <span>
                    {used === 1 ? "1 slide uses" : `${used} slides use`} this layout. Move {used === 1 ? "it" : "them"} to
                  </span>
                  <select className="ks-select" aria-label="Move its slides to" value={deleting.to} onChange={(event) => setDeleting({ name: layout.name, to: event.target.value })}>
                    {layouts
                      .filter((other) => other.name !== layout.name)
                      .map((other) => (
                        <option key={other.name} value={other.name}>
                          {other.label}
                        </option>
                      ))}
                  </select>
                  <TextButton
                    primary
                    onClick={() => {
                      if (deleteLayout(session, layout.name, deleting.to)) setDeleting(null);
                    }}
                  >
                    Delete layout
                  </TextButton>
                  <TextButton onClick={() => setDeleting(null)}>Keep it</TextButton>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
