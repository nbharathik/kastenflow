// The page demo: a page and the Markdown file it is, kept in step. Ticking a
// to-do, changing the status, renaming the page, adding a line with [[links]]
// or asking Claude for an itinerary changes the file beside it, the way
// Kasten saves a page. It returns the few moves the banner's examples and
// tour make on a visitor's behalf.

import { h, icon, wait } from "./dom.js";
import { LINK, fileLines, lineNode, paint, slug } from "./files-format.js";

const PAGES = [
  { title: "Packing list", where: "Seaside trip" },
  { title: "Harbour walk", where: "Seaside trip" },
  { title: "Ferry times", where: "Pages" },
  { title: "Budget", where: "Seaside trip" },
  { title: "Zettelkasten method", where: "Pages" },
];
const MAX_LINES = 8;
// What the sample Claude writes: sample text, not a model's answer.
const ITINERARY = [
  "## Itinerary",
  "- Wednesday: fly out, check in near the harbour",
  "- Thursday: the [[Harbour walk]], then the market",
  "- Friday: [[Ferry times]] first, then the lighthouse",
];

export default function filesDemo(root) {
  const el = Object.fromEntries(["title", "status", "todos", "lines", "input", "suggest", "code", "path", "announce"].map((name) => [name, root.querySelector(`[data-${name}]`)]));
  const start = { title: el.title.value, status: el.status.value };
  const fresh = () => ({
    ...start,
    todos: [
      { text: "Flights", done: true },
      { text: "Offline maps", done: false },
      { text: "Travel insurance", done: false },
    ],
    lines: [],
  });
  let state = fresh();
  let shown = [];
  let picks = [];
  let active = 0;
  let quiet = false;
  let writing = false;
  let session = 0;

  const say = (text) => {
    if (!quiet) el.announce.textContent = text;
  };
  const hasClaude = () => state.lines.some((line) => line.by === "claude");

  function drawTodos() {
    el.todos.replaceChildren(
      ...state.todos.map((todo) => {
        const box = h("input", { type: "checkbox", checked: todo.done });
        box.addEventListener("change", () => {
          todo.done = box.checked;
          drawFile();
          say(`${todo.text} ${todo.done ? "ticked" : "unticked"}. The file changed with it.`);
        });
        return h("li", {}, h("label", {}, box, todo.text));
      }),
    );
  }

  function drawLines(added = false) {
    const nodes = state.lines.map(lineNode);
    if (added) nodes.at(-1)?.classList.add("is-new");
    el.lines.replaceChildren(...nodes);
  }

  function drawFile() {
    const lines = fileLines(state);
    el.path.textContent = `library/${slug(state.title)}.md`;
    let fences = 0;
    el.code.replaceChildren(
      ...lines.map((line, i) => {
        if (line === "---") fences++;
        const changed = shown.length > 0 && shown[i] !== line;
        return h("span", { class: changed ? "ln is-changed" : "ln" }, ...paint(line, fences === 1 && line !== "---"));
      }),
    );
    shown = lines;
  }

  function addLine(line) {
    state.lines.push(line);
    while (state.lines.length > MAX_LINES) state.lines.shift();
    drawLines(true);
    drawFile();
  }

  // Typing a line, with [[ offering pages to link.
  const query = () => {
    const upto = el.input.value.slice(0, el.input.selectionStart ?? el.input.value.length);
    const at = upto.lastIndexOf("[[");
    if (at < 0 || upto.slice(at).includes("]]")) return null;
    return { at, text: upto.slice(at + 2) };
  };

  function openSuggest() {
    const found = query();
    if (!found || found.text.length > 40) return closeSuggest();
    const needle = found.text.trim().toLowerCase();
    picks = PAGES.filter((page) => page.title.toLowerCase().includes(needle)).slice(0, 5);
    if (needle && !PAGES.some((page) => page.title.toLowerCase() === needle)) picks.push({ title: found.text.trim(), fresh: true });
    if (picks.length === 0) return closeSuggest();
    active = Math.min(active, picks.length - 1);
    el.suggest.replaceChildren(
      ...picks.map((page, i) =>
        h(
          "li",
          { role: "option", id: `df-option-${i}`, "aria-selected": String(i === active), onmousedown: (event) => (event.preventDefault(), pick(i)) },
          icon(page.fresh ? "#i-plus" : "#i-page"),
          page.fresh ? `New page “${page.title}”` : page.title,
          page.where ? h("small", {}, `in ${page.where}`) : null,
        ),
      ),
    );
    el.suggest.hidden = false;
    el.input.setAttribute("aria-expanded", "true");
    el.input.setAttribute("aria-activedescendant", `df-option-${active}`);
  }

  function closeSuggest() {
    picks = [];
    active = 0;
    el.suggest.hidden = true;
    el.input.setAttribute("aria-expanded", "false");
    el.input.removeAttribute("aria-activedescendant");
  }

  function pick(i) {
    const found = query();
    const page = picks[i];
    if (!found || !page) return;
    const value = el.input.value;
    const before = `${value.slice(0, found.at)}[[${page.title}]] `;
    el.input.value = before + value.slice(el.input.selectionStart ?? value.length).replace(/^\]\]\s?/, "");
    el.input.setSelectionRange(before.length, before.length);
    closeSuggest();
  }

  function commit() {
    const text = el.input.value.trim().replace(/\s+/g, " ");
    if (!text) return;
    el.input.value = "";
    addLine({ text, by: "you" });
    const created = [...text.matchAll(LINK)].map((m) => m[1]).filter((title) => !PAGES.some((page) => page.title.toLowerCase() === title.toLowerCase()));
    say(created.length ? `Added the line, and a new page for ${created.join(", ")}.` : "Added the line to the page and to the file.");
  }

  el.input.addEventListener("input", () => {
    active = 0;
    openSuggest();
  });
  el.input.addEventListener("click", openSuggest);
  el.input.addEventListener("blur", () => setTimeout(closeSuggest, 120));
  el.input.addEventListener("keydown", (event) => {
    const open = !el.suggest.hidden;
    if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      active = (active + (event.key === "ArrowDown" ? 1 : -1) + picks.length) % picks.length;
      openSuggest();
    } else if (open && (event.key === "Enter" || event.key === "Tab")) {
      event.preventDefault();
      pick(active);
    } else if (open && event.key === "Escape") {
      closeSuggest();
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
  });

  el.title.addEventListener("input", () => {
    state.title = el.title.value;
    drawFile();
  });
  el.title.addEventListener("change", () => say(`Renamed. The file is now ${el.path.textContent}.`));
  el.status.addEventListener("change", () => {
    state.status = el.status.value;
    drawFile();
    say(`Status set to ${state.status}.`);
  });

  setupTabs(root);
  drawTodos();
  drawLines();
  drawFile();

  return {
    /** The to-do to tick next: the first open one, else the last. */
    nextTodo() {
      const open = state.todos.findIndex((todo) => !todo.done);
      return open >= 0 ? open : state.todos.length - 1;
    },
    /** Ticks or unticks a to-do as a click would; whether it is done now. */
    tick(index) {
      const box = el.todos.querySelectorAll("input")[index];
      box?.click();
      return Boolean(box?.checked);
    },
    /** The next status in turn, as the select would be changed by hand. */
    cycleStatus() {
      const options = [...el.status.options];
      el.status.selectedIndex = (el.status.selectedIndex + 1) % options.length;
      el.status.dispatchEvent(new Event("change", { bubbles: true }));
      return el.status.value;
    },
    /** What is typed in the line box, set as typing would. */
    type(text) {
      el.input.value = text;
      el.input.dispatchEvent(new Event("input"));
    },
    draft: () => el.input.value,
    focus() {
      el.input.focus();
      el.input.setSelectionRange(el.input.value.length, el.input.value.length);
    },
    pick,
    commit,
    hasClaude,
    busy: () => writing,
    /** The sample Claude writes an itinerary, line by line, marked as its own. */
    async askClaude(report = () => {}) {
      if (writing || hasClaude()) return false;
      writing = true;
      const mine = ++session;
      say("Claude is reading the page.");
      report("Claude is reading Seaside trip…");
      await wait(650);
      if (mine !== session) return false;
      report("Writing an itinerary…");
      await wait(500);
      for (const text of ITINERARY) {
        if (mine !== session) return false;
        addLine({ text, by: "claude" });
        await wait(380);
      }
      writing = false;
      say("Claude added an itinerary. It is marked on the page, and Undo takes it out.");
      return true;
    },
    /** Takes out what Claude wrote and leaves the rest. */
    undoClaude() {
      if (writing || !hasClaude()) return false;
      state.lines = state.lines.filter((line) => line.by !== "claude");
      drawLines();
      drawFile();
      say("Claude's changes are undone. Everything you wrote is kept.");
      return true;
    },
    /** The page as it first was. */
    reset() {
      state = fresh();
      shown = [];
      writing = false;
      session++;
      el.title.value = start.title;
      el.status.value = start.status;
      el.input.value = "";
      closeSuggest();
      drawTodos();
      drawLines();
      drawFile();
      say("The page is back as it began.");
    },
    /** Silences the screen reader while a tour plays, so it does not talk over the visitor. */
    quietly(on) {
      quiet = on;
    },
  };
}

/** On narrow screens the page and the file are tabs. */
function setupTabs(root) {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const show = (name) => {
    root.dataset.view = name;
    for (const tab of tabs) {
      const on = tab.id.endsWith(name);
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
    }
  };
  for (const tab of tabs) {
    tab.addEventListener("click", () => show(tab.id.endsWith("file") ? "file" : "page"));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const other = tabs.find((t) => t !== tab);
      other.focus();
      other.click();
    });
  }
  show("page");
}
