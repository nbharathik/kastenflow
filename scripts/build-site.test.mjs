import assert from "node:assert/strict";
import { test } from "node:test";

import { includePartials, secureDemoPage } from "./build-site.mjs";

test("a partial can include other partials, and each is put in place trimmed", () => {
  const files = { "a.html": "<a><!-- include b.html --></a>\n", "b.html": "<b><!-- include c.html --></b>\n\n", "c.html": "<c></c>\n" };
  assert.equal(includePartials("<main><!-- include a.html --><!-- include c.html --></main>", (file) => files[file]), "<main><a><b><c></c></b></a><c></c></main>");
});

test("partials that include each other are refused instead of looping", () => {
  assert.throws(() => includePartials("<!-- include a.html -->", () => "<!-- include a.html -->"), /too deeply/);
});

test("the browser demo allows its WebAssembly engine without enabling JavaScript eval", () => {
  const page = secureDemoPage('<html><head><script type="module" src="./assets/main.js"></script></head><body></body></html>');
  const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(page)?.[1];
  assert.ok(policy, "a policy is inserted in the built page");
  assert.match(policy, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.ok(!policy.includes("'unsafe-eval'"));
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /frame-src 'none'/);
  assert.ok(page.includes('src="./assets/main.js"'));
});

test("the demo build refuses scripts its policy would block", () => {
  assert.throws(() => secureDemoPage("<html><head><script>alert(1)</script></head></html>"), /inline script/);
});

test("the demo build refuses a page where the policy cannot be inserted", () => {
  assert.throws(() => secureDemoPage("<html><body></body></html>"), /head/);
});
