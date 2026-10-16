// What attaching reads the window with: a canvas, pdf.js and the clock. A
// test swaps it for fakes.

import { browserDeps } from "./attach-browser";
import type { AttachDeps } from "./attachments";

export const attachEnv: { deps: AttachDeps } = { deps: browserDeps };
