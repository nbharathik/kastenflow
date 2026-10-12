// The browser preview's real diagram editor. The desktop app installs draw.io
// on request into its data folder and serves it through its `diagrams` scheme;
// the preview has neither, so a developer may unpack the same pinned release's
// web app into `app/public/drawio/` (git-ignored) and the dev server serves it
// at `/drawio/`. It is for looking at the real editor only and is never part of
// a build: the folder is taken out of the build's output.

import { rmSync } from "node:fs";
import { resolve } from "node:path";

import type { Plugin } from "vite";

/** What the editor's page may do under the `diagrams` scheme (src-tauri/src/diagrams/protocol.rs `POLICY`, which a test keeps equal). */
export const DRAWIO_POLICY =
  "default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob: data:; worker-src 'self' blob:; media-src 'self' data: blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'";

export function drawioDev(): Plugin {
  let building = false;
  let out = "";
  return {
    name: "kasten-drawio-dev",
    configResolved(config) {
      building = config.command === "build";
      out = resolve(config.root, config.build.outDir, "drawio");
    },
    configureServer(server) {
      // The editor's page gets the policy it gets in the app, not the dev server's own for the app's pages.
      server.middlewares.use("/drawio", (_req, res, next) => {
        const setHeader = res.setHeader.bind(res);
        setHeader("Content-Security-Policy", DRAWIO_POLICY);
        setHeader("X-Content-Type-Options", "nosniff");
        setHeader("Referrer-Policy", "no-referrer");
        res.setHeader = ((name: string, value: string | number | readonly string[]) => (name.toLowerCase() === "content-security-policy" ? res : setHeader(name, value))) as typeof res.setHeader;
        next();
      });
    },
    // A build copies the whole public folder; the editor is not shipped in it.
    closeBundle() {
      if (building) rmSync(out, { recursive: true, force: true });
    },
  };
}
