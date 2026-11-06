// The script of the exported web page: reveal.js, the runtime the presentation in the app runs (the same files), and the start of
// the page. Everything is text pasted into one script, so the page needs nothing from outside and runs from a file.

import bootSource from "./html-boot.js?raw";
import { inScript } from "./html-page.ts";
import chromeSource from "../present/runtime/chrome.js?raw";
import configSource from "../present/runtime/config.js?raw";
import fxSource from "../present/runtime/fx.js?raw";
import morphSource from "../present/runtime/morph.js?raw";
import stepfxSource from "../present/runtime/stepfx.js?raw";
import transitionsSource from "../present/runtime/transitions.js?raw";

const EXPORTED = /^export (?=(?:async )?(?:function|const|let|class)\b)/gm;
const NAME = /^export (?:async )?(?:function|const|let|class) ([A-Za-z_$][\w$]*)/gm;

/** A runtime file as an expression that gives an object of what it exports: its own scope, so its names cannot meet another file's. */
export function wrapModule(source: string): string {
  const names = [...source.matchAll(NAME)].map((match) => match[1]);
  return `(function () {\n${source.replace(EXPORTED, "")}\nreturn { ${names.join(", ")} };\n})()`;
}

/** reveal.js's source (an ES module whose last line exports it) as an expression that gives reveal.js. */
export function wrapReveal(source: string): string {
  const exported = /export\s*\{\s*([\w$]+)\s+as\s+default\s*\}\s*;?\s*$/.exec(source);
  if (!exported) throw new Error("reveal.js is not in the form this export expects");
  return `(function () {\n${source.slice(0, exported.index)}\nreturn ${exported[1]};\n})()`;
}

/** The whole script, given reveal.js's source. */
export function pageScript(revealSource: string): string {
  return inScript(
    [
      '"use strict";',
      "(function () {",
      `var Reveal = ${wrapReveal(revealSource)};`,
      `var config = ${wrapModule(configSource)};`,
      `var stepfx = ${wrapModule(stepfxSource)};`,
      `var fx = ${wrapModule(fxSource)};`,
      `var transitions = ${wrapModule(transitionsSource)};`,
      `var morph = ${wrapModule(morphSource)};`,
      `var chrome = ${wrapModule(chromeSource)};`,
      bootSource,
      "})();",
    ].join("\n"),
  );
}

/** reveal.js's source: loaded when a page is made, so it is not part of the editor's start. */
export async function revealSource(): Promise<string> {
  return (await import("reveal.js?raw")).default;
}
