import type { Element } from "@kasten-slides/wasm";
import { cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { edit, enter, held, mount, section } from "../test-kit.tsx";

afterEach(cleanup);

type Kit = Awaited<ReturnType<typeof mount>>;
type Of<K extends Element["type"]> = Extract<Element, { type: K }>;
const at = { x: 64, y: 148, w: 300, h: 200 };
const timer = (extra: Partial<Of<"timer">> = {}): Element => ({ type: "timer", id: "", seconds: 300, label: "Time left", ...at, ...extra }) as Element;
const qr = (extra: Partial<Of<"qr">> = {}): Element => ({ type: "qr", id: "", data: "https://example.com", ...at, ...extra }) as Element;
const the = <K extends Element["type"]>(kit: Kit, index = 0) => held(kit, kit.ids[index] as string) as Of<K>;

describe("Timer", () => {
  const field = (name: string) => within(section("timer")).getByLabelText(name) as HTMLInputElement;

  it("shows the time as minutes and seconds, the words and whether it starts by itself", async () => {
    await mount({ elements: [timer({ seconds: 195, autostart: true })] });
    expect([field("Minutes").value, field("Seconds").value]).toEqual(["3", "15"]);
    expect(field("Timer words").value).toBe("Time left");
    expect((within(section("timer")).getByRole("checkbox", { name: /Start by itself/ }) as HTMLInputElement).checked).toBe(true);
    expect(field("Minutes").closest("[data-primary]")).not.toBeNull();
  });

  it("changes the minutes and the seconds, each keeping the other, one step of undo", async () => {
    const kit = await mount({ elements: [timer({ seconds: 195 })] });
    enter(field("Minutes"), "10");
    expect(the<"timer">(kit).seconds).toBe(615);
    enter(field("Seconds"), "5");
    expect(the<"timer">(kit).seconds).toBe(605);
    edit(() => kit.session.undo());
    expect(the<"timer">(kit).seconds).toBe(615);
  });

  it("never counts down from nothing", async () => {
    const kit = await mount({ elements: [timer({ seconds: 30 })] });
    enter(field("Seconds"), "0");
    expect(the<"timer">(kit).seconds).toBe(1);
  });

  it("sets the words, takes them away when empty, and starts by itself on a tick", async () => {
    const kit = await mount({ elements: [timer()] });
    enter(field("Timer words"), "Questions");
    expect(the<"timer">(kit).label).toBe("Questions");
    enter(field("Timer words"), "");
    expect(the<"timer">(kit).label).toBeUndefined();
    fireEvent.click(within(section("timer")).getByRole("checkbox", { name: /Start by itself/ }));
    expect(the<"timer">(kit).autostart).toBe(true);
  });

  it("changes the minutes of timers that differ, each keeping its own seconds", async () => {
    const kit = await mount({ elements: [timer({ seconds: 65 }), timer({ seconds: 130, y: 20 })] });
    enter(field("Minutes"), "4");
    expect([the<"timer">(kit, 0).seconds, the<"timer">(kit, 1).seconds]).toEqual([245, 250]);
  });
});

describe("QR code", () => {
  const field = (name: string) => within(section("qr")).getByLabelText(name) as HTMLInputElement;
  const useLink = () => within(section("qr")).getByRole("button", { name: /Use the slide.s link/ }) as HTMLButtonElement;

  it("shows what the code holds and its caption", async () => {
    await mount({ elements: [qr({ caption: "Scan me" })] });
    expect(field("QR code holds").value).toBe("https://example.com");
    expect(field("QR code caption").value).toBe("Scan me");
    expect(field("QR code holds").closest("[data-primary]")).not.toBeNull();
  });

  it("changes what it holds when the box is left, and the caption on Enter, each one step of undo", async () => {
    const kit = await mount({ elements: [qr()] });
    fireEvent.change(field("QR code holds"), { target: { value: "  https://example.org/talk  " } });
    fireEvent.blur(field("QR code holds"));
    expect(the<"qr">(kit).data).toBe("https://example.org/talk");
    enter(field("QR code caption"), "The slides");
    expect(the<"qr">(kit).caption).toBe("The slides");
    enter(field("QR code caption"), "");
    expect(the<"qr">(kit).caption).toBeUndefined();
    edit(() => kit.session.undo());
    expect(the<"qr">(kit).caption).toBe("The slides");
  });

  it("takes the address the slide links to, and cannot when the slide links to none", async () => {
    const none = await mount({ elements: [qr()] });
    expect(useLink().disabled).toBe(true);
    expect(within(section("qr")).getByText(/links to no web address/)).toBeTruthy();
    cleanup();
    const link = { type: "text", id: "", x: 10, y: 10, w: 200, h: 40, link: "https://example.org/docs", text: { paragraphs: [{ runs: [{ t: "Docs" }] }] } } as Element;
    const kit = await mount({ elements: [qr(), link], select: [0] });
    expect(useLink().disabled).toBe(false);
    fireEvent.click(useLink());
    expect(the<"qr">(kit).data).toBe("https://example.org/docs");
    expect(useLink().disabled).toBe(true);
    edit(() => kit.session.undo());
    expect(the<"qr">(kit).data).toBe("https://example.com");
    expect(none.errors).toEqual([]);
  });

  it("warns when the code holds more than a phone reads easily", async () => {
    await mount({ elements: [qr({ data: "x".repeat(260) })] });
    expect(within(section("qr")).getByText(/long for a QR code/)).toBeTruthy();
  });
});
