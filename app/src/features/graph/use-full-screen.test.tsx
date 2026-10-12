import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useShell } from "../../lib/store";
import { useFullScreen } from "./use-full-screen";

beforeEach(() => useShell.setState({ focusMode: false }));
afterEach(cleanup);

describe("full screen for a big view", () => {
  it("turns focus mode on and off with it", async () => {
    const { result } = renderHook(() => useFullScreen());
    expect(result.current.on).toBe(false);
    await act(async () => result.current.toggle());
    expect(result.current.on).toBe(true);
    expect(useShell.getState().focusMode).toBe(true);
    await act(async () => result.current.toggle());
    expect(result.current.on).toBe(false);
    expect(useShell.getState().focusMode).toBe(false);
  });

  it("lets go when the person leaves focus mode another way, as Esc does", async () => {
    const { result } = renderHook(() => useFullScreen());
    await act(async () => result.current.toggle());
    act(() => useShell.getState().toggleFocus());
    expect(useShell.getState().focusMode).toBe(false);
    expect(result.current.on).toBe(false);
  });

  it("gives focus mode back when the view closes", async () => {
    const { result, unmount } = renderHook(() => useFullScreen());
    await act(async () => result.current.toggle());
    expect(useShell.getState().focusMode).toBe(true);
    unmount();
    expect(useShell.getState().focusMode).toBe(false);
  });
});
