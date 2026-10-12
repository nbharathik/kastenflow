// The editor goes by its page's key as it is now: a draft becomes a page, a page
// is given an id, and the menus that present or fold it still find it.

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PageEditor } from "./PageEditor";
import { endPresenting, foldAllSections, presentPage } from "./sections/registry";

async function mount(pageKey: string) {
  let ready = false;
  const body = "One.\n\n---\n\nTwo.\n";
  const view = render(<PageEditor body={body} pageKey={pageKey} onReady={(handle) => (ready = handle !== null)} />);
  await vi.waitFor(() => expect(ready).toBe(true), { timeout: 20_000 });
  return view;
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("an editor whose page's key changes", () => {
  it("is found by the new key, not the old one", async () => {
    const view = await mount("projects/x/pages/draft.md");
    expect(presentPage("projects/x/pages/draft.md")).toBe(2);
    endPresenting("projects/x/pages/draft.md");
    // The page was made and given an id: the page menu asks for the page by it.
    view.rerender(<PageEditor body={"One.\n\n---\n\nTwo.\n"} pageKey="01K5Y2WE1C0MEPAGE000000001" />);
    await vi.waitFor(() => expect(presentPage("01K5Y2WE1C0MEPAGE000000001")).toBe(2));
    endPresenting("01K5Y2WE1C0MEPAGE000000001");
    expect(presentPage("projects/x/pages/draft.md")).toBe(0);
    expect(foldAllSections(true, "01K5Y2WE1C0MEPAGE000000001")).toBe(2);
    expect(foldAllSections(true, "projects/x/pages/draft.md")).toBe(0);
  }, 60_000);
});
