// The editor as a person uses it, on a deck served by `slides dev`: make a deck, type,
// draw, drag with snapping, group, undo and redo, change a layout, reorder slides, change
// the theme, edit the outline, and check that what was done is in the file.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { boxOf, pageGeometry, saved } from "./lib.mjs";

const LONG = { timeout: 15000 };

/** The state a check reads, from the page. */
const read = (page, fn, arg) => page.evaluate(fn, arg);

const slideNow = (page) => read(page, () => JSON.parse(JSON.stringify(window.__ks.session.slide)));
const deckNow = (page) => read(page, () => JSON.parse(JSON.stringify(window.__ks.session.deck)));
const selection = (page) => read(page, () => [...window.__ks.session.state.selection]);
const textOf = (element) => (element?.text?.paragraphs ?? []).map((p) => p.runs.map((r) => r.t).join("")).join("\n");
const byId = (slide, id) => slide.elements.find((e) => e.id === id);

/** Adds elements by the engine, as a fixture: what is tested next is what a person does with them. */
const put = (page, elements) =>
  page.evaluate((elements) => {
    const { session } = window.__ks;
    return session.elements.insert(elements);
  }, elements);

const rect = (id, x, y, w = 200, h = 80, fill = "accent1") => ({ type: "shape", id, shape: "rect", x, y, w, h, style: { fill: { color: fill } }, text: { paragraphs: [{ runs: [{ t: id }] }], valign: "middle" } });

async function menu(page, ...path) {
  const [first, ...rest] = path;
  await page.getByRole("menuitem", { name: first, exact: true }).first().click();
  for (const [i, name] of rest.entries()) {
    const item = page.locator(".ks-popover").getByText(name, { exact: true }).first();
    if (i === rest.length - 1) await item.click();
    else await item.hover();
  }
}

