// What the editor does by itself when the host does not say otherwise: make
// the file for an export and hand it to the host. A host that has a better way
// (a print dialog, the operating system's save panel) gives its own action, and
// that one is used.
//
// With the window (`ui`) the editor looks over the deck first: an export or a presentation that has something to look at (a picture
// that is gone, text past the edge, a page that is not in the notes any more) asks the person before it goes on; one that has nothing
// goes on at once and the person sees nothing.

import { checkThen } from "./preflight/gate.ts";
import type { PreflightFormat } from "./preflight/types.ts";
import type { SlidesHost } from "./host.ts";
import type { Exported } from "./session/exporting.ts";
import type { EditorSession } from "./session/session.ts";
import type { EditorActions, EditorUi } from "./ui-state.ts";

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

export function defaultActions(session: EditorSession, host: SlidesHost, ui?: EditorUi): EditorActions {
  const tell = (message: string): void => host.notify?.(message);
  const hand = async (make: () => Promise<Exported> | Exported): Promise<void> => {
    try {
      const { file, warnings } = await make();
      await host.deliver(file);
      // Where the file went is for the host to say; what could not be written exactly is for the editor.
      if (warnings.length > 0) tell(`${file.name}: ${plural(warnings.length, "thing")} could not be written exactly. ${warnings[0]?.message ?? ""}`);
    } catch (error) {
      tell(`The export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  /** Looks the deck over for `format`, then does `go` (at once when there is nothing to look at). Without the window there is no one to ask. */
  const checked = (format: PreflightFormat, verb: string, go: () => void): void => {
    if (!ui) go();
    else void checkThen(session, ui, format, verb, go);
  };
  return {
    present(from, options) {
      checked("present", "Present", () => {
        // Loaded when it is first wanted: reveal.js and the presentation are not the editor's to carry at start.
        void import("../present/start.ts")
          .then(({ presentDeck }) => presentDeck(session, host, from, options))
          .catch((error: unknown) => tell(`Presenting failed: ${error instanceof Error ? error.message : String(error)}`));
      });
    },
    print(options) {
      void session.exports.print(options).catch((error: unknown) => tell(`Printing failed: ${error instanceof Error ? error.message : String(error)}`));
    },
    png(options) {
      checked("png", "Export", () => void hand(() => session.exports.png(options)));
    },
    exportAs(format) {
      if (format === "pptx" || format === "markdown" || format === "html") {
        const make = () => (format === "pptx" ? session.exports.pptx() : format === "markdown" ? session.exports.markdown() : session.exports.html());
        checked(format, "Export", () => void hand(make));
      } else tell(`Export as ${format} is not available here yet.`);
    },
  };
}
