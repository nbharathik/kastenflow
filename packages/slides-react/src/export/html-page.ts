// The exported web page as text: one file with the styles, the slides, the data and the script inline.

const escapeHtml = (text: string): string => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** Text that is safe inside a `<script>`: the one thing that ends it is the closing tag. */
export const inScript = (text: string): string => text.replaceAll(/<\/(script)/gi, "<\\/$1");

/** JSON that is safe inside a `<script>`: no `<` to start a closing tag or a comment, and no line separators. */
export const jsonForScript = (value: unknown): string => JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");

/** Rules for the page itself, round the stage: the window is the stage, and black where the slide is not. */
const PAGE_CSS = "html,body{margin:0;height:100%;background:#000}body{overflow:hidden}body:has(.ks-show-scroll){overflow:auto;background:#f6f6f7}@media (prefers-color-scheme:dark){body:has(.ks-show-scroll){background:#16161a}}";

export interface PageParts {
  title: string;
  /** All the styles, as text. */
  css: string;
  /** The stage: the `.reveal` element of the slides. */
  slides: string;
  /** Facts the script reads. */
  data: unknown;
  /** The script, whole. */
  script: string;
}

export function assemblePage({ title, css, slides, data, script }: PageParts): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="generator" content="KastenFlow Slides">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${PAGE_CSS}\n${css.replaceAll(/<\/(style)/gi, "<\\/$1")}</style>`,
    "</head>",
    "<body>",
    `<div class="ks-show" role="application" aria-label="${escapeHtml(title)}">`,
    slides,
    '<div class="ks-show-chrome"></div>',
    "</div>",
    "<noscript>This web page needs JavaScript to show its slides.</noscript>",
    `<script type="application/json" id="ks-data">${jsonForScript(data)}</script>`,
    `<script>${inScript(script)}</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
