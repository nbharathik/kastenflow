// "Link each work" on a citation: the works link to where they can be read, and the switch shows what the citations agree on.

import type { Element } from "@kasten-slides/wasm";
import { cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { edit, held, mount, section } from "../test-kit.tsx";

afterEach(cleanup);

type Citation = Extract<Element, { type: "citation" }>;
const at = { x: 64, y: 480, w: 600, h: 30 };
const cite = (extra: Partial<Citation> = {}): Element => ({ type: "citation", id: "", keys: ["lecun2015deep"], ...at, ...extra }) as Element;
const the = (kit: Awaited<ReturnType<typeof mount>>, n = 0) => held(kit, kit.ids[n] as string) as Citation;
const toggle = () => within(section("citation")).getByLabelText("Link each work") as HTMLInputElement;

describe("Link each work", () => {
  it("is off for a citation that does not link, and turns links on and off in one step of undo each", async () => {
    const kit = await mount({ elements: [cite()] });
    expect(toggle().checked).toBe(false);
    fireEvent.click(toggle());
    expect(the(kit).links).toBe(true);
    expect(toggle().checked).toBe(true);
    fireEvent.click(toggle());
    expect(Boolean(the(kit).links)).toBe(false);
    edit(() => kit.session.undo());
    expect(the(kit).links).toBe(true);
    expect(kit.errors).toEqual([]);
  });

  it("shows on when the citation links already", async () => {
    await mount({ elements: [cite({ links: true })] });
    expect(toggle().checked).toBe(true);
  });

  it("shows mixed for citations that differ, and a press turns all on", async () => {
    const kit = await mount({ elements: [cite(), cite({ links: true, y: 300 })] });
    expect(toggle().indeterminate).toBe(true);
    fireEvent.click(toggle());
    expect(kit.ids.map((_, n) => the(kit, n).links)).toEqual([true, true]);
  });
});
