import { commandOf, isEnabled, keysOf, runCommand } from "../../commands/index.ts";
import { IconButton } from "../../ui/Button.tsx";
import { Row } from "./controls.tsx";
import { PanelSection } from "./PanelSection.tsx";
import type { SectionProps } from "./types.ts";

const ALIGN = ["left", "center", "right", "top", "middle", "bottom"].map((where) => `arrange.align-${where}`);
const DISTRIBUTE = ["horizontal", "vertical"].map((axis) => `arrange.distribute-${axis}`);
const ORDER = ["front", "forward", "backward", "back"].map((how) => `arrange.${how}`);

/** Aligning, spreading and stacking: the Arrange commands, as buttons that are on when the selection is big enough for them. */
export function PositionSection({ session, ui, elements }: SectionProps) {
  const context = { session, ui };
  const buttons = (ids: string[]) =>
    ids.map((id) => {
      const command = commandOf(id);
      return (
        <IconButton
          key={id}
          icon={command.icon ?? "square"}
          label={command.label}
          keys={keysOf(id)}
          disabled={!isEnabled(command, context)}
          onClick={() => void runCommand(id, context)}
        />
      );
    });
  return (
    <PanelSection id="position" title="Position">
      {/* One element aligns to the slide; two or more align to each other. */}
      <Row label={elements.length > 1 ? "Align" : "Align to slide"}>
        <div className="ks-sp-buttons">{buttons(ALIGN)}</div>
      </Row>
      <Row label="Distribute">
        <div className="ks-sp-buttons">{buttons(DISTRIBUTE)}</div>
      </Row>
      <Row label="Order">
        <div className="ks-sp-buttons">{buttons(ORDER)}</div>
      </Row>
    </PanelSection>
  );
}
