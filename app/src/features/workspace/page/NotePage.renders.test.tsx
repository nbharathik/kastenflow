// Typing in a page draws only what reads the text, and a save's counts
// do not make the open pages look their mentions up again.

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PageEditorProps } from "../../pages/editor/PageEditor";
import { MemoryVault } from "../preview/memory-vault";
import { useWorkspace } from "../store";
import { noteAt } from "../tree";
import { NotePage } from "./NotePage";

const PATH = "library/plan.md";
const TEXT = "---\ntitle: Plan\n---\nMine.\n";

const seen = vi.hoisted(() => ({ editor: undefined as undefined | ((body: string) => void), footer: 0, mentions: 0, header: 0 }));

vi.mock("../../pages/editor/PageEditor", () => ({
  PageEditor: (props: PageEditorProps) => {
    seen.editor = props.onChange;
    return <div data-testid="page-editor" />;
  },
}));
vi.mock("../../pages/editor/blocks/wikilink-view", async (orig) => ({ ...(await orig<object>()), refreshMentions: () => void seen.mentions++ }));
vi.mock("./PageFooter", () => ({
  PageFooter: () => {
    seen.footer++;
    return null;
  },
}));
vi.mock("../../pages/page/PageHeader", () => ({
  PageHeader: () => {
    seen.header++;
    return null;
  },
}));

async function open() {
  const vault = new MemoryVault({ [PATH]: TEXT });
  await useWorkspace.getState().connect({ client: vault });
  useWorkspace.getState().openPath(PATH);
  render(<NotePage client={vault} path={PATH} />);
  await screen.findByTestId("page-editor", {}, { timeout: 20_000 });
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("a page's drawing while typing", () => {
  it("draws the header and footer again only when something they show changes", async () => {
    await open();
    const footer = seen.footer;
    const header = seen.header;
    for (let i = 1; i <= 5; i++) act(() => seen.editor!(`Mine, and ${"more ".repeat(i)}`));
    expect(seen.footer - footer).toBe(0);
    expect(seen.header - header).toBe(0);
  });

  it("does not look mentions up again for a save's counts, but does for a new title", async () => {
    await open();
    const meta = noteAt(useWorkspace.getState().notes, PATH)!;
    const before = seen.mentions;
    for (let i = 1; i <= 5; i++) act(() => useWorkspace.getState().noteChanged({ ...meta, words: i, excerpt: `typed ${i}`, modified: meta.modified + i }));
    expect(seen.mentions - before).toBe(0);
    act(() => useWorkspace.getState().noteChanged({ ...meta, title: "Plan B" }));
    expect(seen.mentions - before).toBeGreaterThan(0);
  });
});
