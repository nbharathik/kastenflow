// A named view (`![[Page#view]]`) is only ever data: the name picks one of the
// manifest's views and is never turned into a file name. (Which files a view
// may be drawn from is held by the app, which hands over only safe entries.)

import { describe, expect, it } from "vitest";

import type { PageInfo } from "./backend";
import { entryOfView } from "./use-page-info";

const info = (views: PageInfo["views"]): PageInfo => ({ id: "01P", path: "library/p.md", title: "P", ready: true, height: null, maxHeight: null, problems: [], webImages: false, views });

describe("entryOfView", () => {
  const page = info([
    { name: "deadlines", title: null, entry: "views/deadlines.html" },
    { name: "map", title: null, entry: null },
  ]);

  it("finds a view by its name, whatever the case", () => {
    expect(entryOfView(page, "deadlines")).toEqual({ name: "deadlines", entry: "views/deadlines.html" });
    expect(entryOfView(page, " Deadlines ")).toEqual({ name: "deadlines", entry: "views/deadlines.html" });
    expect(entryOfView(page, "map")).toEqual({ name: "map" });
  });

  it("passes on a name the manifest does not know only when it could be one", () => {
    expect(entryOfView(page, "later_2-b")).toEqual({ name: "later_2-b" });
    for (const hostile of ["../index.html", "a/b", "..", "<script>alert(1)</script>", "x".repeat(65), "a b", "smart://kit/1/kit.js", "%2e%2e", "a\u0000b"]) {
      expect(entryOfView(page, hostile)).toEqual({ name: "" });
    }
  });

  it("never gives a file for a name the manifest does not have", () => {
    for (const name of ["../../x", "index", "entry", "views/deadlines.html"]) {
      expect(entryOfView(page, name)).not.toHaveProperty("entry");
    }
  });
});
