// The reference and bundle calls reach the commands the app's backend registers, with
// the arguments it reads (Tauri turns `baseHash` into the command's `base_hash`).

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn(async (..._args: unknown[]) => ({}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { tauriBundles } from "./bundles-tauri";
import { tauriReferences } from "./references-tauri";

beforeEach(() => invoke.mockClear());

describe("the reference calls", () => {
  it("read the bibliography and what a reference would repeat", async () => {
    await tauriReferences.bibliography();
    expect(invoke).toHaveBeenLastCalledWith("bibliography");
    const reference = { type: "article", key: "doe2020thing", fields: { title: "A thing" } };
    await tauriReferences.checkReference(reference);
    expect(invoke).toHaveBeenLastCalledWith("check_reference", { reference });
    await tauriReferences.suggestKey({ author: "Doe, Jane", year: "2020" });
    expect(invoke).toHaveBeenLastCalledWith("suggest_key", { hints: { author: "Doe, Jane", year: "2020" } });
  });

  it("edit the managed file against the hash it was read with", async () => {
    const reference = { type: "article", key: "doe2020thing", fields: {}, allowDuplicate: true };
    await tauriReferences.addReference(reference, "abc");
    expect(invoke).toHaveBeenLastCalledWith("add_reference", { reference, baseHash: "abc" });
    await tauriReferences.updateReference("doe2020thing", { year: "2021", note: null }, "abc");
    expect(invoke).toHaveBeenLastCalledWith("update_reference", { key: "doe2020thing", fields: { year: "2021", note: null }, baseHash: "abc" });
    await tauriReferences.replaceReference("doe2020thing", "@misc{doe2020thing}", "abc");
    expect(invoke).toHaveBeenLastCalledWith("replace_reference", { key: "doe2020thing", text: "@misc{doe2020thing}", baseHash: "abc" });
    await tauriReferences.adoptBib("papers/x.bib", null, "abc");
    expect(invoke).toHaveBeenLastCalledWith("adopt_bib", { path: "papers/x.bib", keys: null, baseHash: "abc" });
  });

  it("plan and make a rename of a key", async () => {
    await tauriReferences.referenceUses("a");
    expect(invoke).toHaveBeenLastCalledWith("reference_uses", { key: "a" });
    await tauriReferences.planKeyRename("a", "b");
    expect(invoke).toHaveBeenLastCalledWith("plan_key_rename", { from: "a", to: "b" });
    await tauriReferences.renameCitationKey("a", "b", "hash");
    expect(invoke).toHaveBeenLastCalledWith("rename_citation_key", { from: "a", to: "b", bibHash: "hash" });
  });
});

describe("the bundle calls", () => {
  it("plan and make an export of a project", async () => {
    await tauriBundles.planExport("trip");
    expect(invoke).toHaveBeenLastCalledWith("plan_export", { project: "trip" });
    await tauriBundles.exportProject("trip", "D:/Exports/trip");
    expect(invoke).toHaveBeenLastCalledWith("export_project", { project: "trip", dest: "D:/Exports/trip" });
  });
});
