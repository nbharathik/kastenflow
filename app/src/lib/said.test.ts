import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspace } from "../features/workspace/store";
import { copyOrSay, said } from "./said";

const last = () => useWorkspace.getState().toasts.at(-1)?.text;

beforeEach(() => useWorkspace.setState({ toasts: [] }));
afterEach(() => vi.unstubAllGlobals());

describe("said", () => {
  it("toasts what could not be done, with a short reason", async () => {
    await Promise.reject(new Error("Access is denied")).catch(said("Could not open the link"));
    expect(last()).toBe("Could not open the link: Access is denied");
  });

  it("leaves out a reason that is empty, long or not a sentence", () => {
    said("Could not open the link")(new Error(""));
    expect(last()).toBe("Could not open the link");
    said("Could not open the link")(new Error("x".repeat(300)));
    expect(last()).toBe("Could not open the link");
    said("Could not open the link")({ code: 5 });
    expect(last()).toBe("Could not open the link");
  });

  it("takes a reason given as plain text, and only its first line", () => {
    said("Could not stop the build")("The engine is not running.\nstack…");
    expect(last()).toBe("Could not stop the build: The engine is not running");
  });
});

describe("copyOrSay", () => {
  it("copies and says nothing", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyOrSay("ABCD-1234", "the code")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("ABCD-1234");
    expect(last()).toBeUndefined();
  });

  it("says so when the computer refuses", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) } });
    expect(await copyOrSay("x", "the code")).toBe(false);
    expect(last()).toBe("Could not copy the code");
  });

  it("says so when there is no clipboard at all", async () => {
    vi.stubGlobal("navigator", {});
    expect(await copyOrSay("x")).toBe(false);
    expect(last()).toBe("Could not copy that");
  });
});
