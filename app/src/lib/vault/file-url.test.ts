import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}` }));

import { fileUrl, KEPT_MAX, keepFileUrl, setFileRoot } from "./file-url";

afterEach(() => setFileRoot(null));

describe("fileUrl", () => {
  it("is null in the preview, where there is no folder", () => {
    expect(fileUrl("images/map.png")).toBeNull();
  });

  it("points into the vault's folder", () => {
    setFileRoot("/home/me/Kasten/");
    expect(fileUrl("images/map.png")).toBe(`asset://localhost/${encodeURIComponent("/home/me/Kasten/images/map.png")}`);
    setFileRoot("C:\\Users\\me\\Kasten");
    expect(fileUrl("images/map.png")).toBe(`asset://localhost/${encodeURIComponent("C:\\Users\\me\\Kasten\\images\\map.png")}`);
  });

  it("will not leave the vault", () => {
    setFileRoot("/home/me/Kasten");
    for (const bad of ["../secret.png", "/etc/passwd", "a//b.png", "a/./b.png", ""]) expect(fileUrl(bad)).toBeNull();
  });
});

describe("kept files", () => {
  const revoke = vi.fn();
  beforeEach(() => {
    revoke.mockClear();
    vi.stubGlobal("URL", Object.assign(URL, { revokeObjectURL: revoke }));
  });

  it("frees the old URL when a file is kept again", () => {
    keepFileUrl("again.png", "blob:one");
    keepFileUrl("again.png", "blob:two");
    expect(revoke).toHaveBeenCalledWith("blob:one");
    expect(fileUrl("again.png")).toBe("blob:two");
  });

  it("frees the least recently used past the cap", () => {
    for (let i = 0; i < KEPT_MAX; i++) keepFileUrl(`lru/${i}.png`, `blob:lru${i}`);
    revoke.mockClear();
    expect(fileUrl("lru/0.png")).toBe("blob:lru0"); // used: no longer the oldest
    keepFileUrl("lru/extra.png", "blob:extra");
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:lru1");
    expect(fileUrl("lru/0.png")).toBe("blob:lru0");
    expect(fileUrl("lru/1.png")).toBeNull();
  });
});
