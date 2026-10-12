// The browser preview gives the real diagram editor the policy the desktop
// app's `diagrams` scheme gives it, so what is tried there is what ships.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { DRAWIO_POLICY } from "../../dev-drawio";

/** The policy the Rust side serves the editor's page with. */
function servedPolicy(): string {
  const source = readFileSync(resolve(import.meta.dirname, "../../src-tauri/src/diagrams/protocol.rs"), "utf8");
  const found = /const POLICY: &str = "([^"]+)";/.exec(source);
  if (!found) throw new Error("the scheme's policy was not found in protocol.rs");
  return found[1]!;
}

describe("the preview's policy for the diagram editor", () => {
  it("is the one the diagrams scheme serves", () => {
    expect(DRAWIO_POLICY).toBe(servedPolicy());
  });

  it("lets the editor's page talk to no address but its own and keeps it out of every other page", () => {
    const policy = Object.fromEntries(DRAWIO_POLICY.split("; ").map((d) => [d.split(" ")[0]!, d.split(" ").slice(1)]));
    expect(policy["default-src"]).toEqual(["'none'"]);
    expect(policy["connect-src"]).toEqual(["'self'", "blob:", "data:"]);
    expect(policy["form-action"]).toEqual(["'none'"]);
    expect(policy["object-src"]).toEqual(["'none'"]);
    // Nothing in it names a host.
    expect(DRAWIO_POLICY).not.toMatch(/https?:|\*/);
  });
});
