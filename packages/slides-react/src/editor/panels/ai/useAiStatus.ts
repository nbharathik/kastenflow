import { useCallback, useSyncExternalStore } from "react";

import type { AiStatus, SlidesHost } from "../../host.ts";

const none = (): (() => void) => () => {};
const idle = (): AiStatus => "idle";

/** What the host's assistant is doing for this deck now ("idle" when the host does not say), drawn again when it changes. */
export function useAiStatus(host: SlidesHost): AiStatus {
  const source = host.aiStatus;
  const subscribe = useCallback((listener: () => void) => (source ? source.subscribe(listener) : none()), [source]);
  const read = useCallback(() => (source ? source.current() : idle()), [source]);
  return useSyncExternalStore(subscribe, read, idle);
}
