// The editor loads its dialogs, outline, grid and gallery on first use. A test that opens one expects it at once, as the editor does
// once the page has been idle, so for the editor's tests they are loaded before the file runs. A file that mocks modules
// (`vi.mock`) is left alone: loading the parts first would fix those modules before its mocks are in place.

import { readFileSync } from "node:fs";
import { expect } from "vitest";

const path = (expect.getState().testPath ?? "").replaceAll("\\", "/");
if (path.includes("/src/editor/") && !readFileSync(path, "utf8").includes("vi.mock(")) {
  const { preloadParts } = await import("../editor/lazy-parts.tsx");
  await preloadParts();
}
