import type { JSX } from "react";

import { ADDED_SPACE, LINE_SPACINGS, setIndents, setLineSpacing, setParagraphSpacing } from "../commands/text-format.ts";
import { swallowKeys } from "../menus/focus.ts";
import { useDropdown } from "../menus/useDropdown.ts";
import { keepFocusExceptFields } from "../toolbar/ColorButton.tsx";
import { ToolButton } from "../toolbar/ToolButton.tsx";
import type { TextView } from "../toolbar/useTextView.ts";
import { NumberField, Segmented } from "../ui/Fields.tsx";
import { Popover } from "../ui/Popover.tsx";
import "./text-ui.css";

const presets = LINE_SPACINGS.map((multiple) => ({ value: String(multiple), label: String(multiple), title: `Line spacing ${multiple}` }));

/**
 * Line spacing, the space before and after a paragraph, and where its lines start, in one card: the
 * usual spacings to pick, and each number to type, drag or step. "Add space" and "Remove space" are
 * the quick way Google Slides has. It works on the words selected in the open text box, or on all
 * the words of the selected boxes.
 */
export function SpacingButton({ view }: { view: TextView }): JSX.Element {
  const { ctx, format, can } = view;
  const dd = useDropdown("dialog");
  const line = format.lineSpacing;
  return (
    <>
      <ToolButton icon="list-chevrons-up-down" label="Line and paragraph spacing" menu disabled={!can} {...dd.trigger} />
      {dd.anchor ? (
        <Popover anchor={dd.anchor} onClose={dd.close} label="Line and paragraph spacing">
          <div className="ks-tui ks-tui-spacing" data-ks-keep-focus="" onMouseDown={keepFocusExceptFields} onKeyDown={swallowKeys}>
            <div className="ks-tui-heading">Line spacing</div>
            <Segmented label="Line spacing" value={typeof line === "number" ? String(line) : null} options={presets} onPick={(value) => setLineSpacing(ctx, Number(value))} />
            <div className="ks-tui-fields">
              <span>Line</span>
              <NumberField label="Line spacing" value={line} min={0.5} max={5} step={0.05} decimals={2} width={72} onCommit={(n) => setLineSpacing(ctx, n)} />
              <span>Before</span>
              <NumberField label="Space before paragraph" value={format.spaceBefore} min={0} max={500} step={1} decimals={1} unit="pt" width={72} onCommit={(n) => setParagraphSpacing(ctx, { before: n })} />
              <span>After</span>
              <NumberField label="Space after paragraph" value={format.spaceAfter} min={0} max={500} step={1} decimals={1} unit="pt" width={72} onCommit={(n) => setParagraphSpacing(ctx, { after: n })} />
            </div>
            <div className="ks-tui-row">
              <button type="button" className="ks-btn ks-text-btn" onClick={() => setParagraphSpacing(ctx, { before: format.spaceBefore ? 0 : ADDED_SPACE })}>
                {format.spaceBefore ? "Remove space before paragraph" : "Add space before paragraph"}
              </button>
              <button type="button" className="ks-btn ks-text-btn" onClick={() => setParagraphSpacing(ctx, { after: format.spaceAfter ? 0 : ADDED_SPACE })}>
                {format.spaceAfter ? "Remove space after paragraph" : "Add space after paragraph"}
              </button>
              <button
                type="button"
                className="ks-btn ks-text-btn"
                onClick={() => {
                  setLineSpacing(ctx, null);
                  setParagraphSpacing(ctx, { before: null, after: null });
                }}
              >
                Back to the style's own
              </button>
            </div>
          </div>
        </Popover>
      ) : null}
    </>
  );
}

/**
 * The indents of the words in hand: where their lines start, and where the first line starts from there (a hanging
 * indent is a negative number), with the buttons that move them a level. For a panel, or the card of `IndentButton`.
 */
export function IndentFields({ view }: { view: TextView }): JSX.Element {
  const { ctx, format, can } = view;
  return (
    <div className="ks-tui-fields" role="group" aria-label="Indentation">
      <span>Left</span>
      <NumberField label="Left indent" value={format.marginLeft} min={0} max={2000} step={6} decimals={1} unit="u" width={72} disabled={!can} onCommit={(n) => setIndents(ctx, { marginLeft: n })} />
      <span>First line</span>
      <NumberField label="First line indent" value={format.indent} min={-2000} max={2000} step={6} decimals={1} unit="u" width={72} disabled={!can} onCommit={(n) => setIndents(ctx, { firstLine: n })} />
      <span />
      <button type="button" className="ks-btn ks-text-btn" disabled={!can} onClick={() => setIndents(ctx, { marginLeft: null, firstLine: null })}>
        Back to the list's own
      </button>
    </div>
  );
}

/** The indents of the words in hand in a card of their own. */
export function IndentButton({ view }: { view: TextView }): JSX.Element {
  const dd = useDropdown("dialog");
  return (
    <>
      <ToolButton icon="list-indent-increase" label="Indentation options" menu disabled={!view.can} {...dd.trigger} />
      {dd.anchor ? (
        <Popover anchor={dd.anchor} onClose={dd.close} label="Indentation options">
          <div className="ks-tui" data-ks-keep-focus="" onMouseDown={keepFocusExceptFields} onKeyDown={swallowKeys}>
            <div className="ks-tui-heading">Indentation</div>
            <IndentFields view={view} />
          </div>
        </Popover>
      ) : null}
    </>
  );
}
