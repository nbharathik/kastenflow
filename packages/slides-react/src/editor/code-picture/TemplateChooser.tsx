import { type JSX, useEffect, useState } from "react";

import type { SlidesHost } from "../host.ts";
import { parseLibraryText } from "./library-file.ts";
import { STARTERS } from "./starters.ts";
import type { GeneratorLibraryEntry, Program, Template } from "./types.ts";
import "./code-picture.css";

/** Nothing but a place to begin. */
const BLANK: Template = {
  id: "blank",
  label: "Blank",
  description: "A small picture to change",
  program: {
    language: "js",
    code: "// kit draws, inputs holds what the picture may read, theme is the deck's colours.\nreturn kit.svg(400, 200, [\n  kit.text(200, 112, \"Hello\", { anchor: \"middle\", size: 48, weight: 700 }),\n]);",
    inputs: [],
    output: "svg",
  },
};

export interface TemplateChooserProps {
  host: SlidesHost;
  onPick(program: Program, name: string): void;
  onError(message: string): void;
}

/** The ways to begin a code picture: the starters, and what the person kept in the library. */
export function TemplateChooser({ host, onPick, onError }: TemplateChooserProps): JSX.Element {
  const [library, setLibrary] = useState<GeneratorLibraryEntry[]>([]);
  useEffect(() => {
    let gone = false;
    void host.generatorLibrary?.list().then(
      (entries) => !gone && setLibrary(entries),
      () => {},
    );
    return () => {
      gone = true;
    };
  }, [host]);

  const fromLibrary = async (entry: GeneratorLibraryEntry) => {
    try {
      const read = parseLibraryText((await host.generatorLibrary?.read(entry.path)) ?? "");
      if (read) onPick(read.program, read.label);
      else onError(`${entry.label} could not be read.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <p className="ks-cp-hint-line">Pick a starting point. You can change the code and the data afterwards.</p>
      <ul className="ks-cp-templates" aria-label="Starting points">
        {[BLANK, ...STARTERS].map((template) => (
          <li key={template.id}>
            <button type="button" className="ks-cp-template" data-autofocus={template.id === BLANK.id ? "" : undefined} onClick={() => onPick(template.program, template.label)}>
              <span>{template.label}</span>
              <span>{template.description}</span>
            </button>
          </li>
        ))}
      </ul>
      {library.length > 0 ? (
        <>
          <p className="ks-cp-group">From your library</p>
          <ul className="ks-cp-templates" aria-label="Your library">
            {library.map((entry) => (
              <li key={entry.path}>
                <button type="button" className="ks-cp-template" onClick={() => void fromLibrary(entry)}>
                  <span>{entry.label}</span>
                  <span>{entry.output === "png" ? "PNG picture" : "SVG picture"}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
