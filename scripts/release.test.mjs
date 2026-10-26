import assert from "node:assert/strict";
import { test } from "node:test";

import { notes, problems } from "./release.mjs";

const ready = { branch: "release/1.2.2", dirty: false, pushed: true, version: null, workspace: "1.2.2", packageVersion: "1.2.2", tagExists: false, pubkey: true, clientId: true, ciPassed: true, ciPending: false, pinsTodo: false };

test("a pushed, clean, green, matching commit is ready", () => {
  assert.deepEqual(problems(ready), []);
});

test("each thing in the way is named", () => {
  assert.equal(problems({ ...ready, dirty: true }).length, 1);
  assert.equal(problems({ ...ready, pushed: false }).length, 1);
  assert.equal(problems({ ...ready, ciPassed: false }).length, 1);
  assert.equal(problems({ ...ready, tagExists: true }).length, 1);
  assert.equal(problems({ ...ready, packageVersion: "1.2.1" }).length, 1);
  assert.equal(problems({ ...ready, version: "1.3.0" }).length, 1);
  assert.equal(problems({ ...ready, clientId: false }).length, 1);
  assert.equal(problems({ ...ready, clientId: null }).length, 0, "an unreadable variable is a note, the release build checks it");
});

test("unfilled pins and a running CI are notes, not stops", () => {
  assert.equal(notes({ ...ready, pinsTodo: true, ciPending: true }).length, 2);
  assert.deepEqual(problems({ ...ready, pinsTodo: true }), []);
});
