import type { JSX } from "react";

import { textFormat } from "../commands/index.ts";
import { alignItems } from "../menus/items-text.ts";
import type { EditorSession } from "../session/session.ts";
import { BulletsButton } from "../text-ui/BulletsButton.tsx";
import { SpacingButton } from "../text-ui/SpacingButton.tsx";
import type { EditorUi } from "../ui-state.ts";
import type { IconName } from "../ui/Icon.tsx";
import { ColorButton } from "./ColorButton.tsx";
import { FontFamily } from "./FontFamily.tsx";
import { FontSize } from "./FontSize.tsx";
import { Group } from "./Group.tsx";
import { CommandButton, MenuButton } from "./ToolButton.tsx";
import { useTextView } from "./useTextView.ts";

const ALIGN_ICONS: Record<string, IconName> = {
  left: "text-align-start",
  center: "text-align-center",
  right: "text-align-end",
  justify: "text-align-justify",
  mixed: "text-align-start",
};

/**
 * What the words in hand need, in three groups: the font and its size, the marks and colour and link, and the paragraph (alignment,
 * spacing, lists, indents, clear). They are shown only where there are words to format, so none is ever greyed.
 */
export function TextGroups({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element {
  const view = useTextView(session, ui);
  const { ctx, format, base } = view;
  const { theme } = session.deck;
  const color = format.color === null ? base.color : format.color;
  const on = (value: boolean | "mixed") => value === true;

  return (
    <>
      <Group id="font">
        <FontFamily view={view} ui={ui} />
        <FontSize view={view} ui={ui} />
      </Group>
      <Group id="marks">
        <CommandButton id="text.bold" ctx={ctx} on={on(format.bold)} />
        <CommandButton id="text.italic" ctx={ctx} on={on(format.italic)} />
        <CommandButton id="text.underline" ctx={ctx} on={on(format.underline)} />
        <CommandButton id="text.strike" ctx={ctx} on={on(format.strike)} />
        <ColorButton
          theme={theme}
          icon="baseline"
          label="Text colour"
          value={color === "mixed" ? null : color}
          mixed={color === "mixed"}
          noneLabel="Automatic"
          onPick={(picked) => textFormat.setColor(ctx, picked)}
        />
        <CommandButton id="text.link" ctx={ctx} label="Insert link" on={typeof format.link === "string"} />
      </Group>
      {/* Spacing, the looks of bullets and numbers and the indents are the text editor's own components. */}
      <Group id="paragraph">
        <MenuButton ui={ui} label="Align" icon={ALIGN_ICONS[format.align] ?? "text-align-start"} items={() => alignItems(ctx, { left: "Left", center: "Centre", right: "Right", justify: "Justify" })} />
        <SpacingButton view={view} />
        <CommandButton id="text.bullets" ctx={ctx} on={format.list === "bullet"} />
        <CommandButton id="text.numbers" ctx={ctx} on={format.list === "number"} />
        <BulletsButton view={view} />
        <CommandButton id="text.outdent" ctx={ctx} />
        <CommandButton id="text.indent" ctx={ctx} />
        <CommandButton id="text.clear" ctx={ctx} />
      </Group>
    </>
  );
}