export async function run({ browser, base, decks, shots, check }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (error) {
      check(name, false, error instanceof Error ? error.message.split("\n")[0] : String(error));
      await page.screenshot({ path: join(shots, `failed-${name.replace(/\W+/g, "-")}.png`) }).catch(() => {});
    }
  };

  await step("makes a deck in the folder", async () => {
    await page.goto(base, { waitUntil: "load" });
    await page.waitForSelector("h1");
    await page.fill('input[aria-label="Title of the new deck"]', "Acceptance");
    await page.click('button:has-text("New deck")');
    await page.waitForFunction(() => window.__ks, null, LONG);
    check("the deck opens in the editor", (await deckNow(page)).title === "Acceptance");
    check("its file is in the folder", readFileSync(join(decks, "acceptance.deck"), "utf8").includes('"Acceptance"'));
  });

  await step("types into the title", async () => {
    const title = (await slideNow(page)).elements.find((e) => e.placeholder === "title");
    const box = await boxOf(page, title.id);
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(() => window.__ks.session.state.editing !== null, null, LONG);
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Typed by the acceptance run");
    await page.keyboard.press("Escape");
    await saved(page);
    check("the words are in the slide", textOf(byId(await slideNow(page), title.id)) === "Typed by the acceptance run");
    check("and in the file", readFileSync(join(decks, "acceptance.deck"), "utf8").includes("Typed by the acceptance run"));
    await page.keyboard.press("Control+z");
    check("one undo takes the typing back", textOf(byId(await slideNow(page), title.id)) !== "Typed by the acceptance run");
    await page.keyboard.press("Control+Shift+z");
    check("and redo brings it back", textOf(byId(await slideNow(page), title.id)) === "Typed by the acceptance run");
  });

  await step("draws a text box with the tool", async () => {
    const before = (await slideNow(page)).elements.length;
    await page.getByRole("button", { name: "Text box", exact: true }).first().click();
    const g = await pageGeometry(page);
    await page.mouse.move(g.x + 80 * g.scale, g.y + 400 * g.scale);
    await page.mouse.down();
    await page.mouse.move(g.x + 400 * g.scale, g.y + 470 * g.scale, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(() => window.__ks.session.state.editing !== null, null, LONG);
    await page.keyboard.type("A drawn box");
    await page.keyboard.press("Escape");
    const slide = await slideNow(page);
    check("a text box was added", slide.elements.length === before + 1);
    check("it holds the typed words", slide.elements.some((e) => textOf(e) === "A drawn box"));
  });

  await step("drags and snaps", async () => {
    await put(page, [rect("snap-a", 100, 250), rect("snap-b", 500, 254, 200, 80, "accent2")]);
    await page.evaluate(() => window.__ks.session.select([]));
    const g = await pageGeometry(page);
    const b = await boxOf(page, "snap-b");
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(b.x + b.width / 2 + i * 6 * g.scale, b.y + b.height / 2, { steps: 1 });
    check("a guide is drawn while the edge is close to another", (await page.locator('.ks-guide-set[style*="visible"] .ks-guide').count()) >= 1);
    await page.screenshot({ path: join(shots, "snap-guide.png") });
    await page.mouse.up();
    const moved = byId(await slideNow(page), "snap-b");
    check("the top edge snapped to the other element's", Math.abs(moved.y - 250) < 0.01, `y = ${moved.y}`);
    check("and it moved along x", moved.x > 500, `x = ${moved.x}`);
    check("the drag is one step of undo", (await read(page, () => window.__ks.session.state.undoLabel)) === "transform_elements");
    await page.keyboard.press("Control+z");
    const back = byId(await slideNow(page), "snap-b");
    check("undo puts it back", back.x === 500 && back.y === 254, `${back.x}, ${back.y}`);
    await page.keyboard.press("Control+Shift+z");
    check("redo moves it again", Math.abs(byId(await slideNow(page), "snap-b").y - 250) < 0.01);
  });

  await step("groups and ungroups", async () => {
    const a = await boxOf(page, "snap-a");
    const b = await boxOf(page, "snap-b");
    await page.mouse.click(a.x + a.width / 2, a.y + a.height / 2);
    await page.keyboard.down("Shift");
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.keyboard.up("Shift");
    check("two elements are selected", (await selection(page)).length === 2);
    await page.keyboard.press("Control+Alt+g");
    const grouped = (await slideNow(page)).elements.find((e) => e.type === "group");
    check("they became one group", grouped && grouped.children.length === 2);
    check("the group is selected", grouped && (await selection(page))[0] === grouped.id);
    await page.keyboard.press("Control+Alt+Shift+g");
    check("ungrouping gives them back", !(await slideNow(page)).elements.some((e) => e.type === "group"));
  });

  await step("changes the layout without losing words", async () => {
    await page.keyboard.press("Control+m");
    await page.waitForFunction(() => window.__ks.session.deck.slides.length === 2, null, LONG);
    const slide = await slideNow(page);
    const body = slide.elements.find((e) => e.placeholder === "body");
    await page.evaluate(({ slide, id }) => window.__ks.session.core.apply("set_text", { slide, id, markdown: "- one\n- two\n- three" }), { slide: slide.id, id: body.id });
    const wordsBefore = (await slideNow(page)).elements.map(textOf).join("\n").split(/\s+/).filter(Boolean).sort();
    await page.getByRole("button", { name: "Layout", exact: true }).first().click();
    await page.locator(".ks-popover").getByText("Two columns", { exact: true }).click();
    const after = await slideNow(page);
    check("the slide has the new layout", after.layout === "two-columns", after.layout);
    const wordsAfter = after.elements.map(textOf).join("\n").split(/\s+/).filter(Boolean).sort();
    check("no words were lost", JSON.stringify(wordsAfter) === JSON.stringify(wordsBefore));
    await page.screenshot({ path: join(shots, "two-columns.png") });
  });

  await step("reorders slides in the filmstrip", async () => {
    await page.keyboard.press("Control+m");
    await page.waitForFunction(() => window.__ks.session.deck.slides.length === 3, null, LONG);
    const before = (await deckNow(page)).slides.map((s) => s.id);
    const rows = page.locator('.ks-fs-list [role="option"]');
    const last = await rows.nth(2).boundingBox();
    const first = await rows.nth(0).boundingBox();
    await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2);
    await page.mouse.down();
    await page.mouse.move(last.x + last.width / 2, (last.y + first.y) / 2, { steps: 5 });
    await page.mouse.move(first.x + first.width / 2, first.y + 6, { steps: 5 });
    await page.mouse.up();
    const after = (await deckNow(page)).slides.map((s) => s.id);
    check("the third slide is now the first", after[0] === before[2] && after[1] === before[0] && after[2] === before[1], after.join(" "));
    await page.keyboard.press("Control+z");
    check("undo restores the order", (await deckNow(page)).slides.map((s) => s.id).join() === before.join());
  });

  await step("changes the theme", async () => {
    const before = await deckNow(page);
    await page.getByRole("button", { name: "Theme", exact: true }).first().click();
    await page.locator(".ks-popover").getByText("Dark", { exact: true }).click();
    const after = await deckNow(page);
    check("the deck has the Dark theme", after.theme.name === "Dark", after.theme.name);
    check("its colours changed", JSON.stringify(after.theme.colors) !== JSON.stringify(before.theme.colors));
    check("no slide or element was lost", after.slides.length === before.slides.length && after.slides.every((s, i) => s.elements.length === before.slides[i].elements.length));
    await page.screenshot({ path: join(shots, "dark-theme.png") });
    await page.keyboard.press("Control+z");
    check("undo brings the old theme back", (await deckNow(page)).theme.name === before.theme.name);
  });

  await step("edits the outline", async () => {
    await menu(page, "View", "Views", "Outline");
    const input = page.locator(".ks-outline-view input.ks-ol-title").first();
    await input.waitFor(LONG);
    await input.fill("Renamed in the outline");
    await input.blur();
    await page.waitForFunction(() => window.__ks.session.deck.slides[0].elements.some((e) => e.placeholder === "title" && e.text.paragraphs.some((p) => p.runs.some((r) => r.t === "Renamed in the outline"))), null, LONG);
    check("the first slide's title changed", true);
    await page.screenshot({ path: join(shots, "outline.png") });
    await menu(page, "View", "Views", "Slide editor");
    await page.waitForSelector(".ks-stage", LONG);
    check("back in the slide editor", true);
  });

  await step("saves the slides as PNG pictures", async () => {
    const made = await page.evaluate(async () => {
      const { file } = await window.__ks.session.exports.png({ scope: "all", scale: 1, steps: "final" });
      return { type: file.type, bytes: Array.from(file.bytes) };
    });
    const zip = join(shots, "pictures.zip");
    writeFileSync(zip, Buffer.from(made.bytes));
    const shown = (await deckNow(page)).slides.filter((s) => !s.hidden).length;
    const names = execFileSync("unzip", ["-Z1", zip]).toString().split("\n").filter(Boolean);
    check("a zip file of pictures, one for each slide", made.type === "application/zip" && names.length === shown, names.join(" "));
    check("that the zip tool finds sound", /No errors detected/.test(execFileSync("unzip", ["-t", zip]).toString()));
    const header = execFileSync("unzip", ["-p", zip, names[0] ?? "none"], { maxBuffer: 64 * 1024 * 1024 }).subarray(0, 24);
    check("each a PNG of the slide's size", header.subarray(1, 4).toString() === "PNG" && header.readUInt32BE(16) === 960 && header.readUInt32BE(20) === 540);
  });

  await step("everything is in the file", async () => {
    await saved(page);
    const file = JSON.parse(readFileSync(join(decks, "acceptance.deck"), "utf8"));
    const live = await deckNow(page);
    check("the file holds the deck the editor has", JSON.stringify(file.slides.map((s) => s.id)) === JSON.stringify(live.slides.map((s) => s.id)));
    check("with the outline's title", JSON.stringify(file).includes("Renamed in the outline"));
  });

  check("the page reported no errors", problems.length === 0, problems[0] ?? "");
  await page.close();
}
