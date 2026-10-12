import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { includePartials } from "./build-site.mjs";

const require = createRequire(new URL("../app/package.json", import.meta.url));
const { JSDOM } = require("jsdom");

// The demos read the document and `matchMedia` as globals, the way a page gives them.
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
const { setupHero } = await import("../site/js/hero.js");

const read = (file) => readFileSync(new URL(`../site/${file}`, import.meta.url), "utf8");
const assemble = (file) => includePartials(read(file), read).replaceAll("__REPO__", "owner/kasten").replaceAll("__SITE__", "https://kasten.example");
const heroHtml = assemble("partials/hero.html");

function fixture(t, options = { tour: false }) {
  const { window } = new JSDOM(`<!doctype html><body>${heroHtml}</body>`, { url: "https://kasten.example/", pretendToBeVisual: true });
  const saved = { window: globalThis.window, document: globalThis.document, Event: globalThis.Event };
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.Event = window.Event;
  t.after(() => {
    Object.assign(globalThis, saved);
    window.close();
  });
  const loaded = [];
  const root = window.document.querySelector("[data-hero]");
  const hero = setupHero(root, { ...options, load: async (name) => (loaded.push(name), { default() {} }) });
  const $ = (selector) => root.querySelector(selector);
  const $$ = (selector) => [...root.querySelectorAll(selector)];
  const lines = () => [...$("[data-code]").children].map((line) => line.textContent.trimEnd());
  const tabs = $$('[role="tab"]').filter((tab) => tab.closest(".tour-tabs"));
  return { window, root, hero, loaded, tabs, $, $$, lines };
}

const $$ = (root, selector) => [...root.querySelectorAll(selector)];

/** Lets mocked timers run, and the promises waiting on them. */
async function advance(t, ms) {
  for (let spent = 0; spent < ms; spent += 50) {
    t.mock.timers.tick(50);
    await new Promise((done) => setImmediate(done));
  }
}

const key = (window, el, name) => el.dispatchEvent(new window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));

test("ticking, the status, the title and a page link change the Markdown file beside the page", (t) => {
  const { window, $, lines } = fixture(t);
  $('[data-try="tick"]').click();
  assert.ok(lines().includes("- [x] Offline maps"));
  $('[data-try="tick"]').click();
  assert.ok(lines().includes("- [x] Travel insurance"));
  $('[data-try="tick"]').click();
  assert.ok(lines().includes("- [ ] Travel insurance"), "with every to-do ticked the example unticks the last");

  $('[data-try="status"]').click();
  assert.ok(lines().includes("  status: Booked"));
  assert.equal($("[data-status]").value, "Booked");

  const title = $("[data-title]");
  title.value = "Weekend away";
  title.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal($("[data-path]").textContent, "library/weekend-away.md");
  assert.ok(lines().includes("title: Weekend away"));

  $('[data-try="link"]').click();
  assert.equal($("[data-input]").value, "Pack light, and see [[");
  assert.equal($("[data-suggest]").hidden, false);
  key(window, $("[data-input]"), "Enter");
  assert.equal($("[data-input]").value, "Pack light, and see [[Packing list]] ");
  key(window, $("[data-input]"), "Enter");
  assert.ok(lines().includes("Pack light, and see [[Packing list]]"));
  assert.equal($("[data-lines] .df-link").textContent, "Packing list");
});

test("the sample Claude writes a marked itinerary into the page and file, and Undo takes out only that", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { hero, $, $$, lines } = fixture(t);
  hero.demo.type("Pack light");
  hero.demo.commit();

  const claude = $('[data-try="claude"]');
  claude.click();
  assert.ok(claude.disabled, "no second request while Claude writes");
  await advance(t, 3000);
  assert.equal($$(".df-lines .is-agent").length, 4);
  const file = lines();
  const at = file.indexOf("## Itinerary");
  assert.ok(at > 0);
  assert.equal(file[at + 1], "");
  assert.deepEqual(file.slice(at + 2, at + 5).map((line) => line.slice(0, 11)), ["- Wednesday", "- Thursday:", "- Friday: ["], "a list stays together");
  assert.ok(file.includes("- Thursday: the [[Harbour walk]], then the market"));
  assert.match(claude.textContent, /Undo Claude/);
  assert.ok(!claude.disabled);

  claude.click();
  assert.equal($$(".df-lines .is-agent").length, 0);
  assert.ok(!lines().includes("## Itinerary"));
  assert.ok(lines().includes("Pack light"), "what the visitor wrote stays");
  assert.match(claude.textContent, /Ask Claude/);
});

