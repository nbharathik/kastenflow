import { textExtras } from "../../commands/index.ts";
import type { CommandContext } from "../../commands/types.ts";
import type { EditorSession } from "../../session/session.ts";
import { TextButton } from "../../ui/Button.tsx";
import { Row, SelectField, ShortNumber } from "./controls.tsx";
import { agree, only } from "./values.ts";
import { patchEach } from "./write.ts";
import type { Element } from "@kasten-slides/wasm";

/** The space between columns when a box names none: a third of an inch. */
export const DEFAULT_GAP = 32;

interface TextColumnsProps {
  session: EditorSession;
  context: CommandContext;
  elements: readonly Element[];
}

/** How many columns a text box runs its words in, the space between them, and the one-click "Fit text" that shrinks the words until they fit. */
export function TextColumns({ session, context, elements }: TextColumnsProps) {
  const boxes = only(elements, "text");
  if (boxes.length === 0) return null;
  const count = agree<number>(boxes.map((box) => (box.columns === 2 || box.columns === 3 ? box.columns : 1)), 1);
  const gap = agree<number>(boxes.map((box) => box.columnGap ?? DEFAULT_GAP), DEFAULT_GAP);
  return (
    <>
      <Row label="Columns">
        <SelectField
          label="Text columns"
          value={count === "mixed" ? "mixed" : String(count)}
          options={[
            { value: "1", label: "One" },
            { value: "2", label: "Two" },
            { value: "3", label: "Three" },
          ]}
          // One column is no columns at all: the field is taken away, and a deck that never had columns does not gain one.
          onPick={(value) => patchEach(session, boxes, () => ({ columns: value === "1" ? null : Number(value) }))}
        />
        <ShortNumber short="Gap" label="Space between columns" unit="px" min={0} max={480} decimals={0} width={56} value={gap} onCommit={(value) => patchEach(session, boxes, () => ({ columnGap: value === DEFAULT_GAP ? null : value }))} />
      </Row>
      <div>
        <TextButton onClick={() => textExtras.setFit(context, "shrink")}>Fit text</TextButton>
      </div>
    </>
  );
}
