import { type JSX, type KeyboardEvent, useEffect, useMemo, useState } from "react";

import { SlideCanvas } from "../canvas/SlideCanvas.tsx";
import { dispatchKey } from "../commands/index.ts";
import type { DialogProps } from "../dialogs/types.ts";
import { ContextMenus } from "../menus/ContextMenus.tsx";
import { Dialogs } from "../dialogs/Dialogs.tsx";
import { FormatPanel } from "../panels/format/FormatPanel.tsx";
import { FoldsProvider, useFolds } from "../panels/format/PanelSection.tsx";
import { Toolbar } from "../toolbar/Toolbar.tsx";
import { TextButton } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Popover, usePopover } from "../ui/Popover.tsx";
import { useEditor } from "../useEditor.ts";
import { useUiState } from "../useUi.ts";
import { type Design, openDesign } from "./design-session.ts";
import { setLayoutDesign, slidesOn } from "./ops.ts";
import { SLOT_KINDS, type SlotKind, boxOfKind, freeRole, kindOfRole, slotElement, slotLabel } from "./slots.ts";
import "./layouts.css";

/** The roles the slide being designed already has: its elements that fill a slot. */
const rolesOf = (design: Design): string[] => design.session.slide.elements.flatMap((element) => (element.placeholder ? [element.placeholder] : []));

/** The slot the one element selected is, or null when it is not one (or nothing, or several, are selected). */
function selectedSlot(design: Design): { id: string; role: string } | null {
  const [id, ...others] = design.session.state.selection;
  if (!id || others.length > 0) return null;
  const element = design.session.slide.elements.find((e) => e.id === id);
  return element?.placeholder ? { id, role: element.placeholder } : null;
}

/** The one element selected that could be made a slot (words or a picture that is not one yet), or null. */
function selectedMaker(design: Design): { id: string; picture: boolean } | null {
  const [id, ...others] = design.session.state.selection;
  if (!id || others.length > 0) return null;
  const element = design.session.slide.elements.find((e) => e.id === id);
  if (!element || element.placeholder || (element.type !== "text" && element.type !== "image")) return null;
  return { id, picture: element.type === "image" };
}

function SlotMenu({ label, kinds, onPick, disabled }: { label: string; kinds: readonly SlotKind[]; onPick(kind: SlotKind): void; disabled?: boolean }): JSX.Element {
  const pop = usePopover();
  return (
    <>
      <button type="button" className="ks-btn ks-text-btn" aria-haspopup="dialog" aria-expanded={pop.anchor !== null} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={(event) => pop.toggleFrom(event.currentTarget)}>
        {label}
        <Icon name="chevron-down" size={12} />
      </button>
      {pop.anchor ? (
        <Popover anchor={pop.anchor} onClose={pop.close} label={label}>
          <div className="ks-ld-menu">
            {SLOT_KINDS.filter((choice) => kinds.includes(choice.kind)).map((choice) => (
              <button
                key={choice.kind}
                type="button"
                onClick={() => {
                  pop.close();
                  onPick(choice.kind);
                }}
              >
                {choice.label}
                <small>{choice.hint}</small>
              </button>
            ))}
          </div>
        </Popover>
      ) : null}
    </>
  );
}

/** The editor's own side panel, with the format options only: the designer has no themes or transitions of its own to change. */
function DesignPanel({ design }: { design: Design }): JSX.Element {
  const folds = useFolds(design.ui, ["access"]);
  return (
    <aside className="ks-side-panel ks-sp ks-ld-panel" aria-label="Format options" tabIndex={-1}>
      <div className="ks-sp-body">
        <FoldsProvider folds={folds}>
          <FormatPanel session={design.session} ui={design.ui} />
        </FoldsProvider>
      </div>
    </aside>
  );
}

