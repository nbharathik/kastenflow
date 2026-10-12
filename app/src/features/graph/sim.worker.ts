// The graph's force layout, off the window's thread: it is sent a graph,
// steps the layout in slices (sim-protocol.ts) and sends back the places after
// each slice, until the layout has settled.

import { serve, type SimMessage } from "./sim-protocol";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SimMessage>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

const handle = serve((tick) => scope.postMessage(tick, [tick.positions.buffer]));
scope.onmessage = (event) => handle(event.data);
