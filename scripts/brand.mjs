// Writes every static Kasten mark from one geometry (docs/brand/README.md): the
// app icon source, the favicon, the tile, the bare symbol and the lockup with
// the name. BrandMark (app/src/ui/BrandMark.tsx) draws the same numbers.
//
//   node scripts/brand.mjs
//   pnpm -C app tauri icon app-icon.svg -o /tmp/icons   # then copy back, see the README

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INK = "#1C1B1A";
const PAPER = "#FFFFFF";

// The card box on a 24 grid: two index cards, fanned evenly, standing in a
// box with a label slot. Each shape cuts a gap of GAP into what is behind it.
const BOX = '<rect x="3" y="12.2" width="18" height="8.8" rx="2.6"/>';
const SLOT = '<rect x="9.4" y="15.6" width="5.2" height="1.9" rx="0.95"/>';
const LEFT = '<rect x="5.6" y="3.8" width="8.2" height="11" rx="1.7" transform="rotate(-10 9.7 14.8)"/>';
const RIGHT = '<rect x="10.2" y="3.8" width="8.2" height="11" rx="1.7" transform="rotate(10 14.3 14.8)"/>';
const GAP = 1.5;
// On the tile: 70 %, a touch high, since the box makes the bottom heavy.
const TILE = { dx: 3.6, dy: 3.4, scale: 0.7, rx: 5.4 };

/** The symbol in `color`, its masks named after `id`. */
function symbol(color, id) {
  const cut = (shapes) => `<g fill="#000" stroke="#000" stroke-width="${GAP * 2}">${shapes}</g>`;
  const mask = (name, inner) =>
    `<mask id="${id}-${name}" maskUnits="userSpaceOnUse" x="-2" y="-4" width="28" height="30"><rect x="-2" y="-4" width="28" height="30" fill="#fff"/>${inner}</mask>`;
  return (
    `<defs>${mask("box", cut(BOX))}${mask("right", cut(RIGHT))}${mask("slot", SLOT.replace("<rect", '<rect fill="#000"'))}</defs>` +
    `<g fill="${color}"><g mask="url(#${id}-box)"><g mask="url(#${id}-right)">${LEFT}</g>${RIGHT}</g><g mask="url(#${id}-slot)">${BOX}</g></g>`
  );
}

const svg = (viewBox, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="KastenFlow"><title>KastenFlow</title>${body}</svg>\n`;
const onTile = (color) => `<g transform="translate(${TILE.dx} ${TILE.dy}) scale(${TILE.scale})">${symbol(color, "kasten")}</g>`;

// The app icon: the tile on Apple's icon grid, 824 px in 1024.
const unit = 824 / 24;
const icon = svg(
  "0 0 1024 1024",
  `<rect x="100" y="100" width="824" height="824" rx="${Math.round(TILE.rx * unit * 100) / 100}" fill="${INK}"/>` +
    `<g transform="translate(100 100) scale(${Math.round(unit * 10000) / 10000})">${onTile(PAPER)}</g>`,
);
// The tile, edge to edge.
const tile = svg("0 0 24 24", `<rect width="24" height="24" rx="${TILE.rx}" fill="${INK}"/>${onTile(PAPER)}`);
// The symbol alone, in the text colour.
const mark = svg("0 0 24 24", symbol("currentColor", "kasten"));
// The lockup for the README and the website: the tile beside the name, on a
// light page and on a dark one, where the tile turns to paper. The width
// leaves room for the name in the widest font of the list (Arial, about 165
// units at this size), plus about the 14 units between the tile and the name.
const WORD = 'font-family="Inter, -apple-system, BlinkMacSystemFont, \'Segoe UI\', Helvetica, Arial, sans-serif" font-size="30" font-weight="650" letter-spacing="-0.6"';
const lockup = (tileColor, markColor, textColor) =>
  svg(
    "0 0 240 48",
    `<g transform="scale(2)"><rect width="24" height="24" rx="${TILE.rx}" fill="${tileColor}"/>${onTile(markColor)}</g>` +
      `<text x="62" y="35" ${WORD} fill="${textColor}">KastenFlow</text>`,
  );

const files = {
  "docs/brand/logo.svg": icon,
  "app/app-icon.svg": icon,
  "docs/brand/logo-tile.svg": tile,
  "app/public/favicon.svg": tile,
  "docs/brand/mark.svg": mark,
  "docs/brand/lockup.svg": lockup(INK, PAPER, INK),
  "docs/brand/lockup-dark.svg": lockup(PAPER, INK, "#F2F1EF"),
};
for (const [file, text] of Object.entries(files)) writeFileSync(join(ROOT, file), text);
console.log(`wrote ${Object.keys(files).join(", ")}`);
