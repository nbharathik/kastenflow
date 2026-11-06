// The one place a frame for code is made. It is the smart page's kind of frame: `sandbox="allow-scripts"` and nothing more (an
// opaque origin, no popups, no top navigation, no forms, no downloads), loaded from the `smart` scheme under a secret the app made,
// so the policy that comes with every answer (no network) holds. It is hidden, stays in the page only for the run, and talks to the
// window with messages alone. The window hears only the frame it made.

import { frameUrl } from "../../smart/urls";
import { type GeneratorBackend, tauriGeneratorBackend } from "./backend";
import type { FrameHost, SandboxFrame } from "./sandbox";
import { GENERATOR_ID } from "./types";

/** What the frame is allowed: its own scripts. */
export const GENERATOR_SANDBOX = "allow-scripts";

export function domFrameHost(backend: GeneratorBackend = tauriGeneratorBackend): FrameHost {
  return {
    async open(onMessage): Promise<SandboxFrame> {
      const secret = await backend.openFrame();
      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", GENERATOR_SANDBOX);
      frame.setAttribute("referrerpolicy", "no-referrer");
      frame.setAttribute("aria-hidden", "true");
      frame.tabIndex = -1;
      frame.title = "Code picture";
      frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0;visibility:hidden;pointer-events:none";
      const listen = (event: MessageEvent) => {
        if (event.source === frame.contentWindow) onMessage(event.data);
      };
      window.addEventListener("message", listen);
      frame.src = frameUrl(secret, GENERATOR_ID, "runner.html");
      document.body.appendChild(frame);
      return {
        post: (message) => frame.contentWindow?.postMessage(message, "*"),
        close() {
          window.removeEventListener("message", listen);
          frame.remove();
          // The frame is already gone from the page; a secret the backend cannot drop lapses with the window.
          void backend.closeFrame(secret).catch(() => {});
        },
      };
    },
  };
}
