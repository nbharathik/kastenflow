// How the page demo writes a page as a Markdown file: its lines, their
// colours, a file name from a title, and how a line of the page is drawn.

import { h, icon } from "./dom.js";

export const LINK = /\[\[([^\]]+)\]\]/g;

/** The page as Kasten writes it. */
export function fileLines(state) {
  const lines = [
    "---",
    "id: 01M3A2KTR05W9C8QXZ4JYB6N7D",
    `title: ${yaml(state.title)}`,
    "type: page",
    "icon: ✈️",
    "tags: [travel]",
    "props:",
    `  status: ${state.status}`,
    "---",
    "> [!tip] Trip at a glance",
    "> A town by the sea, Wednesday to Monday.",
    "",
    "## Before we go",
    "",
    ...state.todos.map((todo) => `- [${todo.done ? "x" : " "}] ${todo.text}`),
  ];
  // A list stays together; anything else sits after a blank line.
  let before = "todo";
  for (const { text } of state.lines) {
    const bullet = text.startsWith("- ");
    if (!(bullet && before === "bullet")) lines.push("");
    lines.push(text);
    before = bullet ? "bullet" : "text";
  }
  return lines;
}

/** A title as YAML: plain when it reads the same, quoted when it would not. */
function yaml(text) {
  const plain = /^[\p{L}\p{N}][\p{L}\p{N} '’.,!?()&-]*$/u.test(text) && text === text.trim();
  return plain ? text : JSON.stringify(text);
}

/** A file name from a title, as Kasten makes one. */
export function slug(title) {
  let out = "";
  let dash = false;
  for (const letter of title.toLowerCase()) {
    if (/[\p{L}\p{N}]/u.test(letter)) {
      if (dash && out) out += "-";
      out += letter;
      dash = false;
    } else dash = true;
    if ([...out].length >= 80) break;
  }
  return out || "untitled";
}

/** A line added to the page: a heading, a bullet or a paragraph, its
 * [[links]] drawn as links, marked when Claude wrote it. */
export function lineNode({ text, by }) {
  const agent = by === "claude" ? " is-agent" : "";
  if (text.startsWith("## ")) return h("p", { class: `df-h${agent}` }, ...chips(text.slice(3)));
  if (text.startsWith("- ")) return h("p", { class: `df-b${agent}` }, ...chips(text.slice(2)));
  return h("p", { class: agent.trim() || null }, ...chips(text));
}

const chips = (line) => split(line, (title) => h("span", { class: "df-link" }, icon("#i-page"), title));

/** A line of the file, coloured as an editor would. */
export function paint(line, frontmatter) {
  if (!line) return [" "];
  if (line === "---") return [h("span", { class: "t-dim" }, line)];
  if (frontmatter) {
    const pair = /^(\s*[\w-]+:)(.*)$/.exec(line);
    return pair ? [h("span", { class: "t-key" }, pair[1]), pair[2]] : [line];
  }
  if (line.startsWith("## ")) return [h("span", { class: "t-head" }, line)];
  if (line.startsWith("> ")) return [h("span", { class: "t-dim" }, "> "), line.slice(2)];
  const todo = /^- \[( |x)\] (.*)$/.exec(line);
  if (todo) return [h("span", { class: todo[1] === "x" ? "t-done" : "t-dim" }, `- [${todo[1]}]`), " ", ...links(todo[2])];
  if (line.startsWith("- ")) return [h("span", { class: "t-dim" }, "- "), ...links(line.slice(2))];
  return links(line);
}

const links = (text) => split(text, (title) => h("span", { class: "t-link" }, `[[${title}]]`));

/** Text with each [[link]] made by `make`. */
function split(text, make) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    parts.push(text.slice(last, m.index), make(m[1]));
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return parts.filter((part) => part !== "");
}
