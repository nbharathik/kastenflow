// Mounts "Compare papers" when something asked for it.

import { useCompareDialog } from "./compare-state";
import { CompareDialog } from "./CompareDialog";

export function CompareHost() {
  const request = useCompareDialog((s) => s.request);
  const close = useCompareDialog((s) => s.close);
  return request ? <CompareDialog request={request} onClose={close} /> : null;
}