/** The designer once its slide is open. */
function Designing({ session, design, name, onClose }: { session: DialogProps["session"]; design: Design; name: string; onClose(): void }): JSX.Element {
  const inner = design.session;
  const state = useEditor(inner);
  const { panel } = useUiState(design.ui);
  const { deck } = useEditor(session);
  const [asking, setAsking] = useState(false);
  const label = deck.theme.layouts.find((layout) => layout.name === name)?.label ?? name;
  const hidesMaster = state.deck.theme.layouts.find((layout) => layout.name === name)?.hideMaster ?? false;
  const used = slidesOn(session, name);
  const slot = selectedSlot(design);
  const maker = selectedMaker(design);

  const addSlot = (kind: SlotKind) => {
    const role = freeRole(kind, rolesOf(design));
    inner.elements.insert([slotElement(kind, role, boxOfKind(kind, state.deck.size))]);
  };
  const makeSlot = (kind: SlotKind) => {
    if (maker) inner.elements.patch({ placeholder: freeRole(kind, rolesOf(design)) }, [maker.id]);
  };

  const done = () => {
    const made = setLayoutDesign(session, name, inner.slide, hidesMaster);
    if (made === undefined) return;
    const left = made.length;
    const saved = `Saved the layout “${label}”.`;
    if (left > 0) session.host.notify?.(`${saved} ${left} piece${left === 1 ? "" : "s"} of words on slides stayed where they were: their slot is gone.`);
    else session.host.notify?.(used === 0 ? saved : `${saved} ${used} slide${used === 1 ? "" : "s"} follow${used === 1 ? "s" : ""} it.`);
    onClose();
  };

  const cancel = () => {
    if (state.canUndo && !asking) setAsking(true);
    else onClose();
  };

  // The keys belong to the designer: they never reach the deck's editor underneath.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!event.defaultPrevented && !event.nativeEvent.defaultPrevented) {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target?.closest(".ks-dialog")) dispatchKey(event.nativeEvent, design, target?.closest("input, textarea, select, [contenteditable='true']") ? "field" : "canvas");
    }
    event.stopPropagation();
  };

  return (
    <div className="ks-ld" role="dialog" aria-modal="true" aria-label={`Edit layout ${label}`} onKeyDown={onKeyDown} data-testid="layout-designer">
      <header className="ks-ld-bar">
        <div className="ks-ld-title">
          <strong>Edit layout: {label}</strong>
          <span>
            {used === 0 ? "No slide uses it yet." : used === 1 ? "1 slide follows it." : `${used} slides follow it.`} Slots are the places each slide fills in; everything else is drawn behind them.
          </span>
        </div>
        <SlotMenu label="Add slot" kinds={SLOT_KINDS.map((choice) => choice.kind)} onPick={addSlot} />
        {maker ? <SlotMenu label="Make it a slot" kinds={maker.picture ? ["picture"] : SLOT_KINDS.filter((choice) => choice.kind !== "picture").map((choice) => choice.kind)} onPick={makeSlot} /> : null}
        {slot ? (
          <TextButton onClick={() => inner.elements.patch({ placeholder: null }, [slot.id])} title={`It is the ${slotLabel(kindOfRole(slot.role)).toLowerCase()} slot; make it plain decoration`}>
            Make it decoration
          </TextButton>
        ) : null}
        <label className="ks-toggle">
          <input type="checkbox" checked={hidesMaster} onChange={(event) => void inner.run(() => inner.core.apply("edit_layout", { name, hideMaster: event.target.checked }))} />
          <span>Hide the theme's graphics</span>
        </label>
        <span className="ks-ld-spacer" />
        {asking ? (
          <>
            <span role="alert">Throw away your changes to this layout?</span>
            <TextButton onClick={() => setAsking(false)}>Keep editing</TextButton>
            <TextButton onClick={onClose}>Discard</TextButton>
          </>
        ) : (
          <>
            <TextButton onClick={cancel}>Cancel</TextButton>
            <TextButton primary onClick={done}>
              Done
            </TextButton>
          </>
        )}
      </header>
      <Toolbar session={inner} ui={design.ui} />
      <div className="ks-ld-body">
        <main className="ks-center">
          <SlideCanvas session={inner} ui={design.ui} />
        </main>
        {panel === "format" ? <DesignPanel design={design} /> : null}
      </div>
      <Dialogs session={inner} ui={design.ui} />
      <ContextMenus session={inner} ui={design.ui} />
    </div>
  );
}

/**
 * Edits a layout on the editor's own canvas: the layout is a slide, with its slots as placeholder boxes holding what they ask for
 * and its decoration as shapes, pictures and words, and everything the editor does to a slide works on it. "Done" hands the slide
 * back as one step of undo: the slides that use the layout follow (a slot they have not moved moves with it), and each keeps its own
 * words. "Cancel" leaves the layout as it was.
 */
export function LayoutDesigner({ session, ui }: DialogProps): JSX.Element {
  const { layoutDesign: name } = useUiState(ui);
  const [made, setMade] = useState<{ design: Design; name: string } | { failed: string } | null>(null);
  useEffect(() => {
    if (!name) return;
    let design: Design | null = null;
    try {
      design = openDesign(session, name);
      setMade({ design, name });
    } catch (error) {
      setMade({ failed: error instanceof Error ? error.message : String(error) });
    }
    return () => void design?.session.dispose();
  }, [session, name]);

  const close = useMemo(() => () => ui.openLayoutDesign(null), [ui]);
  if (!name) return <></>;
  if (made && "failed" in made) {
    return (
      <div className="ks-ld" role="alert">
        <p className="ks-loading">This layout could not be opened: {made.failed}</p>
        <TextButton onClick={close}>Close</TextButton>
      </div>
    );
  }
  if (!made || made.name !== name) return <div className="ks-ld" aria-busy="true" />;
  return <Designing session={session} design={made.design} name={name} onClose={close} />;
}