test("starting over mid-write stops Claude and restores the page", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { hero, $, $$, lines } = fixture(t);
  $('[data-try="tick"]').click();
  hero.demo.type("A note");
  hero.demo.commit();
  $('[data-try="claude"]').click();
  await advance(t, 800);
  $('[data-try="reset"]').click();
  await advance(t, 4000);
  assert.equal($$(".df-lines p").length, 0);
  assert.ok(lines().includes("- [ ] Offline maps"));
  assert.equal($("[data-status]").value, "Planning");
  assert.ok(!$('[data-try="claude"]').disabled);
  assert.match($('[data-try="claude"]').textContent, /Ask Claude/);
});

test("the tabs show one view at a time, move with the keyboard and start live views once", (t) => {
  const { window, tabs, $, $$, loaded } = fixture(t);
  const open = () => tabs.filter((tab) => tab.getAttribute("aria-selected") === "true");
  assert.equal(tabs.length, 8);
  assert.deepEqual(open(), [tabs[0]]);
  assert.deepEqual(loaded, [], "views that are not open have not started");

  tabs[3].click();
  assert.deepEqual(open(), [tabs[3]]);
  assert.equal($("[data-app-title]").textContent, "brainstorm");
  assert.deepEqual($$(".app-panel.is-active").map((panel) => panel.id), ["view-board"]);
  assert.equal($$(".app-panel[inert]").length, 7, "views that are not shown cannot be reached");
  assert.deepEqual(loaded, ["board"]);

  key(window, tabs[3], "ArrowDown");
  assert.deepEqual(open(), [tabs[4]]);
  key(window, tabs[4], "End");
  assert.deepEqual(open(), [tabs[7]]);
  assert.equal(window.document.activeElement, tabs[7]);
  key(window, tabs[7], "Home");
  assert.deepEqual(open(), [tabs[0]]);
  tabs[3].click();
  assert.deepEqual(loaded, ["board", "ai"], "reopening a view does not start it again");
});

test("while the window is pinned, scrolling picks the view and choosing a tab scrolls to its place", async (t) => {
  const was = globalThis.matchMedia;
  globalThis.matchMedia = (query) => ({ matches: query.includes("min-width"), addEventListener() {} });
  t.after(() => {
    globalThis.matchMedia = was;
  });
  const { window, root, tabs, $ } = fixture(t);
  assert.ok(root.hasAttribute("data-scroll"), "a screen wide and tall enough scrolls the tour");

  const track = $("[data-track]");
  const pin = $(".tour-pin");
  pin.style.top = "76px";
  Object.defineProperty(pin, "offsetHeight", { value: 700 });
  let top = 76; // where the track's top edge is on screen; the window pins at 76
  track.getBoundingClientRect = () => ({ top, height: 3000 }); // 2300 to travel while pinned
  const scrolls = [];
  window.scrollTo = (options) => scrolls.push(options);
  const frame = () => new Promise((done) => window.requestAnimationFrame(() => done()));
  const picked = () => tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
  const scroll = async (edge) => {
    top = edge;
    window.dispatchEvent(new window.Event("scroll"));
    await frame();
  };

  await scroll(76 - 1150); // halfway through the track
  assert.equal(picked(), 4);
  assert.deepEqual($$(root, ".app-panel.is-active").map((panel) => panel.id), ["view-present"]);
  await scroll(76 - 2290);
  assert.equal(picked(), 7);
  await scroll(500); // not yet pinned
  assert.equal(picked(), 0);

  top = 300;
  tabs[7].click();
  assert.equal(picked(), 7, "the view is shown at once");
  assert.equal(scrolls.at(-1).behavior, "smooth");
  assert.ok(Math.abs(scrolls.at(-1).top - (300 - 76 + 2300 * (7 / 7))) < 0.001, "to that view's place along the track");

  await scroll(76 - 1150 * 0.8); // on the way there: not read as choosing views
  assert.equal(picked(), 7);
  await new Promise((done) => setTimeout(done, 240)); // once it settles, the page is read again
  assert.equal(picked(), 3);

  const link = window.document.createElement("a");
  link.href = "#app";
  link.dataset.view = "history";
  window.document.body.append(link);
  const click = new window.MouseEvent("click", { bubbles: true, cancelable: true });
  link.dispatchEvent(click);
  assert.ok(click.defaultPrevented, "the page scrolls to the view itself, not to the top of the banner");
  assert.equal(tabs[picked()].id, "tab-history");
});

test("a link elsewhere on the page that names a view opens it", (t) => {
  const { window, tabs, root } = fixture(t);
  const link = window.document.createElement("a");
  link.href = "#app";
  link.dataset.view = "history";
  window.document.body.append(link);
  link.click();
  assert.equal(tabs.find((tab) => tab.getAttribute("aria-selected") === "true").id, "tab-history");
  assert.ok(root.querySelector("#view-history").classList.contains("is-active"));
});

