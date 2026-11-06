import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FrameVerdict } from "../editor/host.ts";
import { toEmbedUrl } from "./embed-url.ts";
import { useFrameRefused } from "./frame-policy.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let seen: boolean[];

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  seen = [];
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

function Probe({ policy, address }: { policy: ((address: string) => Promise<FrameVerdict>) | undefined; address: string }) {
  const refused = useFrameRefused(policy, toEmbedUrl(address), address);
  seen.push(refused);
  return null;
}

const settle = () => act(async () => void (await Promise.resolve()));

describe("whether a page refuses to be framed is asked of the host", () => {
  it("is false until the host says the site refuses, and then true", async () => {
    const policy = vi.fn(async () => "refused" as const);
    await act(async () => root.render(<Probe policy={policy} address="https://refuses.example/page" />));
    await settle();
    expect(policy).toHaveBeenCalledWith("https://refuses.example/page");
    expect(seen[0]).toBe(false);
    expect(seen.at(-1)).toBe(true);
  });

  it("stays false when the site is open, when the host cannot tell, and when it fails", async () => {
    for (const answer of [async () => "open" as const, async () => "unknown" as const, async () => Promise.reject(new Error("offline"))]) {
      seen = [];
      await act(async () => root.render(<Probe key={String(answer)} policy={answer} address="https://opens.example/page" />));
      await settle();
      expect(seen.every((value) => !value)).toBe(true);
    }
  });

  it("is not asked for a host that has no way to ask, a known video site, or a page on this computer", async () => {
    const policy = vi.fn(async () => "refused" as const);
    await act(async () => root.render(<Probe policy={undefined} address="https://refuses.example/page" />));
    await act(async () => root.render(<Probe policy={policy} address="https://youtu.be/dQw4w9WgXcQ" />));
    await act(async () => root.render(<Probe policy={policy} address="http://localhost:3000/demo" />));
    await settle();
    expect(policy).not.toHaveBeenCalled();
    expect(seen.every((value) => !value)).toBe(true);
  });

  it("asks once for the same address, however many times it is shown", async () => {
    const policy = vi.fn(async () => "open" as const);
    for (let n = 0; n < 3; n += 1) {
      await act(async () => root.render(<Probe key={n} policy={policy} address="https://once.example/page" />));
      await settle();
    }
    expect(policy).toHaveBeenCalledTimes(1);
  });

  it("asks again after an answer of unknown (the network may be back)", async () => {
    const policy = vi.fn(async () => "unknown" as const);
    for (let n = 0; n < 2; n += 1) {
      await act(async () => root.render(<Probe key={n} policy={policy} address="https://again.example/page" />));
      await settle();
    }
    expect(policy).toHaveBeenCalledTimes(2);
  });
});
