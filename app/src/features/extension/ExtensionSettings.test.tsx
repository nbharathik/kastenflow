// Settings → Browser extension, against a stand-in for the app: the switch, the
// port, the pairing code and its countdown, the extensions paired and revoking.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setExtensionBackend } from "./backend";
import { ExtensionSettings, validPort } from "./ExtensionSettings";
import { clock, spaced } from "./PairingRow";
import { resetExtension, secondsLeft, useExtension } from "./store";
import type { ExtensionBackend, ExtensionStatus } from "./types";

const BASE: ExtensionStatus = { enabled: false, port: 7434, running: false, problem: null, paired: [], pairing: null };
const EDGE = { id: "a1b2c3d4", label: "Edge", origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop", pairedAt: Date.now() - 3 * 60_000 };

/** An app that keeps the door's state the way the real one does. */
function app(start: Partial<ExtensionStatus> = {}) {
  const me = {
    status: { ...BASE, ...start } as ExtensionStatus,
    calls: [] as string[],
    backend: null as unknown as ExtensionBackend,
  };
  const answer = () => Promise.resolve({ ...me.status });
  me.backend = {
    available: true,
    status: answer,
    setEnabled: (on) => {
      me.calls.push(`enabled ${on}`);
      me.status = { ...me.status, enabled: on, running: on, pairing: on ? me.status.pairing : null };
      return answer();
    },
    setPort: (port) => {
      me.calls.push(`port ${port}`);
      me.status = { ...me.status, port };
      return answer();
    },
    pairStart: () => {
      me.calls.push("pair");
      me.status = { ...me.status, pairing: { code: "ABCD2345", secondsLeft: 120, triesLeft: 5 } };
      return answer();
    },
    pairCancel: () => {
      me.calls.push("cancel");
      me.status = { ...me.status, pairing: null };
      return answer();
    },
    revoke: (id) => {
      me.calls.push(`revoke ${id}`);
      me.status = { ...me.status, paired: me.status.paired.filter((p) => p.id !== id) };
      return answer();
    },
    folder: () => Promise.resolve(FOLDER),
    showFolder: () => {
      me.calls.push("show folder");
      return Promise.resolve(FOLDER);
    },
  };
  setExtensionBackend(me.backend);
  return me;
}

/** Where the installed app carries the extension. */
const FOLDER = "C:/Program Files/KastenFlow/browser-extension";

beforeEach(() => {
  resetExtension();
  // The steps remember whether they were opened, per browser.
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  setExtensionBackend(null);
});

const press = (name: string | RegExp) => act(async () => fireEvent.click(screen.getByRole("button", { name })));

describe("the helpers", () => {
  it("write a code as it is typed, a countdown as a clock, and accept ports from 1024 up", () => {
    expect(spaced("ABCD2345")).toBe("ABCD-2345");
    expect(spaced("AB")).toBe("AB");
    expect(clock(105)).toBe("1:45");
    expect(clock(5)).toBe("0:05");
    expect(["1024", "7434", " 65535 "].map(validPort)).toEqual([true, true, true]);
    expect(["80", "1023", "65536", "7434x", "", "-7434", "7 434"].map(validPort)).toEqual([false, false, false, false, false, false, false]);
  });

  it("count a code's seconds down from when the app said them", () => {
    const status: ExtensionStatus = { ...BASE, pairing: { code: "ABCD2345", secondsLeft: 120, triesLeft: 5 } };
    expect(secondsLeft(status, 1_000, 1_000)).toBe(120);
    expect(secondsLeft(status, 1_000, 31_500)).toBe(90);
    expect(secondsLeft(status, 1_000, 500_000)).toBe(0);
    expect(secondsLeft({ ...BASE }, 0, 10)).toBe(0);
    expect(secondsLeft(null, 0, 10)).toBe(0);
  });
});

describe("Settings → Browser extension", () => {
  it("is off until turned on, and then says where the door is", async () => {
    const me = app();
    render(<ExtensionSettings />);
    const group = await screen.findByRole("region", { name: "Browser extension" });
    const on = within(group).getByRole("switch", { name: "Let the browser extension reach KastenFlow" }) as HTMLInputElement;
    expect(on.checked).toBe(false);
    expect((within(group).getByRole("button", { name: "Pair" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(group).getByText(/Turn the extension on first/)).toBeTruthy();

    await act(async () => fireEvent.click(on));
    expect(me.calls).toEqual(["enabled true"]);
    await waitFor(() => expect(within(group).getByRole("status").textContent).toContain("Open on 127.0.0.1:7434"));
    expect((within(group).getByRole("button", { name: "Pair" }) as HTMLButtonElement).disabled).toBe(false);

    await act(async () => fireEvent.click(on));
    expect(me.calls).toEqual(["enabled true", "enabled false"]);
    await waitFor(() => expect(within(group).queryByRole("status")).toBeNull());
  });

  it("shows the pairing code with its time and tries, and takes it away on Cancel", async () => {
    const me = app({ enabled: true, running: true });
    render(<ExtensionSettings />);
    await screen.findByRole("button", { name: "Pair" });
    await press("Pair");
    expect(me.calls).toEqual(["pair"]);
    const code = await screen.findByLabelText("Pairing code");
    expect(code.textContent).toBe("ABCD-2345");
    expect(screen.getByText(/2:00 left · 5 tries/)).toBeTruthy();
    expect(screen.getByText(/press Pair and type this code/)).toBeTruthy();
    await press("Cancel");
    expect(me.calls).toEqual(["pair", "cancel"]);
    expect(screen.queryByLabelText("Pairing code")).toBeNull();
  });

  it("asks the app while a code waits, and lists the extension that took it", async () => {
    const me = app({ enabled: true, running: true });
    render(<ExtensionSettings pollMs={20} />);
    await screen.findByRole("button", { name: "Pair" });
    await press("Pair");
    await screen.findByLabelText("Pairing code");
    expect(screen.getByText("None yet.")).toBeTruthy();

    // The extension takes the code: the app has it paired and no code waits.
    me.status = { ...me.status, pairing: null, paired: [EDGE] };
    await waitFor(() => expect(screen.queryByLabelText("Pairing code")).toBeNull());
    const list = screen.getByRole("list", { name: "Paired extensions" });
    expect(within(list).getByText("Edge")).toBeTruthy();
    expect(within(list).getByText(/abcdefghijklmnopabcdefghijklmnop · paired 3 minutes ago/)).toBeTruthy();
  });

  it("revokes a paired extension", async () => {
    const me = app({ enabled: true, running: true, paired: [EDGE, { ...EDGE, id: "ffff0000", label: "Chrome", origin: "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba" }] });
    render(<ExtensionSettings />);
    const list = await screen.findByRole("list", { name: "Paired extensions" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    await press("Revoke Edge");
    expect(me.calls).toEqual(["revoke a1b2c3d4"]);
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Paired extensions" })).getAllByRole("listitem")).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "Revoke Edge" })).toBeNull();
    expect(screen.getByRole("button", { name: "Revoke Chrome" })).toBeTruthy();
  });

  it("changes the port only to one that is allowed", async () => {
    const me = app({ enabled: true, running: true });
    render(<ExtensionSettings />);
    const field = (await screen.findByRole("textbox", { name: "Port" })) as HTMLInputElement;
    const change = screen.getByRole("button", { name: "Change" }) as HTMLButtonElement;
    expect(field.value).toBe("7434");
    expect(change.disabled).toBe(true);
    for (const bad of ["80", "70000", "abc", ""]) {
      fireEvent.change(field, { target: { value: bad } });
      expect(change.disabled, bad).toBe(true);
    }
    fireEvent.change(field, { target: { value: "7500" } });
    expect(change.disabled).toBe(false);
    await press("Change");
    expect(me.calls).toEqual(["port 7500"]);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("127.0.0.1:7500"));
    expect((screen.getByRole("button", { name: "Change" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows where the app carries the extension's files, and opens that folder from a button", async () => {
    const me = app();
    render(<ExtensionSettings />);
    expect(await screen.findByText(FOLDER)).toBeTruthy();
    await press("Show extension folder");
    expect(me.calls).toEqual(["show folder"]);
    // Load unpacked is pointed at this folder in the steps.
    fireEvent.click(screen.getByRole("button", { name: /Show the steps/ }));
    expect(screen.getByText(/pick the extension folder/)).toBeTruthy();
  });

  it("says so, and offers nothing to press, when this copy of the app carries no extension", async () => {
    const me = app();
    me.backend.folder = () => Promise.reject(new Error("The extension's files are not in this copy of KastenFlow"));
    render(<ExtensionSettings />);
    expect(await screen.findByText("The extension's files are not in this copy of KastenFlow")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Show extension folder" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says a folder that could not be shown", async () => {
    const me = app();
    me.backend.showFolder = () => Promise.reject(new Error("Could not open the folder: no file manager"));
    render(<ExtensionSettings />);
    await screen.findByText(FOLDER);
    await press("Show extension folder");
    expect((await screen.findByRole("alert")).textContent).toBe("Could not open the folder: no file manager");
  });

  it("says why the door is shut when the port is taken", async () => {
    app({ enabled: true, running: false, problem: "KastenFlow cannot listen on 127.0.0.1:7434 for the extension: in use" });
    render(<ExtensionSettings />);
    expect((await screen.findByRole("alert")).textContent).toContain("cannot listen on 127.0.0.1:7434");
    expect(screen.getByRole("status").textContent).toContain("Shut");
  });

  it("says a change that failed, and leaves the switch where it was", async () => {
    const me = app();
    me.backend.setEnabled = () => Promise.reject(new Error("The settings could not be saved"));
    render(<ExtensionSettings />);
    const on = (await screen.findByRole("switch", { name: "Let the browser extension reach KastenFlow" })) as HTMLInputElement;
    await act(async () => fireEvent.click(on));
    expect((await screen.findByRole("alert")).textContent).toBe("The settings could not be saved");
    expect(useExtension.getState().status?.enabled).toBe(false);
  });

  it("needs the desktop app in the browser preview, and still tells how to install", async () => {
    setExtensionBackend(null);
    render(<ExtensionSettings />);
    const group = await screen.findByRole("region", { name: "Browser extension" });
    expect(within(group).getByText("Needs the desktop app")).toBeTruthy();
    expect(within(group).queryByRole("switch")).toBeNull();
    expect((within(group).getByRole("button", { name: "Pair" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(group).getByRole("textbox", { name: "Port" }) as HTMLInputElement).disabled).toBe(true);
    // The steps are folded away until asked for.
    expect(within(group).queryByText(/Load unpacked/)).toBeNull();
    fireEvent.click(within(group).getByRole("button", { name: "Show the steps" }));
    expect(within(group).getByText(/Load unpacked/)).toBeTruthy();
  });
});
