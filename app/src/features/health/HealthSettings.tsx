// Settings → History and backup → Vault health: the health page as a card of
// the group. While Settings is searched it is a line that opens it.

import { Block, Group } from "../workspace/views/settings/parts";
import { HealthCenter } from "./HealthCenter";

export function HealthSettings() {
  return (
    <Group title="Vault health" sub help="How the vault stands: saving and indexing, backup, copies kept after outside changes, proposed changes, broken links and missing pictures, and what drawing and the browser need. Looking changes nothing.">
      <Block id="history.health">
        <HealthCenter />
      </Block>
    </Group>
  );
}
