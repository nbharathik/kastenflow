// Turns data/world-110m.json (the map data, one place to edit) into data/world-110m.js,
// the script a smart page loads (a page cannot fetch files, so the data travels as a script).
// Run it after replacing the JSON:  node app/src/smart-kit/data/build-world.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const world = JSON.parse(readFileSync(join(here, "world-110m.json"), "utf8"));
const banner = world.placeholder
  ? "/* PLACEHOLDER map data: coarse hand-drawn continents, not real borders. Generated from world-110m.json by build-world.mjs; do not edit. */"
  : "/* Map data: Natural Earth 1:110m, public domain (naturalearthdata.com). Generated from world-110m.json by build-world.mjs; do not edit. */";
writeFileSync(join(here, "world-110m.js"), banner + "\n(function (root) {\n  root.kit.maps.setWorld(" + JSON.stringify(world) + ");\n})(window);\n");
console.log("wrote world-110m.js with " + world.regions.length + " regions");