test("the intro ticks a to-do and links a page, once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { $, lines } = fixture(t, { tour: true });
  await advance(t, 7000);
  assert.ok(lines().includes("- [x] Offline maps"));
  assert.ok(lines().includes("Book the ferry, see [[Ferry times]]"));
  assert.equal($("[data-input]").value, "");
});

test("the first touch ends the intro and leaves nothing half typed", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { window, $, lines } = fixture(t, { tour: true });
  await advance(t, 2700);
  assert.notEqual($("[data-input]").value, "", "the intro is typing");
  $("#view-pages").dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true }));
  await advance(t, 7000);
  assert.equal($("[data-input]").value, "");
  assert.ok(!lines().some((line) => line.startsWith("Book the ferry")));
});

test("the hint beside the to-dos goes at the first touch", (t) => {
  const { window, $ } = fixture(t);
  assert.ok(!$("[data-coach]").classList.contains("is-gone"));
  $("#view-pages").dispatchEvent(new window.KeyboardEvent("keydown", { key: "a", bubbles: true }));
  assert.ok($("[data-coach]").classList.contains("is-gone"));
});

test("the banner has no pause control and no looping motion to pause", () => {
  assert.doesNotMatch(heroHtml, /pause|data-hero-motion/i);
  for (const file of ["css/hero.css", "css/hero-explore.css", "css/floats.css"]) assert.doesNotMatch(read(file), /infinite/, file);
});

// The whole page, as it is built.

const { document: page } = new JSDOM(assemble("index.html")).window;

test("every id is unique and every link, tab and label on the page points at something", () => {
  const ids = [...page.querySelectorAll("[id]")].map((el) => el.id);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
  for (const a of page.querySelectorAll('a[href^="#"]')) {
    if (a.getAttribute("href") !== "#") assert.ok(page.getElementById(a.getAttribute("href").slice(1)), a.outerHTML);
  }
  for (const el of page.querySelectorAll("[aria-controls], [aria-labelledby]")) {
    for (const id of `${el.getAttribute("aria-controls") ?? ""} ${el.getAttribute("aria-labelledby") ?? ""}`.split(/\s+/).filter(Boolean)) {
      assert.ok(page.getElementById(id), `${id} is named by ${el.outerHTML.slice(0, 80)}`);
    }
  }
  assert.equal(page.querySelectorAll("h1").length, 1);
});

test("each view's tab has a panel that names it back, and its own heading", () => {
  const tabs = [...page.querySelectorAll(".tour-tabs [role=tab]")];
  const panels = [...page.querySelectorAll(".app-stage > .app-panel")];
  assert.equal(tabs.length, 8);
  assert.equal(panels.length, tabs.length);
  for (const tab of tabs) {
    const panel = page.getElementById(tab.getAttribute("aria-controls"));
    assert.equal(panel.getAttribute("role"), "tabpanel");
    assert.equal(panel.getAttribute("aria-labelledby"), tab.id);
    assert.ok(panel.querySelector(".view-head h2"), tab.id);
  }
  assert.equal(page.querySelectorAll(".app-panel.is-active").length, 1);
});

test("the facts bar counts what the page lists", () => {
  const facts = Object.fromEntries([...page.querySelectorAll(".fact")].map((fact) => [fact.querySelector(".fact-num").textContent, fact.textContent]));
  assert.match(facts["6"], /formats/);
  assert.equal(page.querySelectorAll(".formats .chip").length, 6, "six formats and tools are named");
  assert.match(facts["3"], /Windows, macOS and Linux/);
  assert.equal(page.querySelectorAll(".systems [data-os]").length, 3, "three systems have installers");
  assert.match(page.querySelector("#faq").textContent, /MIT license/, "the licence the facts name is the one the answers give");
});

test("the styles ask nothing of other hosts: no web fonts, no imports", () => {
  const sheets = [...page.querySelectorAll('link[rel="stylesheet"]')].map((link) => link.getAttribute("href"));
  assert.ok(sheets.length >= 10);
  for (const href of sheets) {
    assert.ok(!/^[a-z]+:|^\/\//i.test(href), `${href} is the site's own`);
    assert.doesNotMatch(read(href), /@font-face|@import|url\(\s*["']?(https?:)?\/\//i, href);
  }
});

test("every picture the page names is one the build copies", () => {
  const names = [...page.querySelectorAll("img[src^='img/'], source[srcset^='img/']")].map((el) => (el.getAttribute("src") ?? el.getAttribute("srcset")).slice(4));
  assert.ok(names.length > 8);
  for (const name of names) assert.ok(["site/img", "docs/screenshots", "docs/brand"].some((dir) => existsSync(new URL(`../${dir}/${name}`, import.meta.url))), name);
});
